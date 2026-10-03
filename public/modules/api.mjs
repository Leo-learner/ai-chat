const API_DEFAULT_TIMEOUT_MS = 25000;

function createRequestSignal(parentSignal, timeoutMs) {
  if (!parentSignal && !timeoutMs) {
    return { signal: null, timedOut: () => false, cleanup: () => {} };
  }
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const abortFromParent = () => {
    try { controller.abort(parentSignal?.reason); } catch { controller.abort(); }
  };

  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  if (timeoutMs) {
    timer = window.setTimeout(() => {
      timedOut = true;
      try { controller.abort(new DOMException('Request timed out', 'AbortError')); } catch { controller.abort(); }
    }, Math.max(1000, Number(timeoutMs) || API_DEFAULT_TIMEOUT_MS));
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) window.clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

export function createApiClient({ getToken, onAuthExpired, base = '/api' }) {
  const client = {
    base,
    async request(method, path, body = null, { signal, timeoutMs = API_DEFAULT_TIMEOUT_MS, authRedirect = true } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      const token = getToken?.();
      if (token) headers.Authorization = 'Bearer ' + token;

      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const requestSignal = createRequestSignal(signal, timeoutMs);
      if (requestSignal.signal) opts.signal = requestSignal.signal;

      try {
        const res = await fetch(this.base + path, opts);
        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };
        if (res.status === 401 && authRedirect && path !== '/auth/me' && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
          onAuthExpired?.();
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
      } catch (err) {
        if (err?.name === 'AbortError') {
          if (signal?.aborted && !requestSignal.timedOut()) throw err;
          throw new Error('请求超时，请稍后重试');
        }
        if (err instanceof TypeError) throw new Error('网络连接失败，请检查服务是否正在运行');
        throw err;
      } finally {
        requestSignal.cleanup();
      }
    },
    get(path, options = {}) { return this.request('GET', path, null, options); },
    post(path, body, options = {}) { return this.request('POST', path, body, options); },
    patch(path, body, options = {}) { return this.request('PATCH', path, body, options); },
    del(path, options = {}) { return this.request('DELETE', path, null, options); },
  };
  return client;
}
