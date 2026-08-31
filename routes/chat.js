const express = require('express');
const { v4: uuid } = require('uuid');
const { isBoundedString } = require('../lib/validation');

module.exports = function createChatRouter({
  authRequired,
  chatQueries,
  messageQueries,
  normalizeChatModel,
  maxChatTitleChars,
  maxSystemPromptChars,
}) {
  const router = express.Router();
  const MAX_CHAT_TITLE_CHARS = maxChatTitleChars;
  const MAX_SYSTEM_PROMPT_CHARS = maxSystemPromptChars;

  function normalizeChatForResponse(chat) {
    if (!chat) return chat;
    return { ...chat, model: normalizeChatModel(chat.model) };
  }

router.get('/chats', authRequired, (req, res) => {
  const chats = chatQueries.findByUser.all(req.user.id).map(normalizeChatForResponse);
  res.json({ chats });
});

// POST /api/chats
router.post('/chats', authRequired, (req, res) => {
  try {
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
router.get('/chats/:id', authRequired, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  res.json({ chat: normalizeChatForResponse(chat) });
});

// PATCH /api/chats/:id
router.patch('/chats/:id', authRequired, (req, res) => {
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
router.get('/chats/:id/messages', authRequired, (req, res) => {
  const chat = chatQueries.findById.get(req.params.id);
  if (!chat || chat.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const messages = messageQueries.findByChat.all(req.params.id);
  res.json({ messages });
});

  return router;
};
