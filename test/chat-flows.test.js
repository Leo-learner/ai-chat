const test = require('node:test');
const assert = require('node:assert/strict');

const { jsonRequest, parseSse, startAppFixture } = require('./helpers/app-fixture');

let fixture;
let token;

test.before(async () => {
  fixture = await startAppFixture();
  const registration = await jsonRequest(fixture.baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { username: 'chat-flow-user', email: 'chat-flow@example.test', password: 'correct-horse' },
  });
  assert.equal(registration.response.status, 201);
  token = registration.payload.token;
});

test.after(async () => {
  await fixture?.close();
});

async function createChat(title) {
  const created = await jsonRequest(fixture.baseUrl, '/api/chats', {
    method: 'POST',
    token,
    body: { title },
  });
  assert.equal(created.response.status, 201);
  return created.payload.chat;
}

async function send(chatId, body, signal) {
  return fetch(`${fixture.baseUrl}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function messages(chatId) {
  const result = await jsonRequest(fixture.baseUrl, `/api/chats/${chatId}/messages`, { token });
  assert.equal(result.response.status, 200);
  return result.payload.messages;
}

test('chat send streams content and persists one user/assistant pair', async () => {
  const chat = await createChat('Send flow');
  const response = await send(chat.id, { content: 'send-check' });
  assert.equal(response.status, 200);
  const events = parseSse(await response.text());
  assert.equal(events.filter(event => event.type === 'content').map(event => event.content).join(''), '发送成功');
  const done = events.find(event => event.type === 'done');
  assert.ok(done?.messageId);
  assert.ok(done?.userMessageId);

  const stored = await messages(chat.id);
  assert.deepEqual(stored.map(message => [message.role, message.content]), [
    ['user', 'send-check'],
    ['assistant', '发送成功'],
  ]);
});

test('aborting a stream keeps the user prompt but does not persist a partial assistant answer', async () => {
  const chat = await createChat('Stop flow');
  const controller = new AbortController();
  const response = await send(chat.id, { content: 'slow-stop' }, controller.signal);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('部分响应')) {
    const { done, value } = await reader.read();
    if (done) break;
    received += decoder.decode(value, { stream: true });
  }
  assert.match(received, /部分响应/);
  controller.abort();
  await assert.rejects(reader.read(), error => error?.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 180));

  const stored = await messages(chat.id);
  assert.deepEqual(stored.map(message => [message.role, message.content]), [
    ['user', 'slow-stop'],
  ]);
});

test('regenerate replaces the selected assistant answer without duplicating the user prompt', async () => {
  const chat = await createChat('Regenerate flow');
  const firstResponse = await send(chat.id, { content: 'original-question' });
  const firstEvents = parseSse(await firstResponse.text());
  const firstDone = firstEvents.find(event => event.type === 'done');
  assert.ok(firstDone?.userMessageId);
  assert.ok(firstDone?.messageId);

  const regenerateResponse = await send(chat.id, {
    regenerateFromMessageId: firstDone.userMessageId,
    replaceMessageId: firstDone.messageId,
  });
  assert.equal(regenerateResponse.status, 200);
  const regenerateEvents = parseSse(await regenerateResponse.text());
  assert.equal(regenerateEvents.filter(event => event.type === 'content').map(event => event.content).join(''), '新答案');

  const stored = await messages(chat.id);
  assert.deepEqual(stored.map(message => [message.role, message.content]), [
    ['user', 'original-question'],
    ['assistant', '新答案'],
  ]);
  assert.equal(stored.some(message => message.id === firstDone.messageId), false);
  assert.equal(fixture.provider.callsByPrompt.get('original-question'), 2);
});

for (const scenario of [
  { prompt: 'never-respond', code: 'MODEL_FIRST_BYTE_TIMEOUT' },
  { prompt: 'idle-stall', code: 'MODEL_STREAM_IDLE_TIMEOUT' },
  { prompt: 'periodic-total', code: 'MODEL_TOTAL_TIMEOUT' },
]) {
  test(`${scenario.code} ends the stream without persisting a partial assistant answer`, async () => {
    await fixture.close();
    fixture = await startAppFixture({
      modelTimeouts: { firstByteMs: 120, idleMs: 120, totalMs: 1000 },
    });
    const registered = await jsonRequest(fixture.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { username: 'flow-user', email: 'flow@example.test', password: 'strong-password' },
    });
    token = registered.payload.token;

    const chat = await createChat(scenario.code);
    const response = await send(chat.id, { content: scenario.prompt });
    const events = parseSse(await response.text());
    assert.equal(events.at(-1)?.type, 'error');
    assert.equal(events.at(-1)?.code, scenario.code);

    const stored = await messages(chat.id);
    assert.deepEqual(stored.map(message => message.role), ['user']);
  });
}
