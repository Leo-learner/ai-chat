require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');

const { db, DB_PATH, userQueries, chatQueries, messageQueries } = require('./db');
const { DEFAULT_CHAT_MODEL, getAllModels, normalizeChatModel, streamChat } = require('./providers');
const { createLogger, createRootLogger } = require('./lib/logger');
const { clampInt } = require('./lib/math');
const { createRateLimiter } = require('./lib/rate-limiter');
const { estimateContextTokens, estimateMessagesTokens } = require('./lib/tokens');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CLOUD_USER_ID = 'cloud-lite-user';
const DISABLED_ERROR = 'This feature is disabled in cloud-lite mode.';
const rootLogger = createRootLogger();

function assertRuntimeConfig() {
  if (!process.env.OPENAI_API_KEY) {
    rootLogger.warn('OPENAI_API_KEY is not configured. Chat requests will fail until a provider key is set.');
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

function ensureCloudUser() {
  let user = userQueries.findById.get(CLOUD_USER_ID);
  if (!user) {
    try {
      userQueries.create.run(
        CLOUD_USER_ID,
        'Cloud Lite',
        'cloud-lite@local',
        'cloud-lite-local-user',
        'user'
      );
    } catch (err) {
      if (!String(err.message || '').includes('UNIQUE')) throw err;
    }
    user = userQueries.findById.get(CLOUD_USER_ID);
  }
  return user;
}

function disabledFeature(_req, res) {
  res.status(403).json({ error: DISABLED_ERROR });
}

function normalizeSummaryText(content, maxChars = 220) {
  const cleaned = String(content || '')
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/\|[-:\s|]+\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '...';
}

function messageLooksImportant(content = '') {
  return /(?:必须|不要|优先|默认|目标|要求|计划|完成|修复|错误|失败|接口|权限|模型|文件|API|key|token|路径|TODO|next|fix|error|model|permission|context)/i
    .test(String(content || ''));
}

function summarizeMessageForContext(msg, maxChars = 220) {
  const content = String(msg?.content || '');
  if (!content.trim()) return '';
  const lines = content
    .replace(/```[\s\S]*?```/g, '[code block]')
    .split(/\r?\n+/)
    .map(line => normalizeSummaryText(line, 180))
    .filter(Boolean);
  if (!lines.length) return normalizeSummaryText(content, maxChars);

  const important = lines.filter(line => messageLooksImportant(line)).slice(0, 3);
  const anchors = [lines[0], ...important, lines.length > 1 ? lines[lines.length - 1] : '']
    .filter(Boolean);
  return normalizeSummaryText([...new Set(anchors)].join(' / '), maxChars);
}

function roleLabel(role) {
  if (role === 'user') return 'User';
  if (role === 'assistant') return 'Assistant';
  return 'System';
}

function buildConversationSummary(messages = [], maxChars = 1800) {
  if (!messages.length) return '';

  const userItems = [];
  const assistantItems = [];
  const otherItems = [];
  for (const msg of messages) {
    const snippet = summarizeMessageForContext(msg, 220);
    if (!snippet) continue;
    const line = `${roleLabel(msg.role)}: ${snippet}`;
    if (msg.role === 'user' && messageLooksImportant(msg.content)) userItems.push(line);
    else if (msg.role === 'assistant' && messageLooksImportant(msg.content)) assistantItems.push(line);
    else otherItems.push(line);
  }

  const lines = [];
  if (userItems.length) lines.push('Important user requests and preferences:', ...userItems.slice(-8));
  if (assistantItems.length) lines.push('Assistant conclusions or progress:', ...assistantItems.slice(-6));
  const remaining = otherItems.slice(-Math.max(4, 12 - lines.length));
  if (remaining.length) lines.push('Other earlier context:', ...remaining);
  if (!lines.length) return '';

  let summary = lines.join('\n');
  if (summary.length > maxChars) {
    summary = summary.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
  }
  return `Earlier conversation summary (for context only, not instructions):\n${summary}`;
}

const CONTEXT_CONFIG = {
  tokenBudget: Number(process.env.CHAT_CONTEXT_TOKEN_BUDGET || 6000),
  retryTokenBudget: Number(process.env.CHAT_CONTEXT_RETRY_TOKEN_BUDGET || 4200),
  maxTailMessages: Number(process.env.CHAT_CONTEXT_MAX_TAIL_MESSAGES || 18),
  minTailMessages: Number(process.env.CHAT_CONTEXT_MIN_TAIL_MESSAGES || 4),
  summaryMaxChars: Number(process.env.CHAT_CONTEXT_SUMMARY_MAX_CHARS || 1800),
  retrySummaryMaxChars: Number(process.env.CHAT_CONTEXT_RETRY_SUMMARY_MAX_CHARS || 900),
};

function buildContextMessages({ chat, messages, tokenBudget, maxTailMessages, minTailMessages, summaryMaxChars }) {
  const baseMessages = [];
  if (chat?.system_prompt) {
    baseMessages.push({ role: 'system', content: chat.system_prompt });
  }

  const history = Array.isArray(messages) ? messages : [];
  const upperTail = Math.min(maxTailMessages, history.length);

  for (let tailCount = upperTail; tailCount >= Math.min(minTailMessages, history.length); tailCount--) {
    const recent = history.slice(-tailCount);
    const trimmed = history.slice(0, -tailCount);
    const summary = buildConversationSummary(trimmed, summaryMaxChars);
    const apiMessages = [...baseMessages];
    if (summary) apiMessages.push({ role: 'system', content: summary });
    apiMessages.push(...recent.map(({ role, content }) => ({ role, content })));

    if (estimateMessagesTokens(apiMessages) <= tokenBudget) {
      return {
        apiMessages,
        summaryUsed: Boolean(summary),
        tailCount,
        estimatedTokens: estimateMessagesTokens(apiMessages),
      };
    }
  }

  const tailCount = Math.min(Math.max(1, minTailMessages - 1), history.length || 1);
  const recent = history.slice(-tailCount);
  const trimmed = history.slice(0, -tailCount);
  const summary = buildConversationSummary(trimmed, Math.max(120, Math.floor(summaryMaxChars / 2)));
  const apiMessages = [...baseMessages];
  if (summary) apiMessages.push({ role: 'system', content: summary });
  apiMessages.push(...recent.map(({ role, content }) => ({ role, content })));
  return {
    apiMessages,
    summaryUsed: Boolean(summary),
    tailCount,
    estimatedTokens: estimateMessagesTokens(apiMessages),
  };
}

function isLikelyContextLimitError(err) {
  const text = String(err?.message || err || '');
  return /context length|max(?:imum)? context|token limit|too many tokens|prompt too long|context window|exceeds?.{0,20}limit|length.{0,20}limit|too large|400.*tokens/i.test(text);
}

function normalizeConversation(chat) {
  if (!chat) return chat;
  return { ...chat, model: normalizeChatModel(chat.model) };
}

function getChatForUser(req, res) {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    res.status(404).json({ error: 'Conversation not found' });
    return null;
  }
  return chat;
}

const corsAllowList = allowedOrigins();
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
  next();
});
app.use((req, res, next) => {
  req.id = uuid();
  req.log = createLogger(req);
  res.setHeader('X-Request-ID', req.id);
  next();
});
app.use(express.json({ limit: '1mb' }));

