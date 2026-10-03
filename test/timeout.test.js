const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinkedTimeoutSignal } = require('../lib/timeout');

test('linked timeout signal aborts on its deadline', async () => {
  const signal = createLinkedTimeoutSignal(null, 20, 'search timeout');
  await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason?.message, 'search timeout');
});

test('linked timeout signal follows its parent abort', () => {
  const parent = new AbortController();
  const signal = createLinkedTimeoutSignal(parent.signal, 1000);
  parent.abort(new Error('client stopped'));
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason?.message, 'client stopped');
});
