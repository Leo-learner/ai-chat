const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-security-'));
const dbPath = path.join(tempRoot, 'chat.db');
const logs = [];
let appProcess;
let providerServer;
let embeddingCalls = 0;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1000).unref();
}

async function waitForServer(baseUrl, timeoutMs = 9000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server startup timed out\n${logs.join('').slice(-6000)}`);
}

async function jsonRequest(baseUrl, pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  providerServer = http.createServer((req, res) => {
    if (req.url === '/api/embed') {
      embeddingCalls += 1;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ embedding: [1, 0, 0] }));
      }, 3000);
      return;
    }
    if (req.url === '/api/v1/chat/completions') {
      req.resume();
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end([
            'data: {"choices":[{"delta":{"content":"安全响应"}}]}',
            '',
            'data: {"choices":[{"finish_reason":"stop"}],"usage":{"total_tokens":2}}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'));
        }, 250);
      });
      return;
    }
    res.writeHead(404).end();
  });
  const providerPort = await listen(providerServer);

  const portProbe = http.createServer();
  const appPort = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));

  appProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SERVE_DIST: '0',
      RATE_LIMIT_DISABLED: 'true',
      DB_PATH: dbPath,
      JWT_SECRET: 'smoke-only-secret-with-more-than-32-characters',
      OPENROUTER_API_KEY: 'smoke-key',
      OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/api/v1`,
      DEFAULT_CHAT_MODEL: 'openrouter/free',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  appProcess.stdout.on('data', chunk => logs.push(String(chunk)));
  appProcess.stderr.on('data', chunk => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(baseUrl);

  const home = await fetch(baseUrl);
  const csp = home.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');

  const rejectedOrigin = await fetch(baseUrl, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);
  const allowedOrigin = await fetch(baseUrl, { headers: { Origin: baseUrl } });
  assert.equal(allowedOrigin.headers.get('access-control-allow-origin'), baseUrl);

  const disabledMemory = await fetch(`${baseUrl}/api/memories/health`);
  assert.equal(disabledMemory.status, 403);
  for (const disabledPath of ['/api/control/volume', '/api/finder/list']) {
    const disabledResponse = await fetch(`${baseUrl}${disabledPath}`);
    assert.equal(disabledResponse.status, 403);
  }

  const oversized = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'u', email: 'u@example.test', password: 'x'.repeat(270_000) }),
  });
  assert.equal(oversized.status, 413);

  const registration = await jsonRequest(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { username: 'security-smoke', email: 'security@example.test', password: 'correct-horse' },
  });
  assert.equal(registration.response.status, 201);
  const token = registration.payload.token;
  assert.ok(token);

  const badTitle = await jsonRequest(baseUrl, '/api/chats', {
    method: 'POST',
    token,
    body: { title: 'x'.repeat(81) },
  });
  assert.equal(badTitle.response.status, 400);

  const created = await jsonRequest(baseUrl, '/api/chats', {
    method: 'POST',
    token,
    body: { title: 'Security smoke' },
  });
  assert.equal(created.response.status, 201);
  const chatId = created.payload.chat.id;

  const tooLong = await jsonRequest(baseUrl, `/api/chats/${chatId}/messages`, {
    method: 'POST',
    token,
    body: { content: 'x'.repeat(32_001) },
  });
  assert.equal(tooLong.response.status, 400);

  const startedAt = Date.now();
  const streamed = await fetch(`${baseUrl}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '测试首包延迟' }),
  });
  const headerLatencyMs = Date.now() - startedAt;
  assert.equal(streamed.status, 200);
  assert.ok(headerLatencyMs < 1000, `SSE headers took ${headerLatencyMs}ms`);
  const streamBody = await streamed.text();
  assert.match(streamBody, /^: connected/m);
  assert.match(streamBody, /安全响应/);
  assert.equal(embeddingCalls, 0, 'server chat mode must not call the embedding service');

  console.log(`security and latency smoke ok (SSE headers ${headerLatencyMs}ms, embedding calls ${embeddingCalls})`);
}

main()
  .catch(error => {
    console.error(error.stack || error);
    console.error(logs.join('').slice(-6000));
    process.exitCode = 1;
  })
  .finally(async () => {
    stopChild(appProcess);
    if (providerServer) await new Promise(resolve => providerServer.close(resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