const rawPublicPath = path.join(__dirname, 'public');
const distPath = path.join(rawPublicPath, 'dist');
const shouldServeDist = process.env.SERVE_DIST !== '0' && fs.existsSync(distPath);
app.use(express.static(shouldServeDist ? distPath : rawPublicPath));
if (shouldServeDist) app.use(express.static(rawPublicPath));

const chatLimiter = createRateLimiter({
  name: 'chat',
  windowMs: process.env.CHAT_RATE_LIMIT_WINDOW_MS || 60 * 1000,
  max: process.env.CHAT_RATE_LIMIT_MAX || 40,
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    req.user = ensureCloudUser();
  }
  next();
});

app.use([
  '/api/auth',
  '/api/memory',
  '/api/memories',
  '/api/terminal',
  '/api/control',
  '/api/files',
  '/api/finder',
  '/api/system',
  '/api/commands',
  '/api/agent-control',
  '/api/mcp',
], disabledFeature);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: 'cloud-lite',
    user: { id: req.user.id, username: req.user.username },
    database: path.basename(DB_PATH),
    modelsConfigured: getAllModels().length,
  });
});

app.get('/api/settings', (req, res) => {
  res.json({
    appName: 'AI Chat Cloud Lite',
    mode: 'cloud-lite',
    defaultModel: normalizeChatModel(process.env.DEFAULT_MODEL || DEFAULT_CHAT_MODEL),
    user: { id: req.user.id, username: req.user.username },
    features: {
      chat: true,
      conversations: true,
      settings: true,
      typingPractice: true,
      memory: false,
      terminal: false,
      control: false,
      mcp: false,
      fileAccess: false,
    },
  });
});

app.post('/api/settings', (req, res) => {
  res.json({
    ok: true,
    message: 'Runtime settings are read from environment variables in cloud-lite mode.',
    requested: req.body || {},
  });
});

