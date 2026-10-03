const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { validateDist } = require('../lib/static-assets');

const projectRoot = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, child, logs) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(logs.join(''));
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`production server did not start\n${logs.join('')}`);
}

test('dist validation rejects a modified required asset', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-dist-'));
  try {
    fs.cpSync(path.join(projectRoot, 'public', 'dist'), tempRoot, { recursive: true });
    fs.appendFileSync(path.join(tempRoot, 'app.min.js'), '\n// tampered');
    assert.throws(() => validateDist(tempRoot), /checksum mismatch/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('production refuses raw frontend mode and invalid numeric limits', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-prod-invalid-'));
  try {
    const baseEnv = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-with-at-least-32-chars',
      DB_PATH: path.join(tempRoot, 'chat.db'),
    };
    const raw = spawnSync(process.execPath, ['server.js'], {
      cwd: projectRoot,
      env: { ...baseEnv, SERVE_DIST: '0' },
      encoding: 'utf8',
    });
    assert.notEqual(raw.status, 0);
    assert.match(raw.stderr, /SERVE_DIST=0 is not allowed/);

    const invalid = spawnSync(process.execPath, ['server.js'], {
      cwd: projectRoot,
      env: { ...baseEnv, MAX_MESSAGE_CHARS: 'not-a-number' },
      encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /MAX_MESSAGE_CHARS must be an integer/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('production serves verified dist assets without exposing source modules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-prod-'));
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SERVE_DIST: '1',
      PORT: String(port),
      HOST: '127.0.0.1',
      JWT_SECRET: 'production-test-secret-with-at-least-32-chars',
      DB_PATH: path.join(tempRoot, 'chat.db'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => logs.push(String(chunk)));
  child.stderr.on('data', chunk => logs.push(String(chunk)));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitFor(baseUrl, child, logs);
    const home = await fetch(baseUrl);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('x-powered-by'), null);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await fetch(`${baseUrl}/app.min.js`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/app.mjs`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/modules/state.mjs`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/not-real`)).status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
