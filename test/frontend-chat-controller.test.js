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

test('frontend controllers send, stop, and regenerate through the real app entry', async t => {
  const html = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://chat-controller.example.test/' });
  const globalNames = ['window', 'document', 'Node', 'DOMException', 'localStorage', 'navigator', 'marked', 'fetch', 'requestAnimationFrame', 'CSS'];
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
    CSS: { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  }
  window.marked = marked;
  // Set to true to match the phone-width media query, like a phone.
  let phoneLayout = false;
  window.matchMedia = query => ({ matches: phoneLayout && query === '(max-width: 720px)', addEventListener() {}, removeEventListener() {} });
  window.CSS = CSS;
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  localStorage.setItem('ai_chat_token', 'frontend-test-token');

  const chats = [];
  const messages = [];
  let nextId = 1;
  // Set to a promise to hold every response until it settles, like a slow network.
  let slowNetwork = null;
  // Set to true to refuse every signed-in request, like an expired token.
  let tokenExpired = false;
  global.fetch = async (url, options = {}) => {
    if (slowNetwork) await slowNetwork;
    if (tokenExpired && options.headers?.Authorization) return json({ error: '登录已过期' }, 401);
    const pathname = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (pathname === '/api/auth/me') return json({ user: { id: 'u1', username: 'tester' } });
    if (pathname === '/api/auth/login') {
      // The first account signs back in by its name; any other name is the second account.
      if (JSON.parse(options.body).login === 'tester') return json({ token: 'tester-token', user: { id: 'u1', username: 'tester' } });
      return json({ token: 'second-token', user: { id: 'u2', username: 'second' } });
    }
    if (pathname === '/api/auth/profile' && options.method === 'PATCH') {
      // Like routes/auth.js, a saved profile comes back with a freshly signed token.
      return json({ token: 'renamed-token', user: { id: 'u2', username: JSON.parse(options.body).newUsername } });
    }
    if (pathname === '/api/models') return json({ models: [{ id: 'openrouter/free' }], webSearch: { enabled: false } });
    if (pathname === '/api/chats' && (!options.method || options.method === 'GET')) {
      // The second account has no chats of its own.
      return json({ chats: options.headers?.Authorization === 'Bearer second-token' ? [] : chats });
    }
    if (pathname === '/api/chats' && options.method === 'POST') {
      const chat = { id: 'c1', title: 'New Chat', model: 'openrouter/free' };
      if (!chats.length) chats.push(chat);
      return json({ chat }, 201);
    }
    if (pathname === '/api/chats/c1' && options.method === 'DELETE') {
      chats.splice(0);
      messages.splice(0);
      return json({ success: true });
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

    // Runs before the sign-out steps because it ends by deleting the current chat.
    await t.test('back-to-latest button follows the distance from the latest message', async () => {
      // Let the regenerate flow's trailing re-render and scroll settle first.
      await new Promise(resolve => setTimeout(resolve, 100));
      const list = document.getElementById('messagesContainer');
      const button = document.getElementById('scrollToBottomBtn');
      const shown = () => !button.classList.contains('hidden');
      // jsdom has no layout, so give the list a long conversation's geometry.
      Object.defineProperties(list, {
        scrollHeight: { value: 2249, configurable: true },
        clientHeight: { value: 666, configurable: true },
      });
      const scrollListTo = top => {
        list.scrollTop = top;
        list.dispatchEvent(new window.Event('scroll'));
      };

      scrollListTo(600);
      assert.equal(shown(), true, 'should show when scrolled far above the latest message');
      scrollListTo(2249 - 666 - 40);
      assert.equal(shown(), false, 'should stay hidden within the near-bottom threshold');

      scrollListTo(600);
      button.click();
      await waitFor(() => !shown(), 'did not hide after returning to the latest message');
      assert.ok(list.scrollTop >= list.scrollHeight - list.clientHeight, 'did not scroll to the latest message');

      scrollListTo(600);
      document.querySelector('.chat-item[data-chat-id="c1"] .chat-item-delete').click();
      (await waitFor(() => document.querySelector('[data-dialog-confirm]'), 'delete confirmation did not open')).click();
      await waitFor(() => !document.getElementById('emptyState').classList.contains('hidden'), 'empty state did not return');
      assert.equal(shown(), false, 'should hide once the empty state replaces the message list');
    });

    // Sign out mid-conversation: a reply on screen, an unsent draft, a sidebar
    // search, and the chat and chat list still reloading over a slow network.
    const messageList = document.getElementById('messagesContainer');
    input.value = '退出前的对话';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    send.click();
    await waitFor(() => messageList.textContent.includes('本地回答成功'), 'reply before sign-out did not render');
    await new Promise(resolve => setTimeout(resolve, 100));
    input.value = '未发送的草稿';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(localStorage.getItem('ai_chat_draft:u1:c1'), '未发送的草稿');
    let finishLoading;
    slowNetwork = new Promise(resolve => { finishLoading = resolve; });
    document.querySelector('.chat-item[data-chat-id="c1"]').click();
    document.getElementById('railHistoryBtn').click();
    const search = document.getElementById('chatSearchInput');
    search.value = 'New';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('logoutBtn').click();
    assert.deepEqual(Object.keys(localStorage).filter(key => key.startsWith('ai_chat_draft:')), []);
    const assertBlankChatView = when => {
      assert.equal(messageList.childElementCount, 0, `previous messages remain ${when}`);
      assert.equal(messageList.classList.contains('hidden'), true, `message list still shown ${when}`);
      assert.equal(document.getElementById('emptyState').classList.contains('hidden'), false, `empty state not shown ${when}`);
      assert.equal(document.querySelector('#chatList .chat-item'), null, `previous chats still listed ${when}`);
    };
    assertBlankChatView('after sign-out');
    assert.equal(search.value, '', 'sidebar search survived sign-out');
    assert.equal(document.getElementById('userName').textContent, '', 'account name survived sign-out');
    assert.equal(document.getElementById('userAvatar').textContent, '', 'account initial survived sign-out');
    slowNetwork = null;
    finishLoading();
    await new Promise(resolve => setTimeout(resolve, 50));
    assertBlankChatView('once the slow responses arrive');

    document.getElementById('loginUser').value = 'second';
    document.getElementById('loginPass').value = 'second-password';
    document.getElementById('loginForm').requestSubmit();
    await waitFor(() => document.getElementById('userName').textContent === 'second', 'second account did not sign in');
    await new Promise(resolve => setTimeout(resolve, 50));
    assertBlankChatView('for the next account');
    assert.equal(document.querySelector('.main-title-copy h1').textContent, '新对话');
    assert.equal(input.value, '');
    // The credentials must not wait in the hidden sign-in form for the next person.
    assert.equal(document.getElementById('loginUser').value, '', 'username left in the sign-in form');
    assert.equal(document.getElementById('loginPass').value, '', 'password left in the sign-in form');

    // Save a new username, then sign out from the settings dialog before the
    // reply arrives: its fresh token must not sign the account back in on reload.
    const saveButton = document.getElementById('settingsSaveBtn');
    document.getElementById('settingsBtn').click();
    document.getElementById('settingsUsername').value = 'second-renamed';
    document.getElementById('settingsCurrentPassword').value = 'second-password';
    let finishSaving;
    slowNetwork = new Promise(resolve => { finishSaving = resolve; });
    document.getElementById('settingsForm').requestSubmit();
    assert.equal(saveButton.disabled, true, 'profile save did not start');
    document.getElementById('settingsLogoutBtn').click();
    slowNetwork = null;
    finishSaving();
    await waitFor(() => !saveButton.disabled, 'save button not restored after the late reply');
    assert.equal(localStorage.getItem('ai_chat_token'), null, 'late profile reply stored the token again');
    assert.equal(document.getElementById('authView').classList.contains('hidden'), false, 'sign-in view no longer shown');
    assert.equal([...document.querySelectorAll('.toast')].some(el => el.textContent === '设置已更新'), false,
      'success toast shown after sign-out');
    const filledSettingsInputs = () => [...document.querySelectorAll('#settingsForm input')]
      .filter(field => field.value).map(field => field.id);
    assert.deepEqual(filledSettingsInputs(), [], 'settings form kept what the signed-out account typed');

    // Let the token expire while the settings dialog holds typed passwords and the
    // delete-account prompt is open over it: a new chat requested just before comes
    // back 401, and neither dialog may stay open over the sign-in view.
    document.getElementById('loginUser').value = 'second';
    document.getElementById('loginPass').value = 'second-password';
    document.getElementById('loginForm').requestSubmit();
    await waitFor(() => !document.getElementById('chatView').classList.contains('hidden'), 'second account did not sign in again');
    await new Promise(resolve => setTimeout(resolve, 50));
    let finishCreating;
    slowNetwork = new Promise(resolve => { finishCreating = resolve; });
    document.getElementById('railNewChatBtn').click();
    document.getElementById('settingsBtn').click();
    for (const id of ['settingsNewPassword', 'settingsConfirmPassword', 'settingsCurrentPassword']) {
      document.getElementById(id).value = 'typed-password';
    }
    document.getElementById('settingsDeleteAccountBtn').click();
    (await waitFor(() => document.querySelector('[data-dialog-field="password"]'), 'delete-account prompt did not open'))
      .value = 'typed-password';
    tokenExpired = true;
    slowNetwork = null;
    finishCreating();
    await waitFor(() => !document.getElementById('authView').classList.contains('hidden'), 'expired session did not return to sign-in');
    assert.equal(document.getElementById('settingsModal').classList.contains('hidden'), true, 'settings dialog left over the sign-in view');
    assert.equal(document.getElementById('settingsBackdrop').classList.contains('hidden'), true, 'settings backdrop left over the sign-in view');
    assert.deepEqual(filledSettingsInputs(), [], 'settings form kept what the expired session typed');
    await waitFor(() => !document.querySelector('.app-dialog-backdrop'), 'delete-account prompt left over the sign-in view');

    // On a phone a reply's 操作 button opens a sheet over the whole page instead.
    // Sign the first account back in, open the sheet on its reply, and let the
    // token expire the same way: the sheet must not stay over the sign-in view.
    tokenExpired = false;
    document.getElementById('loginUser').value = 'tester';
    document.getElementById('loginPass').value = 'tester-password';
    document.getElementById('loginForm').requestSubmit();
    (await waitFor(() => document.querySelector('.chat-item[data-chat-id="c1"]'), 'first account did not sign back in')).click();
    const reply = await waitFor(() => messageList.querySelector('.message-role-assistant'), 'first account chat did not reopen');
    slowNetwork = new Promise(resolve => { finishCreating = resolve; });
    document.getElementById('railNewChatBtn').click();
    phoneLayout = true;
    reply.querySelector('[data-message-menu-toggle]').click();
    phoneLayout = false;
    assert.ok(document.getElementById('mobileMessageActionSheet'), 'message action sheet did not open');
    tokenExpired = true;
    slowNetwork = null;
    finishCreating();
    await waitFor(() => !document.getElementById('authView').classList.contains('hidden'), 'expired phone session did not return to sign-in');
    assert.equal(document.getElementById('mobileMessageActionSheet'), null, 'message action sheet left over the sign-in view');
    assert.equal(document.getElementById('mobileMessageActionBackdrop'), null, 'message action backdrop left over the sign-in view');
  } finally {
    await new Promise(resolve => setTimeout(resolve, 250));
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
});
