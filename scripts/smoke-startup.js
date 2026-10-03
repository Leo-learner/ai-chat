const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const port = Number(process.env.SMOKE_STARTUP_PORT || (3200 + Math.floor(Math.random() * 1000)));
const timeoutMs = Number(process.env.SMOKE_STARTUP_TIMEOUT_MS || 9000);
const logs = [];

const child = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    SERVE_DIST: process.env.SERVE_DIST || '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function remember(chunk) {
  const text = String(chunk || '');
  logs.push(text);
  if (logs.join('').length > 12000) logs.shift();
}

child.stdout.on('data', remember);
child.stderr.on('data', remember);

function requestHome() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      timeout: 1200,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function stopServer() {
  if (child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 1000).unref();
}

async function main() {
  let exited = false;
  let exitCode = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitCode = signal || code;
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (exited) {
      throw new Error(`server exited before responding (${exitCode})\n${logs.join('')}`);
    }
    try {
      const status = await requestHome();
      if (status === 200) {
        stopServer();
        console.log(`startup smoke ok on port ${port}`);
        return;
      }
    } catch {
      // Keep polling until timeout; the server may still be booting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`server did not respond on port ${port} within ${timeoutMs}ms\n${logs.join('')}`);
}

main()
  .catch((err) => {
    stopServer();
    console.error(err.message || err);
    process.exit(1);
  });
