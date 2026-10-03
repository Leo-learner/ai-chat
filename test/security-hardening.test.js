const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const { jsonRequest, parseSse, startAppFixture } = require('./helpers/app-fixture');

const FIXTURE_JWT_SECRET = 'core-test-secret-with-more-than-32-characters';

async function withFixture(options, run) {
  const fixture = await startAppFixture(options);
  try {
    await run(fixture, (pathname, requestOptions) => jsonRequest(fixture.baseUrl, pathname, requestOptions));
  } finally {
    await fixture.close();
  }
}

async function register(request, username, overrides = {}) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email: `${username}@example.test`, password: 'correct-horse', ...overrides },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload;
}

function setRole(fixture, userId, role) {
  const db = new Database(fixture.dbPath);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  db.close();
}

test('registration is closed by default and invite mode requires a configured code', async () => {
  await withFixture({ env: { REGISTRATION_MODE: '' } }, async (fixture, request) => {
    assert.deepEqual((await request('/api/auth/config')).payload, { registration: 'closed' });
    const closed = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'stranger', email: 'stranger@example.test', password: 'correct-horse' },
    });
    assert.equal(closed.response.status, 403);
  });

  await withFixture({ env: { REGISTRATION_MODE: 'invite', REGISTRATION_INVITE_CODES: 'alpha-code, beta-code' } }, async (fixture, request) => {
    assert.deepEqual((await request('/api/auth/config')).payload, { registration: 'invite' });
    for (const inviteCode of [undefined, '', 'gamma-code']) {
      const denied = await request('/api/auth/register', {
        method: 'POST',
        body: { username: 'guest', email: 'guest@example.test', password: 'correct-horse', inviteCode },
      });
      assert.equal(denied.response.status, 403);
    }
    await register(request, 'friend', { inviteCode: 'beta-code' });
  });
});

test('account identifiers are validated and emails are case-insensitive', async () => {
  await withFixture({}, async (fixture, request) => {
    for (const username of ['victim@example.test', 'zero​width', 'line break']) {
      const rejected = await request('/api/auth/register', {
        method: 'POST',
        body: { username, email: 'other@example.test', password: 'correct-horse' },
      });
      assert.equal(rejected.response.status, 400, username);
    }
    const shortPassword = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'shorty', email: 'shorty@example.test', password: 'seven77' },
    });
    assert.equal(shortPassword.response.status, 400);

    const created = await register(request, 'mixed', { email: 'Mixed.Case@Example.TEST' });
    assert.equal(created.user.email, 'mixed.case@example.test');
    const duplicate = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'mixed2', email: 'MIXED.CASE@example.test', password: 'correct-horse' },
    });
    assert.equal(duplicate.response.status, 409);
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { login: 'MIXED.CASE@EXAMPLE.TEST', password: 'correct-horse' },
    });
    assert.equal(login.response.status, 200);

    const rename = await request('/api/auth/profile', {
      method: 'PATCH',
      token: created.token,
      body: { currentPassword: 'correct-horse', newUsername: 'someone@example.test' },
    });
    assert.equal(rename.response.status, 400);
  });
});

test('password changes and sign-out-everywhere revoke existing tokens', async () => {
  await withFixture({}, async (fixture, request) => {
    const { user, token: firstToken } = await register(request, 'session-user');
    const secondLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { login: 'session-user', password: 'correct-horse' },
    });
    const secondToken = secondLogin.payload.token;
    // Tokens issued before token_version existed carry no `tv` claim.
    const legacyToken = jwt.sign({ id: user.id, username: user.username }, FIXTURE_JWT_SECRET, { expiresIn: '1h' });
    assert.equal((await request('/api/auth/me', { token: legacyToken })).response.status, 200);

    const changed = await request('/api/auth/profile', {
      method: 'PATCH',
      token: firstToken,
      body: { currentPassword: 'correct-horse', newPassword: 'battery-staple' },
    });
    assert.equal(changed.response.status, 200);
    for (const staleToken of [firstToken, secondToken, legacyToken]) {
      assert.equal((await request('/api/auth/me', { token: staleToken })).response.status, 401);
    }
    const currentToken = changed.payload.token;
    assert.equal((await request('/api/auth/me', { token: currentToken })).response.status, 200);

    assert.equal((await request('/api/auth/logout-all', { method: 'POST', token: currentToken, body: {} })).response.status, 200);
    assert.equal((await request('/api/auth/me', { token: currentToken })).response.status, 401);
  });
});

