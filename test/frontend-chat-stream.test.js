const test = require('node:test');
const assert = require('node:assert/strict');

let consumeChatStream;

test.before(async () => {
  ({ consumeChatStream } = await import('../public/modules/chat-stream.mjs'));
});

function streamResponse(chunks, { status = 200, delayMs = 0 } = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), { status, headers: { 'Content-Type': 'text/event-stream' } });
}

test('frontend stream consumer handles split content and done events', async () => {
  const events = [];
  const response = streamResponse([
    'data: {"type":"content","content":"你',
    '好"}\n\ndata: {"type":"done","messageId":"a1"}\n\n',
  ]);
  await consumeChatStream(response, { onEvent: event => events.push(event) });
  assert.deepEqual(events.map(event => event.type), ['content', 'done']);
  assert.equal(events[0].content, '你好');
});

test('frontend stream consumer stops when the active request is aborted', async () => {
  const controller = new AbortController();
  const response = streamResponse([
    'data: {"type":"content","content":"部分"}\n\n',
    'data: {"type":"done","messageId":"a1"}\n\n',
  ], { delayMs: 20 });
  await assert.rejects(
    consumeChatStream(response, {
      signal: controller.signal,
      onEvent(event) { if (event.type === 'content') controller.abort(); },
    }),
    error => error?.name === 'AbortError',
  );
});

test('frontend stream consumer rejects an incomplete response instead of treating partial text as success', async () => {
  const response = streamResponse(['data: {"type":"content","content":"半段"}\n\n']);
  await assert.rejects(consumeChatStream(response), /回答未完整结束/);
});

test('frontend stream consumer exposes server timeout codes', async () => {
  const response = streamResponse([
    'data: {"type":"error","code":"MODEL_STREAM_IDLE_TIMEOUT","error":"AI 服务响应超时，请重试"}\n\n',
  ]);
  await assert.rejects(
    consumeChatStream(response),
    error => error?.code === 'MODEL_STREAM_IDLE_TIMEOUT',
  );
});
