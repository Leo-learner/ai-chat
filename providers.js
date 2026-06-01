/**
 * LLM Provider System v2
 *
 * Supports two provider types:
 *   "openai"  — Standard OpenAI-compatible API (SSE streaming)
 *   "ollama"  — Ollama Cloud native API (NDJSON streaming)
 *
 * To add a new provider, add an entry to providers.json + env vars.
 * No code changes needed.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CHAT_MODEL = 'deepseek-v4-pro';
const ALLOWED_CHAT_MODELS = [DEFAULT_CHAT_MODEL];
const allowedChatModelSet = new Set(ALLOWED_CHAT_MODELS);

function normalizeChatModel(modelId) {
  return allowedChatModelSet.has(modelId) ? modelId : DEFAULT_CHAT_MODEL;
}

// ── Load & resolve providers ────────────────────────────
function loadProviders() {
  const raw = fs.readFileSync(path.join(__dirname, 'providers.json'), 'utf-8');
  const configs = JSON.parse(raw);
  const registry = {};

  for (const cfg of configs) {
    const baseURL = (cfg.baseURL || '').replace(/\{(\w+)\}/g, (_, k) => process.env[k] || '');
    const apiKey  = (cfg.apiKey || '').replace(/\{(\w+)\}/g, (_, k) => process.env[k] || '');

    if (!apiKey) {
      registry[cfg.id] = { id: cfg.id, name: cfg.name, models: [], configured: false };
      continue;
    }

    registry[cfg.id] = {
      ...cfg,
      baseURL,
      apiKey,
      configured: true,
      type: cfg.type || 'openai',
    };
  }
  return registry;
}

// ── Model list ──────────────────────────────────────────
function getAllModels() {
  const providers = loadProviders();
  const models = [];
  for (const [pid, p] of Object.entries(providers)) {
    if (!p.configured || !p.models.length) continue;
    for (const model of p.models) {
      const normalized = normalizeChatModel(model);
      if (!allowedChatModelSet.has(normalized) || models.some(m => m.id === normalized)) continue;
      models.push({ id: normalized, name: normalized, provider: pid, providerName: p.name });
    }
  }
  return models;
}

function getModelConfig(modelId) {
  const useModel = normalizeChatModel(modelId);
  const providers = loadProviders();
  for (const [pid, p] of Object.entries(providers)) {
    if (!p.configured) continue;
    if (p.models.includes(useModel)) return { provider: p, providerId: pid, modelId: useModel };
  }
  return null;
}

// ── OpenAI-compatible streaming ─────────────────────────
async function* streamOpenAI(provider, modelId, messages, options, signal) {
  const url = `${provider.baseURL}/chat/completions`;
  const defaultOptions = provider.defaultOptions && typeof provider.defaultOptions === 'object' ? provider.defaultOptions : {};
  const streamOptions = {
    include_usage: true,
    ...(defaultOptions.stream_options || {}),
    ...((options || {}).stream_options || {}),
  };
  const body = {
    ...defaultOptions,
    ...(options || {}),
    model: normalizeChatModel(modelId),
    messages,
    stream: true,
    thinking: { type: 'disabled' },
    stream_options: streamOptions,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) yield { type: 'content', content: delta.content };
          if (parsed.choices?.[0]?.finish_reason) yield { type: 'finish', reason: parsed.choices[0].finish_reason };
          if (parsed.usage) yield { type: 'usage', usage: parsed.usage };
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Ollama native streaming (with retry for 5xx) ────────
async function* streamOllama(provider, modelId, messages, options, signal, retries = 2) {
  const url = `${provider.baseURL}/api/chat`;
  const body = { ...options, model: normalizeChatModel(modelId), messages, stream: true };

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000) * (0.5 + Math.random() * 0.5);
      console.warn(`Ollama retry ${attempt}/${retries} for ${modelId} after ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        lastError = new Error(`Ollama API error ${response.status}: ${errText.slice(0, 200)}`);
        if (response.status >= 500 && attempt < retries) continue; // retry on 5xx
        throw lastError;
      }

      // Success — stream the response
      return yield* streamOllamaResponse(response);
    } catch (err) {
      if (err !== lastError) throw err; // re-throw non-API errors immediately
    }
  }
  throw lastError;
}

async function* streamOllamaResponse(response) {

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield { type: 'content', content: parsed.message.content };
          }
          if (parsed.done) {
            totalTokens = (parsed.prompt_eval_count || 0) + (parsed.eval_count || 0);
            yield { type: 'finish', reason: parsed.done_reason || 'stop' };
            yield { type: 'usage', usage: { total_tokens: totalTokens, prompt_tokens: parsed.prompt_eval_count, completion_tokens: parsed.eval_count } };
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Dispatcher ──────────────────────────────────────────
async function* streamChat(messages, modelId, options = {}) {
  const useModel = normalizeChatModel(modelId);
  const cfg = getModelConfig(useModel);
  if (!cfg) throw new Error(`Model "${useModel}" not available (not configured or missing API key)`);

  const { provider } = cfg;
  const { signal, ...requestOptions } = options || {};
  if (provider.type === 'ollama') {
    yield* streamOllama(provider, useModel, messages, requestOptions, signal);
  } else {
    yield* streamOpenAI(provider, useModel, messages, requestOptions, signal);
  }
}

module.exports = {
  DEFAULT_CHAT_MODEL,
  ALLOWED_CHAT_MODELS,
  normalizeChatModel,
  loadProviders,
  getAllModels,
  getModelConfig,
  streamChat,
};
