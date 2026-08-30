require('dotenv').config();
// Load secrets from outside project directory (when not launched via start.sh)
require('dotenv').config({ path: require('os').homedir() + '/.ai-chat/secrets.env', override: false });

const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const { db, DB_PATH, userQueries, chatQueries, messageQueries, memoryQueries } = require('./db');
const { signToken, authRequired } = require('./auth');
const { DEFAULT_CHAT_MODEL, getAllModels, normalizeChatModel, streamChat } = require('./providers');
const { createLogger, createRootLogger } = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Leo';
const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const APP_MODE = process.env.APP_MODE || '';
const IS_SERVER_CHAT_ONLY = APP_MODE === 'server-chat-only';
const rootLogger = createRootLogger();
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS || 32000);
const MAX_SYSTEM_PROMPT_CHARS = Number(process.env.MAX_SYSTEM_PROMPT_CHARS || 16000);
const MAX_CHAT_TITLE_CHARS = Number(process.env.MAX_CHAT_TITLE_CHARS || 80);

// ── Middleware ──────────────────────────────────────────
function assertRuntimeConfig() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    const message = 'JWT_SECRET is using the development default. Set a strong JWT_SECRET in .env before exposing this service.';
    if (IS_PRODUCTION) {
      throw new Error(message);
    }
    rootLogger.warn(`JWT_SECRET is using the development default. Set a strong JWT_SECRET in ~/.ai-chat/secrets.env before exposing this service.`);
  }
}

function allowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return new Set([
    ...configured,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://[::1]:${PORT}`,
  ]);
}

const corsAllowList = allowedOrigins();
// Production traffic is forwarded by a loopback reverse proxy. Trusting only
// loopback keeps req.ip accurate for rate limiting without accepting arbitrary
// client supplied X-Forwarded-For values.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(cors({
  origin(origin, cb) {
    if (!origin || corsAllowList.has(origin)) return cb(null, true);
    return cb(null, false);
  },
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join('; '));
  next();
});
// Request ID — attach a UUID to every request for log correlation
app.use((req, res, next) => {
  req.id = uuid();
  req.log = createLogger(req);
  res.setHeader('X-Request-ID', req.id);
  next();
});
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || (IS_PRODUCTION ? '256kb' : '1mb') }));
// Serve built assets first (dist/), fall back to raw public/. Set SERVE_DIST=0 for dev.
const rawPublicPath = path.join(__dirname, 'public');
const distPath = path.join(rawPublicPath, 'dist');
const shouldServeDist = process.env.SERVE_DIST !== '0' && fs.existsSync(distPath);
app.use(express.static(shouldServeDist ? distPath : rawPublicPath));
if (shouldServeDist) {
  app.use(express.static(rawPublicPath));
}

const { createRateLimiter } = require('./lib/rate-limiter');

const authLimiter = createRateLimiter({
  name: 'auth',
  windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60 * 1000,
  max: process.env.AUTH_RATE_LIMIT_MAX || 30,
});
const chatLimiter = createRateLimiter({
  name: 'chat',
  windowMs: process.env.CHAT_RATE_LIMIT_WINDOW_MS || 60 * 1000,
  max: process.env.CHAT_RATE_LIMIT_MAX || 40,
});

// ── Core API modules ────────────────────────────────────
const createAuthRouter = require('./routes/auth');
const createChatRouter = require('./routes/chat');
const createMemoryModule = require('./routes/memory');
const createSearchModule = require('./routes/search');
const createStreamRouter = require('./routes/stream');

const memoryModule = createMemoryModule({
  memoryQueries,
  authRequired,
  isServerChatOnly: IS_SERVER_CHAT_ONLY,
  logger: rootLogger,
});
const searchModule = createSearchModule({
  authRequired,
  getAllModels,
  appMode: APP_MODE,
});

app.use('/api/auth', createAuthRouter({ userQueries, signToken, authRequired, authLimiter }));
app.use('/api/memories', memoryModule.router);
app.use('/api', searchModule.router);
app.use('/api', createChatRouter({
  authRequired,
  chatQueries,
  messageQueries,
  normalizeChatModel,
  maxChatTitleChars: MAX_CHAT_TITLE_CHARS,
  maxSystemPromptChars: MAX_SYSTEM_PROMPT_CHARS,
}));
app.use('/api', createStreamRouter({
  authRequired,
  chatLimiter,
  db,
  chatQueries,
  messageQueries,
  normalizeChatModel,
  defaultChatModel: DEFAULT_CHAT_MODEL,
  streamChat,
  memoryService: memoryModule.service,
  searchService: searchModule.service,
  maxMessageChars: MAX_MESSAGE_CHARS,
}));

