const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..', '..');

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

async function waitForServer(baseUrl, logs, timeoutMs = 9000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`server startup timed out\n${logs.join('').slice(-6000)}`);
}

function createProviderServer() {
  const callsByPrompt = new Map();
  const pendingTimers = new Set();
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(raw || '{}');
      const prompt = [...(payload.messages || [])].reverse().find(message => message.role === 'user')?.content || '';
      const callNumber = (callsByPrompt.get(prompt) || 0) + 1;
      callsByPrompt.set(prompt, callNumber);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const writeContent = content => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      };
      const finish = () => {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { total_tokens: 3 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      };

      if (prompt === 'slow-stop') {
        writeContent('部分响应');
        const timer = setTimeout(() => {
          pendingTimers.delete(timer);
          writeContent('不应落库');
          finish();
        }, 1500);
        pendingTimers.add(timer);
        res.once('close', () => {
          clearTimeout(timer);
          pendingTimers.delete(timer);
        });
        return;
      }

      if (prompt === 'original-question') {
        writeContent(callNumber === 1 ? '旧答案' : '新答案');
        finish();
        return;
      }

      writeContent('发送成功');
      finish();
    });
  });

  return {
    server,
    callsByPrompt,
    close: async () => {
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function startAppFixture({ rateLimitDisabled = true, authRateLimitMax = 30 } = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-chat-core-test-'));
  const dbPath = path.join(tempRoot, 'chat.db');
  const logs = [];
  const provider = createProviderServer();
  const providerPort = await listen(provider.server);

  const portProbe = http.createServer();
  const appPort = await listen(portProbe);
  await new Promise(resolve => portProbe.close(resolve));

  const appProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(appPort),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      SERVE_DIST: '0',
      RATE_LIMIT_DISABLED: rateLimitDisabled ? 'true' : 'false',
      AUTH_RATE_LIMIT_MAX: String(authRateLimitMax),
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
      DB_PATH: dbPath,
      JWT_SECRET: 'core-test-secret-with-more-than-32-characters',
      OPENROUTER_API_KEY: 'core-test-key',
      OPENROUTER_BASE_URL: `http://127.0.0.1:${providerPort}/api/v1`,
      DEFAULT_CHAT_MODEL: 'openrouter/free',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  appProcess.stdout.on('data', chunk => logs.push(String(chunk)));
  appProcess.stderr.on('data', chunk => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(baseUrl, logs);

  return {
    baseUrl,
    dbPath,
    logs,
    provider,
    close: async () => {
      stopChild(appProcess);
      await provider.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

async function jsonRequest(baseUrl, pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function parseSse(body) {
  return String(body || '')
    .split(/\n\n+/)
    .flatMap(block => block.split(/\r?\n/))
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => JSON.parse(line.slice(6)));
}

module.exports = { jsonRequest, parseSse, startAppFixture };
