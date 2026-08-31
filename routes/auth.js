const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { isBcryptPassword } = require('../lib/validation');

module.exports = function createAuthRouter({ userQueries, signToken, authRequired, authLimiter }) {
  const router = express.Router();

router.post('/register', authLimiter, async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = req.body?.password;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!isBcryptPassword(password)) {
      return res.status(400).json({ error: 'Password must be 6-72 UTF-8 bytes' });
    }
    if (username.length < 2 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 2-30 characters' });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const existingUser = userQueries.findByUsername.get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    const existingEmail = userQueries.findByEmail.get(email);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuid();

    userQueries.create.run(id, username, email, hashedPassword, 'user');

    const user = userQueries.findById.get(id);
    const token = signToken(user);

    res.status(201).json({ user, token });
  } catch (err) {
    req.log.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
    const password = req.body?.password;

    if (!login || login.length > 254 || typeof password !== 'string' || password.length > 256) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    // Login with username or email
    let user = userQueries.findByUsername.get(login);
    if (!user) user = userQueries.findByEmail.get(login);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    const { password: _, ...safeUser } = user;

    res.json({ user: safeUser, token });
  } catch (err) {
    req.log.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
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
      if (next.length < 2 || next.length > 30) {
        return res.status(400).json({ error: '用户名需为 2-30 个字符' });
      }
      if (next !== account.username) {
        const taken = userQueries.findByUsername.get(next);
        if (taken && taken.id !== account.id) {
          return res.status(409).json({ error: '该用户名已被占用' });
        }
        userQueries.updateUsername.run(next, account.id);
      }
    }

    if (wantsPassword) {
      if (!isBcryptPassword(newPassword)) {
        return res.status(400).json({ error: '新密码需为 6-72 个 UTF-8 字节' });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      userQueries.updatePassword.run(hashed, account.id);
    }

    // Return refreshed safe user + a new token (username is embedded in the JWT).
    const user = userQueries.findById.get(account.id);
    const token = signToken(user);
    res.json({ user, token });
  } catch (err) {
    req.log.error('Profile update error:', err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

  return router;
};
