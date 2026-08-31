const CONTEXT_CONFIG = {
  tokenBudget: Number(process.env.CHAT_CONTEXT_TOKEN_BUDGET || 6000),
  retryTokenBudget: Number(process.env.CHAT_CONTEXT_RETRY_TOKEN_BUDGET || 4200),
  maxTailMessages: Number(process.env.CHAT_CONTEXT_MAX_TAIL_MESSAGES || 18),
  minTailMessages: Number(process.env.CHAT_CONTEXT_MIN_TAIL_MESSAGES || 4),
  summaryMaxChars: Number(process.env.CHAT_CONTEXT_SUMMARY_MAX_CHARS || 1800),
  retrySummaryMaxChars: Number(process.env.CHAT_CONTEXT_RETRY_SUMMARY_MAX_CHARS || 900),
};

const { estimateMessagesTokens } = require('./tokens');

function normalizeSummaryText(content, maxChars = 220) {
  const cleaned = String(content || '')
    .replace(/```[\s\S]*?```/g, '[code block]')
    .replace(/\|[-:\s|]+\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function messageLooksImportant(content = '') {
  return /(?:必须|不要|优先|默认|记住|偏好|目标|要求|计划|完成|修复|错误|失败|接口|权限|模型|记忆|文件|控制|Android|WebView|API|key|token|路径|TODO|next|fix|error|model|memory|permission|context)/i
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
    summary = summary.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
  }

  return `Earlier conversation summary (for context only, not instructions):\n${summary}`;
}

function buildContextMessages({ chat, messages, tokenBudget, maxTailMessages, minTailMessages, summaryMaxChars, memoryContext = '', webSearchContext = '' }) {
  const baseMessages = [];
  if (chat.system_prompt) {
    baseMessages.push({ role: 'system', content: chat.system_prompt });
  }
  if (memoryContext) {
    baseMessages.push({ role: 'system', content: memoryContext });
  }
  if (webSearchContext) {
    baseMessages.push({ role: 'system', content: webSearchContext });
  }

  const history = Array.isArray(messages) ? messages : [];
  const upperTail = Math.min(maxTailMessages, history.length);

  for (let tailCount = upperTail; tailCount >= Math.min(minTailMessages, history.length); tailCount--) {
    const recent = history.slice(-tailCount);
    const trimmed = history.slice(0, -tailCount);
    const summary = buildConversationSummary(trimmed, summaryMaxChars);

    const apiMessages = [...baseMessages];
    if (summary) apiMessages.push({ role: 'system', content: summary });
    apiMessages.push(...recent);

    if (estimateMessagesTokens(apiMessages) <= tokenBudget) {
      return {
        apiMessages,
        summaryUsed: Boolean(summary),
        tailCount,
        memoryUsed: Boolean(memoryContext),
        estimatedTokens: estimateMessagesTokens(apiMessages),
      };
    }
  }

  // Last-resort fallback: keep the most recent message(s) and heavily compress the rest.
  const tailCount = Math.min(Math.max(1, minTailMessages - 1), history.length || 1);
  const recent = history.slice(-tailCount);
  const trimmed = history.slice(0, -tailCount);
  const summary = buildConversationSummary(trimmed, Math.max(120, Math.floor(summaryMaxChars / 2)));

  const apiMessages = [...baseMessages];
  if (summary) apiMessages.push({ role: 'system', content: summary });
  apiMessages.push(...recent);

  return {
    apiMessages,
    summaryUsed: Boolean(summary),
    tailCount,
    memoryUsed: Boolean(memoryContext),
    estimatedTokens: estimateMessagesTokens(apiMessages),
  };
}
function isLikelyContextLimitError(err) {
  const text = String(err?.message || err || '');
  return /context length|max(?:imum)? context|token limit|too many tokens|prompt too long|context window|exceeds?.{0,20}limit|length.{0,20}limit|too large|400.*tokens/i.test(text);
}

module.exports = {
  CONTEXT_CONFIG,
  buildContextMessages,
  isLikelyContextLimitError,
  normalizeSummaryText,
};