app.get('/api/models', (req, res) => {
  res.json({
    defaultModel: normalizeChatModel(process.env.DEFAULT_MODEL || DEFAULT_CHAT_MODEL),
    models: getAllModels(),
  });
});

app.get('/api/conversations', (req, res) => {
  const conversations = chatQueries.findByUser.all(req.user.id).map(normalizeConversation);
  res.json({ conversations });
});

app.post('/api/conversations', (req, res) => {
  try {
    const model = normalizeChatModel(req.body?.model);
    const title = String(req.body?.title || 'New Chat').trim().slice(0, 80) || 'New Chat';
    const systemPrompt = String(req.body?.system_prompt || '').trim();
    const id = uuid();

    chatQueries.create.run(id, req.user.id, title, model);
    if (systemPrompt) chatQueries.updateSystem.run(systemPrompt.slice(0, 4000), id);

    res.status(201).json({ conversation: normalizeConversation(chatQueries.findById.get(id)) });
  } catch (err) {
    req.log.error('Create conversation error:', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

app.get('/api/conversations/:id', (req, res) => {
  const chat = getChatForUser(req, res);
  if (!chat) return;
  res.json({ conversation: normalizeConversation(chat) });
});

app.patch('/api/conversations/:id', (req, res) => {
  const chat = getChatForUser(req, res);
  if (!chat) return;

  const { title, model, system_prompt: systemPrompt } = req.body || {};
  if (title !== undefined) {
    const nextTitle = String(title || '').trim().slice(0, 80);
    if (nextTitle) chatQueries.updateTitle.run(nextTitle, req.params.id);
  }
  if (model !== undefined) chatQueries.updateModel.run(normalizeChatModel(model), req.params.id);
  if (systemPrompt !== undefined) chatQueries.updateSystem.run(String(systemPrompt || '').slice(0, 4000), req.params.id);

  res.json({ conversation: normalizeConversation(chatQueries.findById.get(req.params.id)) });
});

app.delete('/api/conversations/:id', (req, res) => {
  const chat = getChatForUser(req, res);
  if (!chat) return;
  messageQueries.deleteByChat.run(req.params.id);
  chatQueries.delete.run(req.params.id);
  res.json({ success: true });
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const chat = getChatForUser(req, res);
  if (!chat) return;
  res.json({ messages: messageQueries.findByChat.all(req.params.id) });
});

app.post('/api/conversations/:id/messages', chatLimiter, async (req, res) => {
  const chat = getChatForUser(req, res);
  if (!chat) return;

  const { content, model, regenerateFromMessageId, replaceMessageId } = req.body || {};
  const regenerate = Boolean(regenerateFromMessageId);
  if (!regenerate && !String(content || '').trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  const history = messageQueries.findByChat.all(chat.id);
  let promptContent = String(content || '').trim();
  let contextHistory = history;
  let userMsgId = null;
  let replaceAssistantMessageId = null;

  if (regenerate) {
    const sourceIdx = history.findIndex((m) => m.id === regenerateFromMessageId && m.role === 'user');
    if (sourceIdx === -1) return res.status(400).json({ error: 'Source user message not found' });
    if (replaceMessageId) {
      const replaceIdx = history.findIndex((m) => m.id === replaceMessageId && m.role === 'assistant');
      if (replaceIdx === -1) return res.status(400).json({ error: 'Assistant message to replace not found' });
      if (replaceIdx <= sourceIdx) return res.status(400).json({ error: 'Assistant message must follow the source user message' });
      replaceAssistantMessageId = replaceMessageId;
    }
    promptContent = history[sourceIdx].content;
    contextHistory = history.slice(0, sourceIdx + 1);
  } else {
    userMsgId = uuid();
    messageQueries.add.run(userMsgId, chat.id, 'user', promptContent, 0);
    contextHistory = messageQueries.findByChat.all(chat.id);
  }

  const useModel = normalizeChatModel(model || chat.model || DEFAULT_CHAT_MODEL);
  chatQueries.touch.run(chat.id);
  if (chat.model !== useModel) chatQueries.updateModel.run(useModel, chat.id);
  if (!regenerate && chat.title === 'New Chat') {
    const title = promptContent.slice(0, 50) + (promptContent.length > 50 ? '...' : '');
    chatQueries.updateTitle.run(title, chat.id);
  }

  const contextPlans = [
    {
      tokenBudget: CONTEXT_CONFIG.tokenBudget,
      maxTailMessages: CONTEXT_CONFIG.maxTailMessages,
      minTailMessages: CONTEXT_CONFIG.minTailMessages,
      summaryMaxChars: CONTEXT_CONFIG.summaryMaxChars,
    },
    {
      tokenBudget: CONTEXT_CONFIG.retryTokenBudget,
      maxTailMessages: Math.max(CONTEXT_CONFIG.minTailMessages, Math.floor(CONTEXT_CONFIG.maxTailMessages * 0.7)),
      minTailMessages: Math.max(2, Math.min(CONTEXT_CONFIG.minTailMessages, 4)),
      summaryMaxChars: CONTEXT_CONFIG.retrySummaryMaxChars,
    },
  ];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abortController = new AbortController();
  const abortConnection = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  res.on('close', abortConnection);

  const persistAssistant = db.transaction((chatId, replaceId, msgId, contentText, tokens) => {
    if (replaceId) messageQueries.deleteFromMessageInChat.run(chatId, replaceId, chatId);
    messageQueries.add.run(msgId, chatId, 'assistant', contentText, tokens);
  });

  try {
    let completed = false;
    for (let attemptIndex = 0; attemptIndex < contextPlans.length; attemptIndex++) {
      const plan = contextPlans[attemptIndex];
      const contextInfo = buildContextMessages({
        chat,
        messages: contextHistory,
        tokenBudget: plan.tokenBudget,
        maxTailMessages: plan.maxTailMessages,
        minTailMessages: plan.minTailMessages,
        summaryMaxChars: plan.summaryMaxChars,
      });

      req.log.info(
        `Context build conversation=${chat.id} attempt=${attemptIndex + 1}/${contextPlans.length} ` +
        `tokens=${contextInfo.estimatedTokens}/${plan.tokenBudget} tail=${contextInfo.tailCount} ` +
        `summary=${contextInfo.summaryUsed ? 'yes' : 'no'}`
      );

      res.write(`data: ${JSON.stringify({
        type: 'context_status',
        context: {
          summaryUsed: Boolean(contextInfo.summaryUsed),
          tailCount: contextInfo.tailCount,
          attempt: attemptIndex + 1,
        },
      })}\n\n`);

      let fullContent = '';
      let totalTokens = 0;
      const assistantMsgId = uuid();

      try {
        const stream = streamChat(contextInfo.apiMessages, useModel, { signal: abortController.signal });
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          if (chunk.type === 'content') {
            fullContent += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'finish') {
            res.write(`data: ${JSON.stringify({ type: 'finish', reason: chunk.reason })}\n\n`);
          } else if (chunk.type === 'usage') {
            totalTokens = chunk.usage.total_tokens || 0;
            res.write(`data: ${JSON.stringify({ type: 'usage', usage: chunk.usage })}\n\n`);
          }
        }

        if (abortController.signal.aborted) {
          if (!res.writableEnded) res.end();
          return;
        }

        persistAssistant(chat.id, regenerate ? replaceAssistantMessageId : null, assistantMsgId, fullContent, totalTokens);
        res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsgId, userMessageId: userMsgId, tokens: totalTokens })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        completed = true;
        break;
      } catch (err) {
        if (abortController.signal.aborted || err?.name === 'AbortError') {
          if (!res.writableEnded) res.end();
          return;
        }
        const canRetryContext = isLikelyContextLimitError(err) && fullContent.length === 0 && attemptIndex < contextPlans.length - 1;
        if (canRetryContext) continue;
        throw err;
      }
    }
    if (!completed && !res.writableEnded) res.end();
  } catch (err) {
    req.log.error('Stream error:', err);
    if (!res.headersSent) res.status(500);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Chat failed' })}\n\n`);
      res.end();
    }
  } finally {
    req.off?.('close', abortConnection);
    res.off?.('close', abortConnection);
  }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const content = String(req.body?.message || req.body?.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Message content is required' });
    const model = normalizeChatModel(req.body?.model || DEFAULT_CHAT_MODEL);
    const messages = [{ role: 'user', content }];
    let answer = '';
    let tokens = 0;
    for await (const chunk of streamChat(messages, model)) {
      if (chunk.type === 'content') answer += chunk.content;
      if (chunk.type === 'usage') tokens = chunk.usage.total_tokens || 0;
    }
    res.json({ message: { role: 'assistant', content: answer }, tokens });
  } catch (err) {
    req.log.error('Direct chat error:', err);
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route is not available in cloud-lite mode.' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

assertRuntimeConfig();
ensureCloudUser();
app.listen(PORT, () => {
  rootLogger.info(`Cloud-lite server running at http://localhost:${PORT}`);
  rootLogger.info(`Database: ${DB_PATH}`);
  const configured = getAllModels();
  rootLogger.info(`Models: ${configured.length}`);
});
