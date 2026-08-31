const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const { jsonRequest, startAppFixture } = require('./helpers/app-fixture');

test('login rejects requests beyond the configured authentication budget', async () => {
  const fixture = await startAppFixture({ rateLimitDisabled: false, authRateLimitMax: 2 });
  try {
    const db = new Database(fixture.dbPath);
    db.prepare('INSERT INTO users (id, username, email, password, role) VALUES (?, ?, ?, ?, ?)')
      .run('rate-user-id', 'rate-user', 'rate-user@example.test', bcrypt.hashSync('correct-horse', 4), 'user');
    db.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await jsonRequest(fixture.baseUrl, '/api/auth/login', {
        method: 'POST',
        body: { login: 'rate-user', password: 'wrong-password' },
      });
      assert.equal(result.response.status, 401);
    }

    const limited = await jsonRequest(fixture.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { login: 'rate-user', password: 'correct-horse' },
    });
    assert.equal(limited.response.status, 429);
    assert.match(limited.payload.error, /Too many requests/i);
    assert.ok(Number(limited.response.headers.get('retry-after')) >= 1);
  } finally {
    await fixture.close();
  }
});
