// Token counting using tiktoken's cl100k_base encoding (used by GPT-4, DeepSeek)
const { encode } = require('gpt-tokenizer');

function estimateContextTokens(value) {
  const input = String(value || '');
  if (!input) return 1;
  return encode(input).length;
}

function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, msg) => sum + estimateContextTokens(msg.content) + 4, 0);
}

module.exports = { estimateContextTokens, estimateMessagesTokens };
