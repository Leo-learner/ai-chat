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
