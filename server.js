require('dotenv').config();
// Load secrets from outside project directory (when not launched via start.sh)
require('dotenv').config({ path: require('os').homedir() + '/.ai-chat/secrets.env', override: false });

const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');
const { readIntegerEnv } = require('./lib/validation');
const { validateDist } = require('./lib/static-assets');

const { signToken, authRequired } = require('./auth');
const { DEFAULT_CHAT_MODEL, getAllModels, normalizeChatModel, streamChat } = require('./providers');
const { createLogger, createRootLogger } = require('./lib/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_JWT_SECRET = 'dev-secret-change-me';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const rootLogger = createRootLogger();
const MAX_MESSAGE_CHARS = readIntegerEnv('MAX_MESSAGE_CHARS', 32000, { min: 1, max: 200000 });
const MAX_SYSTEM_PROMPT_CHARS = readIntegerEnv('MAX_SYSTEM_PROMPT_CHARS', 16000, { min: 1, max: 100000 });
const MAX_CHAT_TITLE_CHARS = readIntegerEnv('MAX_CHAT_TITLE_CHARS', 80, { min: 1, max: 500 });
const MODEL_TIMEOUTS = {
  firstByteMs: readIntegerEnv('MODEL_FIRST_BYTE_TIMEOUT_MS', 30000, { min: 100, max: 300000 }),
  idleMs: readIntegerEnv('MODEL_STREAM_IDLE_TIMEOUT_MS', 45000, { min: 100, max: 300000 }),
  totalMs: readIntegerEnv('MODEL_TOTAL_TIMEOUT_MS', 300000, { min: 1000, max: 1800000 }),
};
const { db, DB_PATH, userQueries, chatQueries, messageQueries } = require('./db');

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
app.disable('x-powered-by');
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
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
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
// Production serves only verified build artifacts. Raw modules are available
// solely in local development with SERVE_DIST=0.
const rawPublicPath = path.join(__dirname, 'public');
const distPath = path.join(rawPublicPath, 'dist');
if (IS_PRODUCTION && process.env.SERVE_DIST === '0') {
  throw new Error('SERVE_DIST=0 is not allowed in production');
}
const shouldServeDist = process.env.SERVE_DIST !== '0' && fs.existsSync(distPath);
if (IS_PRODUCTION && !shouldServeDist) {
  throw new Error('Production frontend build is missing');
}
if (shouldServeDist) validateDist(distPath);
app.use(express.static(shouldServeDist ? distPath : rawPublicPath));

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

const memoryModule = createMemoryModule();
const searchModule = createSearchModule({
  authRequired,
  getAllModels,
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
  modelTimeouts: MODEL_TIMEOUTS,
}));

// Keep explicit denials for legacy endpoints so old clients fail closed.
app.use('/api/control', (req, res) => {
  res.status(403).json({ error: 'Control is unavailable on the server build.' });
});
app.use('/api/finder', (req, res) => {
  res.status(403).json({ error: 'Finder is unavailable on the server build.' });
});
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ── SPA fallback ────────────────────────────────────────
app.get('*', (req, res) => {
  if (path.extname(req.path) || !req.accepts('html')) {
    return res.status(404).type('text').send('Not found');
  }
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
});
