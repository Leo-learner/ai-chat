const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { MIN_PASSWORD_CHARS, isBcryptPassword, isValidUsername, normalizeEmail } = require('../lib/validation');

// Hash of a random string nobody knows. Comparing against it when the login
// does not match an account keeps response time independent of existence.
const DUMMY_PASSWORD_HASH = '$2a$12$xAfkbPKyZ6JkmHrvuMJ/JuezHpStSmhtyGEvCUMLUrId4ttftueTW';
const PASSWORD_RULE_MESSAGE = `密码至少 ${MIN_PASSWORD_CHARS} 位，且不超过 72 字节`;
const USERNAME_RULE_MESSAGE = '用户名需为 2-30 个字符，且不能包含 @ 或不可见字符';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function inviteCodeMatches(candidate, inviteCodes) {
  if (typeof candidate !== 'string' || !candidate.trim()) return false;
  const digest = sha256(candidate.trim());
  return inviteCodes.some(code => crypto.timingSafeEqual(digest, sha256(code)));
}

module.exports = function createAuthRouter({
  userQueries,
  deleteUserAccount,
  signToken,
  authRequired,
  authLimiter,
  loginThrottle,
  registration,
}) {
  const router = express.Router();

// GET /api/auth/config — public settings the login screen needs.
router.get('/config', (req, res) => {
  res.json({ registration: registration.mode });
});

router.post('/register', authLimiter, async (req, res) => {
  try {
    // Gate first so closed or invite-only servers reveal nothing about accounts.
    if (registration.mode === 'closed') {
      return res.status(403).json({ error: '当前未开放注册' });
    }
    if (registration.mode === 'invite' && !inviteCodeMatches(req.body?.inviteCode, registration.inviteCodes)) {
      return res.status(403).json({ error: '邀请码无效' });
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '请填写所有字段' });
    }
    if (!isBcryptPassword(password)) {
      return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: USERNAME_RULE_MESSAGE });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    const existingUser = userQueries.findByUsername.get(username);
    if (existingUser) {
      return res.status(409).json({ error: '用户名已被占用' });
    }
    const existingEmail = userQueries.findByEmail.get(email);
    if (existingEmail) {
      return res.status(409).json({ error: '该邮箱已注册' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuid();

    userQueries.create.run(id, username, email, hashedPassword, 'user');

    const user = userQueries.findById.get(id);
    const token = signToken(user);

    res.status(201).json({ user, token });
  } catch (err) {
    req.log.error('Register error:', err);
    res.status(500).json({ error: '注册失败' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
    const password = req.body?.password;

    if (!login || login.length > 254 || typeof password !== 'string' || password.length > 256) {
      return res.status(400).json({ error: '请输入用户名/邮箱和密码' });
    }

    // Input containing "@" is an email address. New usernames cannot contain
    // "@", so the username fallback only serves legacy accounts.
    const user = login.includes('@')
      ? userQueries.findByEmail.get(login) || userQueries.findByUsername.get(login)
      : userQueries.findByUsername.get(login);
    if (!user) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(401).json({ error: '用户名/邮箱或密码错误' });
    }

    const waitMs = loginThrottle.retryAfterMs(user.id, req.ip);
    if (waitMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
      return res.status(429).json({ error: `登录失败次数过多，请 ${Math.ceil(waitMs / 60000)} 分钟后再试` });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      loginThrottle.recordFailure(user.id, req.ip);
      return res.status(401).json({ error: '用户名/邮箱或密码错误' });
    }
    loginThrottle.recordSuccess(user.id, req.ip);

    const token = signToken(user);
    const { password: _, token_version: _tokenVersion, ...safeUser } = user;

    res.json({ user: safeUser, token });
  } catch (err) {
    req.log.error('Login error:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/auth/profile — self-service username / password change.
// Requires the current password for ANY change. Passwords are bcrypt-hashed and
// never returned. Wrong current password returns 400 (not 401) so the client's
// global 401→logout interceptor doesn't sign the user out on a typo.
router.patch('/profile', authRequired, authLimiter, async (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body || {};

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: '请输入当前密码' });
    }

    const wantsUsername = typeof newUsername === 'string' && newUsername.trim().length > 0;
    const wantsPassword = typeof newPassword === 'string' && newPassword.length > 0;
    if (!wantsUsername && !wantsPassword) {
      return res.status(400).json({ error: '没有需要修改的内容' });
    }

    // Verify current password against the stored hash.
    const account = userQueries.findWithPasswordById.get(req.user.id);
    if (!account) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, account.password);
    if (!valid) return res.status(400).json({ error: '当前密码不正确' });

    if (wantsUsername) {
      const next = newUsername.trim();
      if (next !== account.username) {
        if (!isValidUsername(next)) {
          return res.status(400).json({ error: USERNAME_RULE_MESSAGE });
        }
        const taken = userQueries.findByUsername.get(next);
        if (taken && taken.id !== account.id) {
          return res.status(409).json({ error: '该用户名已被占用' });
        }
        userQueries.updateUsername.run(next, account.id);
      }
    }

    if (wantsPassword) {
      if (!isBcryptPassword(newPassword)) {
        return res.status(400).json({ error: `新${PASSWORD_RULE_MESSAGE}` });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      // Also bumps token_version, signing out every other device.
      userQueries.updatePassword.run(hashed, account.id);
    }

    // Return refreshed safe user + a new token carrying the current token_version.
    const { token_version: tokenVersion, ...user } = userQueries.findAuthById.get(account.id);
    const token = signToken({ ...user, token_version: tokenVersion });
    res.json({ user, token });
  } catch (err) {
    req.log.error('Profile update error:', err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// POST /api/auth/logout-all — revoke every token issued for this account.
router.post('/logout-all', authRequired, (req, res) => {
  userQueries.bumpTokenVersion.run(req.user.id);
  res.json({ success: true });
});

// POST /api/auth/delete-account — permanently remove the account and its data.
router.post('/delete-account', authRequired, authLimiter, async (req, res) => {
  try {
    const currentPassword = req.body?.currentPassword;
    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: '请输入当前密码' });
    }
    const account = userQueries.findWithPasswordById.get(req.user.id);
    if (!account) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(currentPassword, account.password);
    if (!valid) return res.status(400).json({ error: '当前密码不正确' });

    deleteUserAccount(account.id);
    res.json({ success: true });
  } catch (err) {
    req.log.error('Delete account error:', err);
    res.status(500).json({ error: '注销失败' });
  }
});

  return router;
};
