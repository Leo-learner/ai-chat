async function responseError(response) {
  let message = 'Stream failed';
  try {
    const data = await response.json();
    message = data.error || message;
  } catch {
    message = await response.text().catch(() => message);
  }
  return new Error(message || 'Stream failed');
}

export async function consumeChatStream(response, {
  signal,
  isCurrent = () => true,
  onEvent = () => {},
} = {}) {
  if (!response.ok) throw await responseError(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('响应为空');

  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  const processBlock = (block) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event.type === 'error') {
        const error = new Error(event.error || 'Stream failed');
        error.code = event.code || '';
        throw error;
      }
      onEvent(event);
      if (event.type === 'done') completed = true;
    }
  };

  try {
    while (!completed) {
      if (signal?.aborted || !isCurrent()) throw new DOMException('Request stopped', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n+/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (!block.trim()) continue;
        processBlock(block);
        if (completed) break;
      }
    }
    if (buffer.trim() && !completed) processBlock(buffer);
  } finally {
    if (completed) reader.cancel().catch(() => {});
  }

  if (!completed) throw new Error('回答未完整结束，请重试');
}
