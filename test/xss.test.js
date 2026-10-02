const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const marked = require('../public/vendor/marked.min.js');

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://chat.example.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.URL = dom.window.URL;
global.marked = marked;
window.marked = marked;

let renderer;

test.before(async () => {
  renderer = await import('../public/modules/message-renderer.mjs');
});

test.after(() => {
  dom.window.close();
});

test('message rendering removes executable HTML, event handlers, and unsafe URLs', () => {
  const payload = [
    '<script>window.__xss = 1</script>',
    '<svg onload="window.__xss = 2"><circle /></svg>',
    '<img src="x" onerror="window.__xss = 3" alt="blocked-image">',
    '[unsafe](javascript:alert(1))',
    '<a href="data:text/html,bad" onclick="window.__xss = 4">bad link</a>',
    '[safe](https://example.com/path)',
  ].join('\n\n');

  const message = renderer.createMessageElement({ id: 'xss-message', role: 'assistant', content: payload });
  document.body.replaceChildren(message);

  assert.equal(window.__xss, undefined);
  assert.equal(message.querySelectorAll('script, svg, iframe, object, embed').length, 0);
  assert.equal(message.querySelectorAll('[onerror], [onload], [onclick], [style]').length, 0);
  assert.equal([...message.querySelectorAll('a')].some(link => /^(?:javascript|data):/i.test(link.getAttribute('href') || '')), false);
  const sanitizedImage = message.querySelector('img');
  assert.equal(sanitizedImage?.src, 'https://chat.example.test/x');
  assert.equal(sanitizedImage?.hasAttribute('onerror'), false);
  assert.equal(sanitizedImage?.getAttribute('referrerpolicy'), 'no-referrer');
  const safeLink = [...message.querySelectorAll('a')].find(link => link.textContent === 'safe');
  assert.equal(safeLink?.href, 'https://example.com/path');
  assert.equal(safeLink?.target, '_blank');
  assert.match(safeLink?.rel || '', /noopener/);
});

test('external markdown images require an explicit click before loading', () => {
  const payload = [
    '![课程图](https://images.example.org/photo.png)',
    '![站内图](/local.png)',
  ].join('\n\n');
  const message = renderer.createMessageElement({ id: 'image-message', role: 'assistant', content: payload });
  document.body.replaceChildren(message);

  const placeholder = message.querySelector('.remote-image-placeholder');
  assert.ok(placeholder);
  assert.equal(message.querySelector('img[src^="https://images.example.org"]'), null);
  assert.match(placeholder.textContent, /images\.example\.org/);
  assert.equal(message.querySelector('img[src="https://chat.example.test/local.png"]')?.alt, '站内图');

  placeholder.click();
  const remote = message.querySelector('img[src="https://images.example.org/photo.png"]');
  assert.ok(remote);
  assert.equal(remote.referrerPolicy, 'no-referrer');
  assert.equal(remote.loading, 'lazy');
});

test('dialog fields keep user-controlled values inside their attributes', async () => {
  const { createUiController } = await import('../public/modules/ui-controller.mjs');
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  global.requestAnimationFrame = callback => setTimeout(callback, 0);
  const ui = createUiController({
    state: { activeDialog: null },
    dom: {},
    themeChoices: ['system', 'light', 'dark'],
    themePreferenceStorageKey: 'theme-test',
    getStoredThemePreference: () => 'light',
    escapeHtml: renderer.escapeHtml,
    escapeAttr: renderer.escapeAttr,
    getChatController: () => null,
  });

  const hostileTitle = 'x" autofocus onfocus="window.__xss = 5" style="position:fixed';
  const pending = ui.appPrompt({
    title: '重命名会话',
    fields: [
      { name: 'title', value: hostileTitle, placeholder: '"><img src=x>', required: true },
      { name: 'password', label: '当前密码', type: 'password', required: true },
    ],
  });
  const title = document.querySelector('[data-dialog-field="title"]');
  assert.deepEqual([...title.attributes].map(attr => attr.name).sort(), ['class', 'data-dialog-field', 'placeholder', 'required', 'type', 'value']);
  assert.equal(title.value, hostileTitle);
  assert.equal(document.querySelector('.app-dialog img'), null);

  const password = document.querySelector('[data-dialog-field="password"]');
  assert.equal(password.type, 'password');
  password.value = '  spaced secret  ';
  document.querySelector('[data-dialog-confirm]').click();
  assert.deepEqual(await pending, { title: hostileTitle, password: '  spaced secret  ' });
  assert.equal(window.__xss, undefined);
});
