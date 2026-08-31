const express = require('express');
const { v4: uuid } = require('uuid');
const { isBoundedString } = require('../lib/validation');
const { createModelStreamWatchdog } = require('../lib/timeout');
const { CONTEXT_CONFIG, buildContextMessages, isLikelyContextLimitError } = require('../lib/chat-context');

module.exports = function createStreamRouter({
  authRequired,
  chatLimiter,
  db,
  chatQueries,
  messageQueries,
  normalizeChatModel,
  defaultChatModel,
  streamChat,
  memoryService,
  searchService,
  maxMessageChars,
  modelTimeouts,
}) {
  const router = express.Router();
  const DEFAULT_CHAT_MODEL = defaultChatModel;
  const MAX_MESSAGE_CHARS = maxMessageChars;
  const { buildUserMemoryContext } = memoryService;
  const { buildWebSearchContext, isWebSearchAvailable } = searchService;

router.post('/chats/:id/messages', authRequired, chatLimiter, async (req, res) => {
  const requestStartedAt = Date.now();
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const { content, model, regenerateFromMessageId, replaceMessageId, webSearch } = req.body || {};
  const regenerate = Boolean(regenerateFromMessageId);
  const webSearchRequested = webSearch === true;

  if (!regenerate && !isBoundedString(content, MAX_MESSAGE_CHARS)) {
    if (typeof content === 'string' && content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_CHARS} characters` });
    }
    return res.status(400).json({ error: 'Message content is required' });
  }
  if (regenerate && !regenerateFromMessageId) {
    return res.status(400).json({ error: 'regenerateFromMessageId is required' });
  }

  const history = messageQueries.findByChat.all(chat.id);
  let promptContent = content || '';
  let contextHistory = history;
  let userMsgId = null;
  let replaceAssistantMessageId = null;

  if (regenerate) {
    const sourceIdx = history.findIndex((m) => m.id === regenerateFromMessageId && m.role === 'user');
    if (sourceIdx === -1) {
      return res.status(400).json({ error: 'Source user message not found' });
    }
    if (replaceMessageId) {
      const replaceIdx = history.findIndex((m) => m.id === replaceMessageId && m.role === 'assistant');
      if (replaceIdx === -1) {
        return res.status(400).json({ error: 'Assistant message to replace not found' });
      }
      if (replaceIdx <= sourceIdx) {
        return res.status(400).json({ error: 'Assistant message must follow the source user message' });
      }
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
  if (chat.model !== useModel) {
    chatQueries.updateModel.run(useModel, chat.id);
  }

  if (!regenerate && chat.title === 'New Chat') {
    const title = promptContent.slice(0, 50) + (promptContent.length > 50 ? '…' : '');
    chatQueries.updateTitle.run(title, chat.id);
  }

  const abortController = new AbortController();
  const abortConnection = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  req.on('aborted', abortConnection);
  res.on('close', abortConnection);

  const memoryContextInfo = await buildUserMemoryContext(
    req.user.id,
    promptContent,
    contextHistory,
    abortController.signal,
  );
  if (abortController.signal.aborted) {
    req.off?.('aborted', abortConnection);
    res.off?.('close', abortConnection);
    return;
  }
  const memoryContext = memoryContextInfo.context;

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
    {
      tokenBudget: Math.max(1200, Math.floor(CONTEXT_CONFIG.retryTokenBudget * 0.7)),
      maxTailMessages: Math.max(4, Math.floor(CONTEXT_CONFIG.maxTailMessages * 0.45)),
      minTailMessages: 2,
      summaryMaxChars: Math.max(400, Math.floor(CONTEXT_CONFIG.retrySummaryMaxChars * 0.7)),
    },
  ];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Send an SSE comment immediately so reverse proxies and clients observe the
  // connection before optional search or provider queueing begins.
  res.write(': connected\n\n');

  let fullContent = '';
  let totalTokens = 0;
  let assistantMsgId = uuid();
  let firstChunkLogged = false;
  let webSearchContextInfo = { context: '', count: 0, queryChars: 0, used: false, results: [] };
  let modelWatchdog = null;

  const persistAssistant = db.transaction((chatId, replaceId, msgId, contentText, tokens) => {
    if (replaceId) {
      messageQueries.deleteFromMessageInChat.run(chatId, replaceId, chatId);
    }
    messageQueries.add.run(msgId, chatId, 'assistant', contentText, tokens);
  });

  try {
    let completed = false;

    if (webSearchRequested) {
      if (!isWebSearchAvailable()) {
        res.write(`data: ${JSON.stringify({
          type: 'search_status',
          status: 'disabled',
          message: '联网搜索未配置，已继续普通回答',
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({
          type: 'search_status',
          status: 'searching',
          message: '正在联网搜索',
        })}\n\n`);

        try {
          const info = await buildWebSearchContext(promptContent, contextHistory, abortController.signal);
          webSearchContextInfo = { ...info, used: Boolean(info.context) };
          res.write(`data: ${JSON.stringify({
            type: 'search_status',
            status: info.count ? 'complete' : 'no_results',
            count: info.count,
            message: info.count ? `已参考 ${info.count} 条网页结果` : '未找到可用网页结果，已继续普通回答',
          })}\n\n`);
          if (info.count) {
            res.write(`data: ${JSON.stringify({
              type: 'search_results',
              results: info.results,
            })}\n\n`);
          }
        } catch (err) {
          if (abortController.signal.aborted || err?.name === 'AbortError') {
            if (!res.writableEnded) res.end();
            return;
          }
          req.log.warn('Web search skipped:', err.message || err);
          res.write(`data: ${JSON.stringify({
            type: 'search_status',
            status: 'error',
            message: '联网搜索失败，已继续普通回答',
          })}\n\n`);
        }
      }
    }

    modelWatchdog = createModelStreamWatchdog(abortController.signal, modelTimeouts);

    for (let attemptIndex = 0; attemptIndex < contextPlans.length; attemptIndex++) {
      const plan = contextPlans[attemptIndex];
      const contextInfo = buildContextMessages({
        chat,
        messages: contextHistory,
        tokenBudget: plan.tokenBudget,
        maxTailMessages: plan.maxTailMessages,
        minTailMessages: plan.minTailMessages,
        summaryMaxChars: plan.summaryMaxChars,
        memoryContext,
        webSearchContext: webSearchContextInfo.context,
      });
      const { apiMessages } = contextInfo;

      req.log.info(
        `Context build chat=${chat.id} attempt=${attemptIndex + 1}/${contextPlans.length} ` +
        `tokens=${contextInfo.estimatedTokens}/${plan.tokenBudget} tail=${contextInfo.tailCount} ` +
        `summary=${contextInfo.summaryUsed ? 'yes' : 'no'} memories=${memoryContextInfo.count} web=${webSearchContextInfo.count}`
      );

      res.write(`data: ${JSON.stringify({
        type: 'context_status',
        context: {
          memoryUsed: Boolean(memoryContext),
          memoryCount: memoryContextInfo.count,
          webSearchRequested,
          webSearchUsed: Boolean(webSearchContextInfo.context),
          webSearchCount: webSearchContextInfo.count,
          summaryUsed: Boolean(contextInfo.summaryUsed),
          tailCount: contextInfo.tailCount,
          attempt: attemptIndex + 1,
        },
      })}\n\n`);

      fullContent = '';
      totalTokens = 0;
      assistantMsgId = uuid();

      try {
        modelWatchdog.beginAttempt();
        const stream = streamChat(apiMessages, useModel, { signal: modelWatchdog.signal });

        for await (const chunk of stream) {
          if (modelWatchdog.signal.aborted) break;
          modelWatchdog.noteChunk();

          if (chunk.type === 'content') {
            if (!firstChunkLogged) {
              firstChunkLogged = true;
              req.log.info(`First response chunk chat=${chat.id} latencyMs=${Date.now() - requestStartedAt}`);
            }
            fullContent += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'finish') {
            res.write(`data: ${JSON.stringify({ type: 'finish', reason: chunk.reason })}\n\n`);
          } else if (chunk.type === 'usage') {
            totalTokens = chunk.usage.total_tokens || 0;
            res.write(`data: ${JSON.stringify({ type: 'usage', usage: chunk.usage })}\n\n`);
          }
        }

        modelWatchdog.endAttempt();
        if (modelWatchdog.signal.aborted) {
          if (modelWatchdog.getTimeoutCode()) throw modelWatchdog.signal.reason;
          if (!res.writableEnded) res.end();
          return;
        }

        modelWatchdog.dispose();
        persistAssistant(chat.id, regenerate ? replaceAssistantMessageId : null, assistantMsgId, fullContent, totalTokens);

        res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsgId, userMessageId: userMsgId, tokens: totalTokens })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        completed = true;
        break;
      } catch (err) {
        modelWatchdog.endAttempt();
        if (modelWatchdog.getTimeoutCode()) throw modelWatchdog.signal.reason || err;
        if (abortController.signal.aborted || err?.name === 'AbortError') {
          if (!res.writableEnded) res.end();
          return;
        }

        const canRetryContext = isLikelyContextLimitError(err) && fullContent.length === 0 && attemptIndex < contextPlans.length - 1;
        if (canRetryContext) {
          req.log.warn(`Context too large for model ${useModel}; retrying with tighter window (${attemptIndex + 1}/${contextPlans.length})`);
          continue;
        }

        throw err;
      }
    }

    if (!completed && !res.writableEnded) {
      res.end();
    }
  } catch (err) {
    const timeoutCode = modelWatchdog?.getTimeoutCode();
    if (timeoutCode) {
      req.log.warn(`Model stream timed out chat=${chat.id} code=${timeoutCode}`);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          code: timeoutCode,
          error: 'AI 服务响应超时，请重试',
        })}\n\n`);
        res.end();
      }
      return;
    }
    if (abortController.signal.aborted || err?.name === 'AbortError') {
      if (!res.writableEnded) res.end();
      return;
    }

    req.log.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500);
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI 服务暂时不可用，请稍后重试' })}\n\n`);
      res.end();
    }
  } finally {
    modelWatchdog?.dispose();
    req.off?.('aborted', abortConnection);
    res.off?.('close', abortConnection);
  }
});

  return router;
};
