require('dotenv').config();

const http = require('http');

const PORT = Number(process.env.PORT || 3000);
const DISABLED_ERROR = 'This feature is disabled in cloud-lite mode.';

function request({ method = 'GET', path, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 3000,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => {
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function expectStatus(path, expected, options = {}) {
  const result = await request({ path, ...options });
  if (result.status !== expected) {
    throw new Error(`${path} expected ${expected}, got ${result.status}`);
  }
  return result;
}

async function main() {
  for (const path of ['/api/health', '/api/settings', '/api/models', '/api/conversations']) {
    await expectStatus(path, 200);
  }

  for (const path of ['/api/memory', '/api/terminal', '/api/control', '/api/files', '/api/system', '/api/mcp']) {
    const result = await expectStatus(path, 403);
    if (result.data?.error !== DISABLED_ERROR) {
      throw new Error(`${path} expected disabled error message`);
    }
  }

  console.log('api smoke ok');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