// ── Mac Controller ──────────────────────────────────────
const CONTROL_PORT = Number(process.env.MAC_CONTROLLER_PORT || process.env.CONTROL_PORT || 5050);
const CONTROL_HOST = process.env.MAC_CONTROLLER_HOST || '127.0.0.1';
const CONTROL_PROXY_HOST = CONTROL_HOST === '0.0.0.0' ? '127.0.0.1' : CONTROL_HOST;
const CONTROL_URL = process.env.CONTROL_URL || `http://${CONTROL_PROXY_HOST}:${CONTROL_PORT}`;
const CONTROL_AUTO_START = !IS_SERVER_CHAT_ONLY && process.env.CONTROL_AUTO_START !== 'false';

// Start Python Mac Controller as child process
let controlProcess = null;
let controlHealthTimer = null;
let restartPromise = null;

function startControlServer() {
  const pyPath = path.join(__dirname, 'mac-controller', 'server.py');
  const venvPython = path.join(__dirname, 'mac-controller', '.venv', 'bin', 'python3');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
  if (!fs.existsSync(pyPath)) {
    rootLogger.warn('Mac Controller not found, skipping');
    return;
  }
  controlProcess = spawn(pythonCmd, [pyPath], {
    cwd: path.join(__dirname, 'mac-controller'),
    stdio: 'pipe',
  });
  controlProcess.stdout.on('data', (d) => process.stdout.write(`[control] ${d}`));
  controlProcess.stderr.on('data', (d) => process.stderr.write(`[control] ${d}`));
  controlProcess.on('exit', (code) => {
    rootLogger.warn(`Mac Controller exited (code ${code})`);
    controlProcess = null;
    // Auto-restart on unexpected exit (non-zero, not intentionally killed)
    if (code !== 0) scheduleRestart(3000);
  });
    rootLogger.info(`Mac Controller starting at ${CONTROL_URL}`);
}

// Serialized restart — prevents race between exit handler and health check
function scheduleRestart(delayMs) {
  if (restartPromise) return restartPromise;
  restartPromise = new Promise(resolve => {
    rootLogger.warn(`Restarting Mac Controller in ${delayMs / 1000}s...`);
    setTimeout(() => {
      startControlServer();
      restartPromise = null;
      resolve();
    }, delayMs);
  });
  return restartPromise;
}

// Periodic health check — verifies the controller is alive every 30s
function startControlHealthCheck() {
  if (controlHealthTimer) clearInterval(controlHealthTimer);
  controlHealthTimer = setInterval(async () => {
    try {
      const headers = {};
      if (process.env.CONTROL_INTERNAL_TOKEN) headers['X-Internal-Token'] = process.env.CONTROL_INTERNAL_TOKEN;
      const res = await fetch(`${CONTROL_URL}/api/volume`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      rootLogger.warn(`Control health check failed: ${err.message}`);
      // Only restart if process is actually gone (not just unresponsive briefly)
      if (!controlProcess) scheduleRestart(1000);
    }
  }, 30000);
}

// ── Server-chat-only guards ─────────────────────────────
let finderRoutes;
if (IS_SERVER_CHAT_ONLY) {
  app.use('/api/control', (req, res) => {
    res.status(403).json({ error: 'Control is disabled in server-chat-only mode.' });
  });
  app.use('/api/finder', (req, res) => {
    res.status(403).json({ error: 'Finder is disabled in server-chat-only mode.' });
  });
} else {
  // Control proxy — routes in ./routes/control.js
  const createControlRouter = require('./routes/control');
  app.use('/api/control', createControlRouter({ controlUrl: CONTROL_URL }));

  // ── Finder / File Browser ──────────────────────────────
  finderRoutes = require('./routes/finder');
  app.use('/api/finder', finderRoutes);
}

// ── SPA fallback ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(shouldServeDist ? distPath : rawPublicPath, 'index.html'));
});

// ── Start ───────────────────────────────────────────────
assertRuntimeConfig();
app.listen(PORT, HOST, () => {
  rootLogger.info(`Server running at http://${HOST}:${PORT}`);
  rootLogger.info(`Database: ${DB_PATH}`);

  const { loadProviders } = require('./providers');
  const providers = loadProviders();
  const configured = Object.values(providers).filter(p => p.configured);
  rootLogger.info(`Providers: ${configured.map(p => p.name).join(', ') || 'none'}`);
  rootLogger.info(`Models: ${getAllModels().length}`);
  if (!IS_SERVER_CHAT_ONLY) {
    rootLogger.info(`Finder root: ${finderRoutes.finderRoot || 'not configured'}`);
  }

  if (CONTROL_AUTO_START) {
    startControlServer();
    startControlHealthCheck();
  } else {
    rootLogger.info('Mac Controller auto-start disabled');
  }
});
