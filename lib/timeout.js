// AbortSignal timeout utilities (Node 15+ natively supports AbortSignal.timeout)

function createTimeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

function createLinkedTimeoutSignal(parentSignal, ms, message = 'Operation timed out') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener?.('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', abort);
  }, { once: true });
  return controller.signal;
}

module.exports = { createTimeoutSignal, createLinkedTimeoutSignal };
