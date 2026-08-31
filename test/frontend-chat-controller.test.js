const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const marked = require('../public/vendor/marked.min.js');

const projectRoot = path.join(__dirname, '..');

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function sse(events, { signal, stayOpen = false } = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      if (!stayOpen) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } else {
        signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      }
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function waitFor(predicate, message, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test('frontend controllers send, stop, and regenerate through the real app entry', async () => {
  const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://chat-controller.example.test/' });
  const globalNames = ['window', 'document', 'Node', 'DOMException', 'localStorage', 'navigator', 'marked', 'fetch', 'requestAnimationFrame'];
  const previous = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    DOMException: dom.window.DOMException,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    marked,
    requestAnimationFrame: callback => setTimeout(callback, 0),
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  }
  window.marked = marked;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') };
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  localStorage.setItem('ai_chat_token', 'frontend-test-token');

  const chats = [];
  const messages = [];
  let nextId = 1;
  global.fetch = async (url, options = {}) => {
    const pathname = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (pathname === '/api/auth/me') return json({ user: { id: 'u1', username: 'tester' } });
    if (pathname === '/api/models') return json({ models: [{ id: 'openrouter/free' }], webSearch: { enabled: false } });
    if (pathname === '/api/chats' && (!options.method || options.method === 'GET')) return json({ chats });
    if (pathname === '/api/chats' && options.method === 'POST') {
      const chat = { id: 'c1', title: 'New Chat', model: 'openrouter/free' };
      if (!chats.length) chats.push(chat);
      return json({ chat }, 201);
    }
    if (pathname === '/api/chats/c1/messages' && (!options.method || options.method === 'GET')) {
      return json({ messages });
    }
    if (pathname === '/api/chats/c1/messages' && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      if (body.content === '慢速回答') {
        const user = { id: `u${nextId++}`, chat_id: 'c1', role: 'user', content: body.content };
        messages.push(user);
        return sse([{ type: 'content', content: '第一段' }], { signal: options.signal, stayOpen: true });
      }
      if (body.regenerateFromMessageId) {
        const sourceIndex = messages.findIndex(message => message.id === body.regenerateFromMessageId);
        messages.splice(sourceIndex + 1);
        const assistant = { id: `a${nextId++}`, chat_id: 'c1', role: 'assistant', content: '新答案' };
        messages.push(assistant);
        return sse([
          { type: 'content', content: assistant.content },
          { type: 'done', messageId: assistant.id },
        ], { signal: options.signal });
      }
      const user = { id: `u${nextId++}`, chat_id: 'c1', role: 'user', content: body.content };
      const answer = body.content === '重答测试' ? '原答案' : '本地回答成功';
      const assistant = { id: `a${nextId++}`, chat_id: 'c1', role: 'assistant', content: answer };
      messages.push(user, assistant);
      return sse([
        { type: 'content', content: answer },
        { type: 'done', messageId: assistant.id, userMessageId: user.id },
      ], { signal: options.signal });
    }
    return json({ error: `Unhandled ${options.method || 'GET'} ${pathname}` }, 404);
  };

  try {
    await import(`../public/app.mjs?controller-test=${Date.now()}`);
    await waitFor(() => !document.getElementById('chatView').classList.contains('hidden'), 'chat view did not open');
    const input = document.getElementById('messageInput');
    const send = document.getElementById('sendBtn');

    input.value = '发送测试';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    send.click();
    await waitFor(() => document.body.textContent.includes('本地回答成功'), 'send answer did not render');

    input.value = '慢速回答';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    send.click();
    await waitFor(() => document.body.textContent.includes('第一段'), 'partial answer did not render');
    document.getElementById('stopBtn').click();
    await waitFor(() => document.body.textContent.includes('已停止'), 'stopped state did not render');

    input.value = '重答测试';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    send.click();
    await waitFor(() => document.body.textContent.includes('原答案'), 'original answer did not render');
    const original = [...document.querySelectorAll('.message-role-assistant')]
      .find(element => element.textContent.includes('原答案'));
    original.querySelector('[data-message-menu-toggle]').click();
    original.querySelector('[data-action="regenerate"]').click();
    await waitFor(() => document.body.textContent.includes('新答案'), 'regenerated answer did not render');
    assert.equal(document.body.textContent.includes('原答案'), false);
  } finally {
    await new Promise(resolve => setTimeout(resolve, 250));
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
});
