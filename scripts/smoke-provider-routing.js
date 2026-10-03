const assert = require('assert/strict');

process.env.DEFAULT_CHAT_MODEL = 'openrouter/free';
process.env.OPENROUTER_BASE_URL = 'https://openrouter.test/api/v1';
process.env.OPENROUTER_API_KEY = 'test-key';

const originalFetch = global.fetch;
let capturedRequest;

global.fetch = async (url, init) => {
  capturedRequest = { url, init, body: JSON.parse(init.body) };
  const stream = [
    'data: {"choices":[{"delta":{"content":"OK"}}]}',
    '',
    'data: {"choices":[{"finish_reason":"stop"}],"usage":{"total_tokens":2}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
};

async function main() {
  const providers = require('../providers');

  assert.equal(providers.DEFAULT_CHAT_MODEL, 'openrouter/free');
  assert.equal(providers.normalizeChatModel('legacy/provider-model'), 'openrouter/free');
  assert.deepEqual(providers.getAllModels().map(model => model.id), ['openrouter/free']);

  const events = [];
  for await (const event of providers.streamChat(
    [{ role: 'user', content: 'Reply with OK.' }],
    'legacy/provider-model',
    { max_tokens: 8 },
  )) {
    events.push(event);
  }

  assert.equal(capturedRequest.url, 'https://openrouter.test/api/v1/chat/completions');
  assert.equal(capturedRequest.body.model, 'openrouter/free');
  assert.equal(capturedRequest.body.max_tokens, 8);
  assert.equal(capturedRequest.body.stream, true);
  assert.equal(capturedRequest.body.models, undefined);
  assert.equal(capturedRequest.init.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(events, [
    { type: 'content', content: 'OK' },
    { type: 'finish', reason: 'stop' },
    { type: 'usage', usage: { total_tokens: 2 } },
  ]);

  console.log('provider routing smoke ok');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
  });
