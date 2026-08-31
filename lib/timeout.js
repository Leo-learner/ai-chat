class ModelTimeoutError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ModelTimeoutError';
    this.code = code;
  }
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

function createModelStreamWatchdog(parentSignal, { firstByteMs, idleMs, totalMs }) {
  const controller = new AbortController();
  let firstByteTimer = null;
  let idleTimer = null;
  let totalTimer = null;
  let timeoutCode = null;

  const clearAttemptTimers = () => {
    clearTimeout(firstByteTimer);
    clearTimeout(idleTimer);
    firstByteTimer = null;
    idleTimer = null;
  };

  const timeout = (code) => {
    if (controller.signal.aborted) return;
    timeoutCode = code;
    controller.abort(new ModelTimeoutError(code));
  };

  const abort = () => controller.abort(parentSignal?.reason);
  const dispose = () => {
    clearAttemptTimers();
    clearTimeout(totalTimer);
    totalTimer = null;
    parentSignal?.removeEventListener?.('abort', abort);
  };
  controller.signal.addEventListener('abort', dispose, { once: true });
  totalTimer = setTimeout(() => timeout('MODEL_TOTAL_TIMEOUT'), totalMs);
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener?.('abort', abort, { once: true });

  return {
    signal: controller.signal,
    beginAttempt() {
      clearAttemptTimers();
      firstByteTimer = setTimeout(() => timeout('MODEL_FIRST_BYTE_TIMEOUT'), firstByteMs);
    },
    noteChunk() {
      clearTimeout(firstByteTimer);
      firstByteTimer = null;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => timeout('MODEL_STREAM_IDLE_TIMEOUT'), idleMs);
    },
    endAttempt: clearAttemptTimers,
    getTimeoutCode: () => timeoutCode,
    dispose,
  };
}

module.exports = { ModelTimeoutError, createLinkedTimeoutSignal, createModelStreamWatchdog };
