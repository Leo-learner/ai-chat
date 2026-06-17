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

const DEFAULT_CHAT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';

function resolveEnvPlaceholders(value) {
  if (typeof value === 'string') {
    return value.replace(/\{(\w+)\}/g, (_, key) => process.env[key] || '');
  }
  if (Array.isArray(value)) return value.map(resolveEnvPlaceholders);
  if (value && typeof value === 'object') {
    const resolved = {};
    for (const [key, child] of Object.entries(value)) {
      const next = resolveEnvPlaceholders(child);
      if (next === '') continue;
      resolved[key] = next;
    }
    return Object.keys(resolved).length ? resolved : '';
  }
  return value;
}

function loadProviderConfigs() {
  const raw = fs.readFileSync(path.join(__dirname, 'providers.json'), 'utf-8');
  return JSON.parse(raw).map((cfg) => {
    const resolved = resolveEnvPlaceholders(cfg);
    const models = (resolved.models || [])
      .map(model => String(model || '').trim())
      .filter(Boolean);
    return {
      ...resolved,
      models: models.length ? models : [DEFAULT_CHAT_MODEL],
      defaultModel: String(resolved.defaultModel || '').trim() || DEFAULT_CHAT_MODEL,
    };
  });
}

function getAllowedChatModels() {
  const models = [];
  for (const cfg of loadProviderConfigs()) {
    for (const model of cfg.models || []) {
      if (model && !models.includes(model)) models.push(model);
    }
  }
  return models.length ? models : [DEFAULT_CHAT_MODEL];
}

function normalizeChatModel(modelId) {
  const allowed = getAllowedChatModels();
  if (allowed.includes(modelId)) return modelId;
  if (allowed.includes(DEFAULT_CHAT_MODEL)) return DEFAULT_CHAT_MODEL;
  return allowed[0] || DEFAULT_CHAT_MODEL;
}

function providerDefaultModel(provider) {
  if (provider.defaultModel && provider.models?.includes(provider.defaultModel)) return provider.defaultModel;
  return provider.models?.[0] || DEFAULT_CHAT_MODEL;
}

// ── Load & resolve providers ────────────────────────────
function loadProviders() {
  const configs = loadProviderConfigs();
  const registry = {};

  for (const cfg of configs) {
    const baseURL = cfg.baseURL || '';
    const apiKey = cfg.apiKey || '';

    if (!apiKey || !baseURL) {
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
      if (!normalized || models.some(m => m.id === normalized)) continue;
      models.push({ id: normalized, name: normalized, provider: pid, providerName: p.name });
    }
  }
  return models;
}

function getModelConfig(modelId) {
  const requestedModel = normalizeChatModel(modelId);
  const providers = loadProviders();
  for (const [pid, p] of Object.entries(providers)) {
    if (!p.configured) continue;
    if (p.models.includes(requestedModel)) return { provider: p, providerId: pid, modelId: requestedModel };
  }

  for (const [pid, p] of Object.entries(providers)) {
    if (!p.configured || !p.models.length) continue;
    const fallbackModel = providerDefaultModel(p);
    return { provider: p, providerId: pid, modelId: fallbackModel };
  }
  return null;
}

// ── OpenAI-compatible streaming ─────────────────────────
async function* streamOpenAI(provider, modelId, messages, options, signal) {
  const url = `${provider.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const defaultOptions = provider.defaultOptions && typeof provider.defaultOptions === 'object' ? provider.defaultOptions : {};
  const streamOptions = {
    include_usage: true,
    ...(defaultOptions.stream_options || {}),
    ...((options || {}).stream_options || {}),
  };
  const useModel = normalizeChatModel(modelId);
  const body = {
    ...defaultOptions,
    ...(options || {}),
    model: useModel,
    messages,
    stream: true,
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
  const url = `${provider.baseURL.replace(/\/+$/, '')}/api/chat`;
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

  const { provider, modelId: resolvedModelId } = cfg;
  const { signal, ...requestOptions } = options || {};
  if (provider.type === 'ollama') {
    yield* streamOllama(provider, resolvedModelId, messages, requestOptions, signal);
  } else {
    yield* streamOpenAI(provider, resolvedModelId, messages, requestOptions, signal);
  }
}

module.exports = {
  DEFAULT_CHAT_MODEL,
  getAllowedChatModels,
  normalizeChatModel,
  loadProviders,
  getAllModels,
  getModelConfig,
  streamChat,
};
