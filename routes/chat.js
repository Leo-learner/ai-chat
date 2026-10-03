const express = require('express');
const { v4: uuid } = require('uuid');
const { isBoundedString } = require('../lib/validation');

module.exports = function createChatRouter({
  authRequired,
  chatReadLimiter,
  chatWriteLimiter,
  chatQueries,
  messageQueries,
  normalizeChatModel,
  maxChatTitleChars,
  maxSystemPromptChars,
  maxChatsPerUser,
}) {
  const router = express.Router();
  const MAX_CHAT_TITLE_CHARS = maxChatTitleChars;
  const MAX_SYSTEM_PROMPT_CHARS = maxSystemPromptChars;
  const MAX_CHATS_PER_USER = maxChatsPerUser;
  // The list never needs more rows than a user may own; the floor keeps
  // accounts created before the cap fully visible.
  const CHAT_LIST_LIMIT = Math.max(MAX_CHATS_PER_USER, 1000);

  function normalizeChatForResponse(chat) {
    if (!chat) return chat;
    return { ...chat, model: normalizeChatModel(chat.model) };
  }

router.get('/chats', authRequired, chatReadLimiter, (req, res) => {
  const chats = chatQueries.findByUser.all(req.user.id, CHAT_LIST_LIMIT).map(normalizeChatForResponse);
  res.json({ chats });
});

// POST /api/chats
router.post('/chats', authRequired, chatWriteLimiter, (req, res) => {
  try {
    if (req.user.role !== 'admin' && chatQueries.countByUser.get(req.user.id).count >= MAX_CHATS_PER_USER) {
      return res.status(409).json({ error: `会话数量已达上限（${MAX_CHATS_PER_USER} 个），请先删除不需要的会话` });
    }
    const { title, model, system_prompt } = req.body || {};
    if (title !== undefined && !isBoundedString(title, MAX_CHAT_TITLE_CHARS)) {
      return res.status(400).json({ error: `Chat title must be 1-${MAX_CHAT_TITLE_CHARS} characters` });
    }
    if (system_prompt !== undefined && !isBoundedString(system_prompt, MAX_SYSTEM_PROMPT_CHARS, { allowEmpty: true })) {
      return res.status(400).json({ error: `System prompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} characters` });
    }
    const chatModel = normalizeChatModel(model);

    const id = uuid();
    const chatTitle = title?.trim() || 'New Chat';

    chatQueries.create.run(id, req.user.id, chatTitle, chatModel);
    if (system_prompt) {
      chatQueries.updateSystem.run(system_prompt, id);
    }

    const chat = normalizeChatForResponse(chatQueries.findById.get(id));
    res.status(201).json({ chat });
  } catch (err) {
    req.log.error('Create chat error:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// GET /api/chats/:id
router.get('/chats/:id', authRequired, chatReadLimiter, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json({ chat: normalizeChatForResponse(chat) });
});

// PATCH /api/chats/:id
router.patch('/chats/:id', authRequired, chatWriteLimiter, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const { title, model, system_prompt } = req.body || {};
  if (title !== undefined && !isBoundedString(title, MAX_CHAT_TITLE_CHARS)) {
    return res.status(400).json({ error: `Chat title must be 1-${MAX_CHAT_TITLE_CHARS} characters` });
  }
  if (system_prompt !== undefined && !isBoundedString(system_prompt, MAX_SYSTEM_PROMPT_CHARS, { allowEmpty: true })) {
    return res.status(400).json({ error: `System prompt exceeds ${MAX_SYSTEM_PROMPT_CHARS} characters` });
  }
  if (title !== undefined) chatQueries.updateTitle.run(title.trim(), req.params.id);
  if (model !== undefined) chatQueries.updateModel.run(normalizeChatModel(model), req.params.id);
  if (system_prompt !== undefined) chatQueries.updateSystem.run(system_prompt, req.params.id);

  const updated = normalizeChatForResponse(chatQueries.findById.get(req.params.id));
  res.json({ chat: updated });
});

// DELETE /api/chats/:id
router.delete('/chats/:id', authRequired, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  messageQueries.deleteByChat.run(req.params.id);
  chatQueries.delete.run(req.params.id);

  res.json({ success: true });
});

// ── Message Routes ──────────────────────────────────────

// GET /api/chats/:id/messages
router.get('/chats/:id/messages', authRequired, chatReadLimiter, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const messages = messageQueries.findByChat.all(req.params.id);
  res.json({ messages });
});

  return router;
};