test('account deletion requires the password and removes all owned data', async () => {
  await withFixture({}, async (fixture, request) => {
    const { user, token } = await register(request, 'leaving-user');
    const chat = await request('/api/chats', { method: 'POST', token, body: { title: 'to be deleted' } });
    const streamed = await fetch(`${fixture.baseUrl}/api/chats/${chat.payload.chat.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'send-check' }),
    });
    assert.ok(parseSse(await streamed.text()).some(event => event.type === 'done'));

    const wrong = await request('/api/auth/delete-account', { method: 'POST', token, body: { currentPassword: 'nope-nope' } });
    assert.equal(wrong.response.status, 400);
    const deleted = await request('/api/auth/delete-account', { method: 'POST', token, body: { currentPassword: 'correct-horse' } });
    assert.equal(deleted.response.status, 200);

    assert.equal((await request('/api/auth/me', { token })).response.status, 401);
    const db = new Database(fixture.dbPath, { readonly: true });
    for (const [table, column] of [['users', 'id'], ['chats', 'user_id'], ['user_daily_usage', 'user_id']]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(user.id).count, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?').get(chat.payload.chat.id).count, 0);
    db.close();
  });
});

test('repeated login failures lock the account for that client only', async () => {
  await withFixture({ rateLimitDisabled: false, authRateLimitMax: 100 }, async (fixture, request) => {
    await register(request, 'target-user');
    const attacker = { 'X-Forwarded-For': '198.51.100.7' };
    for (let attempt = 0; attempt < 5; attempt++) {
      const failed = await request('/api/auth/login', {
        method: 'POST',
        headers: attacker,
        body: { login: 'target-user', password: `wrong-${attempt}` },
      });
      assert.equal(failed.response.status, 401);
    }
    const locked = await request('/api/auth/login', {
      method: 'POST',
      headers: attacker,
      body: { login: 'target-user', password: 'correct-horse' },
    });
    assert.equal(locked.response.status, 429);
    assert.ok(Number(locked.response.headers.get('retry-after')) >= 1);

    const owner = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.9' },
      body: { login: 'target-user', password: 'correct-horse' },
    });
    assert.equal(owner.response.status, 200);
  });
});

test('chat writes are rate limited and capped per user, admins excepted', async () => {
  await withFixture({ rateLimitDisabled: false, env: { MAX_CHATS_PER_USER: '2', CHAT_WRITE_RATE_LIMIT_MAX: '4' } }, async (fixture, request) => {
    const { user, token } = await register(request, 'busy-user');
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await request('/api/chats', { method: 'POST', token, body: { title: `chat ${i}` } })).response.status);
    }
    assert.deepEqual(statuses, [201, 201, 409]);

    setRole(fixture, user.id, 'admin');
    assert.equal((await request('/api/chats', { method: 'POST', token, body: { title: 'admin chat' } })).response.status, 201);
    assert.equal((await request('/api/chats', { method: 'POST', token, body: { title: 'over budget' } })).response.status, 429);
  });
});

test('chat list omits system prompts while the chat detail keeps them', async () => {
  await withFixture({}, async (fixture, request) => {
    const { token } = await register(request, 'prompt-user');
    const created = await request('/api/chats', { method: 'POST', token, body: { title: 'With prompt', system_prompt: 'Be terse.' } });
    const list = await request('/api/chats', { token });
    assert.equal(list.payload.chats.length, 1);
    assert.equal('system_prompt' in list.payload.chats[0], false);
    const detail = await request(`/api/chats/${created.payload.chat.id}`, { token });
    assert.equal(detail.payload.chat.system_prompt, 'Be terse.');
  });
});

test('daily message quota and concurrent stream cap are enforced per user', async () => {
  await withFixture({ env: { CHAT_DAILY_MESSAGE_LIMIT: '2', CHAT_MAX_CONCURRENT_STREAMS: '1' } }, async (fixture, request) => {
    const { user, token } = await register(request, 'quota-user');
    const chat = (await request('/api/chats', { method: 'POST', token, body: { title: 'Quota' } })).payload.chat;
    const send = (content, signal) => fetch(`${fixture.baseUrl}/api/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal,
    });

    const slow = await send('slow-stop');
    const reader = slow.body.getReader();
    await reader.read();
    const concurrent = await send('send-check');
    assert.equal(concurrent.status, 429);
    assert.match((await concurrent.json()).error, /正在生成/);
    while (!(await reader.read()).done) { /* drain the slow answer */ }

    const second = await send('send-check');
    assert.equal(second.status, 200);
    await second.text();
    const overQuota = await send('send-check');
    assert.equal(overQuota.status, 429);
    assert.match((await overQuota.json()).error, /额度/);

    setRole(fixture, user.id, 'admin');
    const adminSend = await send('send-check');
    assert.equal(adminSend.status, 200);
    await adminSend.text();
  });
});

test('security headers: strict style policy everywhere, HSTS only behind HTTPS', async () => {
  await withFixture({}, async (fixture) => {
    const plain = await fetch(fixture.baseUrl);
    assert.match(plain.headers.get('content-security-policy'), /style-src 'self'(;|$)/);
    assert.equal(plain.headers.get('strict-transport-security'), null);
    const proxied = await fetch(fixture.baseUrl, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(proxied.headers.get('strict-transport-security'), 'max-age=31536000');
  });
});

test('provider configuration is read from disk once per process', () => {
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api/v1';
  process.env.OPENROUTER_API_KEY = 'test-key';
  const fs = require('fs');
  const originalReadFileSync = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function countingReadFileSync(file, ...rest) {
    if (String(file).endsWith('providers.json')) reads += 1;
    return originalReadFileSync.call(this, file, ...rest);
  };
  try {
    const providers = require('../providers');
    for (let i = 0; i < 100; i++) providers.normalizeChatModel('openrouter/free');
    providers.getAllModels();
    assert.equal(reads, 1);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});
