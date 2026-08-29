require('dotenv').config();

const http = require('http');
const jwt = require('jsonwebtoken');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

require('dotenv').config({ path: path.join(os.homedir(), '.ai-chat', 'secrets.env'), override: false });

const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chat.db');
const SERVER_CHAT_ONLY = process.env.APP_MODE === 'server-chat-only';

if (!process.env.JWT_SECRET || SECRET === 'dev-secret-change-me') {
  console.error('JWT_SECRET is required for smoke:auth. Put it in ~/.ai-chat/secrets.env or export it before running this check.');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const endpoints = [
  { method: 'GET', path: '/api/control/volume' },
  { method: 'GET', path: '/api/finder/list' },
  { method: 'POST', path: '/api/control/terminal/run', body: {} },
];

function request({ method, path, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 3000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const normalUser = db.prepare("SELECT id, username FROM users WHERE role = 'user' LIMIT 1").get();
  if (!normalUser) {
    console.log('No normal user found; checked anonymous 401 only.');
  }
  const userToken = normalUser
    ? jwt.sign({ id: normalUser.id, username: normalUser.username }, SECRET, { expiresIn: '5m' })
    : null;

  for (const endpoint of endpoints) {
    const anonymousStatus = await request(endpoint);
    const expectedAnonymous = SERVER_CHAT_ONLY ? 403 : 401;
    if (anonymousStatus !== expectedAnonymous) {
      throw new Error(`${endpoint.method} ${endpoint.path} expected anonymous ${expectedAnonymous}, got ${anonymousStatus}`);
    }
    if (userToken) {
      const userStatus = await request({ ...endpoint, token: userToken });
      if (userStatus !== 403) {
        throw new Error(`${endpoint.method} ${endpoint.path} expected user 403, got ${userStatus}`);
      }
    }
  }
  console.log('auth smoke ok');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
