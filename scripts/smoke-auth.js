require('dotenv').config();

const http = require('http');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.APP_ACCESS_TOKEN || '';

if (!TOKEN) {
  console.error('APP_ACCESS_TOKEN is required for smoke:auth.');
  process.exit(1);
}

function request({ method = 'GET', path, token = '', body = null }) {
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
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const anonymous = await request({ path: '/api/settings' });
  if (anonymous !== 401) throw new Error(`/api/settings expected anonymous 401, got ${anonymous}`);

  const authorized = await request({ path: '/api/settings', token: TOKEN });
  if (authorized !== 200) throw new Error(`/api/settings expected authorized 200, got ${authorized}`);

  for (const path of ['/api/memories', '/api/control/volume', '/api/finder/list', '/api/terminal/run', '/api/mcp']) {
    const status = await request({ path, token: TOKEN, method: path.includes('terminal') ? 'POST' : 'GET', body: path.includes('terminal') ? {} : null });
    if (status !== 403) throw new Error(`${path} expected disabled 403, got ${status}`);
  }

  console.log('auth smoke ok');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
