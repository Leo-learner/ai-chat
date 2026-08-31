export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function escapeAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
}

const MARKDOWN_ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td',
  'th', 'thead', 'tr', 'ul',
]);
const MARKDOWN_DROP_CONTENT_TAGS = new Set([
  'audio', 'button', 'embed', 'form', 'iframe', 'link', 'math', 'meta', 'object',
  'option', 'script', 'select', 'source', 'style', 'svg', 'template', 'textarea', 'video',
]);
const MARKDOWN_ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  code: new Set(['class']),
  img: new Set(['alt', 'src', 'title']),
  input: new Set(['checked', 'disabled', 'type']),
  ol: new Set(['start']),
  td: new Set(['align']),
  th: new Set(['align']),
};

function sanitizeMarkdownUrl(value, kind = 'link') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (kind === 'image' && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (kind === 'image') {
      if (parsed.protocol === 'https:') return parsed.href;
      if (parsed.origin === window.location.origin && raw.startsWith('/') && !raw.startsWith('//')) return parsed.href;
      return '';
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.href;
    }
  } catch {
    /* Invalid URLs are stripped below. */
  }
  return '';
}

function createRemoteImagePlaceholder(src, alt = '') {
  const button = document.createElement('button');
  const hostname = new URL(src).hostname.replace(/^www\./, '');
  button.type = 'button';
  button.className = 'remote-image-placeholder';
  button.dataset.remoteImageSrc = src;
  button.dataset.remoteImageAlt = alt;
  button.setAttribute('aria-label', `加载来自 ${hostname} 的图片`);

  const copy = document.createElement('span');
  copy.className = 'remote-image-copy';
  const label = document.createElement('strong');
  label.textContent = alt || '外部图片';
  const source = document.createElement('span');
  source.textContent = hostname;
  const action = document.createElement('span');
  action.className = 'remote-image-action';
  action.textContent = '加载图片';
  copy.append(label, source);
  button.append(copy, action);
  return button;
}

function sanitizeMarkdownElement(element) {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (MARKDOWN_DROP_CONTENT_TAGS.has(tag)) {
      child.remove();
      continue;
    }

    sanitizeMarkdownElement(child);
    if (!MARKDOWN_ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }

    const allowedAttrs = MARKDOWN_ALLOWED_ATTRS[tag] || new Set();
    for (const attr of Array.from(child.attributes)) {
      if (!allowedAttrs.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
    }

    if (tag === 'a') {
      const href = sanitizeMarkdownUrl(child.getAttribute('href'), 'link');
      if (href) {
        child.setAttribute('href', href);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer nofollow');
      } else {
        child.removeAttribute('href');
      }
    } else if (tag === 'img') {
      const src = sanitizeMarkdownUrl(child.getAttribute('src'), 'image');
      if (!src) {
        child.replaceWith(document.createTextNode(child.getAttribute('alt') || ''));
        continue;
      }
      const parsed = new URL(src, window.location.origin);
      if (parsed.protocol === 'https:' && parsed.origin !== window.location.origin) {
        child.replaceWith(createRemoteImagePlaceholder(src, child.getAttribute('alt') || ''));
        continue;
      }
      child.setAttribute('src', src);
      child.setAttribute('loading', 'lazy');
      child.setAttribute('referrerpolicy', 'no-referrer');
    } else if (tag === 'code' && child.hasAttribute('class')) {
      const classes = String(child.getAttribute('class') || '')
        .split(/\s+/)
        .filter(name => /^language-[a-z0-9_+-]{1,32}$/i.test(name));
      if (classes.length) child.setAttribute('class', classes.join(' '));
      else child.removeAttribute('class');
    } else if (tag === 'input') {
      if (child.getAttribute('type') !== 'checkbox') {
        child.remove();
        continue;
      }
      child.setAttribute('disabled', '');
    }
  }
}

function sanitizeMarkdownHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  sanitizeMarkdownElement(template.content);
  return template.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return sanitizeMarkdownHtml(marked.parse(text));
  } catch {
    return escapeHtml(text);
  }
}

function getCodeBlockLanguage(block) {
  if (!block) return 'code';
  const classLanguage = Array.from(block.classList || []).find(cls => /^(language|lang)-/.test(cls));
  const raw = block.dataset?.language
    || (classLanguage ? classLanguage.replace(/^(language|lang)-/, '') : '')
    || block.result?.language
    || '';
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return 'code';
  const aliases = {
    javascript: 'js',
    typescript: 'ts',
    shell: 'sh',
    bash: 'sh',
    plaintext: 'text',
    text: 'text',
  };
  return aliases[normalized] || normalized;
}

function fallbackCodeHighlight(code, language = 'code') {
  const lang = String(language || '').toLowerCase();
  const escaped = escapeHtml(code || '');
  const tokenPattern = lang === 'python' || lang === 'py'
    ? /(#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:and|as|assert|async|await|break|class|continue|def|elif|else|except|False|finally|for|from|if|import|in|is|lambda|None|not|or|pass|raise|return|True|try|while|with|yield)\b|\b\d+(?:\.\d+)?\b)/gm
    : /(\/\*[\s\S]*?\*\/|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|false|finally|for|from|function|if|import|let|new|null|return|switch|throw|true|try|undefined|var|while)\b|\b\d+(?:\.\d+)?\b)/gm;

  return escaped.replace(tokenPattern, (token) => {
    if (/^(\/\/|#|\/\*)/.test(token)) return `<span class="hljs-comment">${token}</span>`;
    if (/^["'`]/.test(token)) return `<span class="hljs-string">${token}</span>`;
    if (/^\d/.test(token)) return `<span class="hljs-number">${token}</span>`;
    return `<span class="hljs-keyword">${token}</span>`;
  });
}

function applyFallbackCodeHighlight(block, language) {
  if (!block || block.querySelector('[class^="hljs-"], [class*=" hljs-"]')) return;
  block.innerHTML = fallbackCodeHighlight(block.textContent || '', language);
  block.classList.add('hljs', 'code-block-fallback-highlight');
}

function enhanceCodeBlock(pre, block) {
  if (!pre || !block || pre.closest('.code-block-shell')) return;

  const shell = document.createElement('div');
  shell.className = 'code-block-shell';
  const toolbar = document.createElement('div');
  toolbar.className = 'code-block-toolbar';

  const label = document.createElement('span');
  label.className = 'code-block-language';
  label.textContent = getCodeBlockLanguage(block);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'code-block-copy';
  copyBtn.type = 'button';
  copyBtn.dataset.codeCopy = 'true';
  copyBtn.textContent = '复制代码';

  toolbar.append(label, copyBtn);
  pre.classList.add('code-block-pre');
  block.classList.add('code-block-code');
  pre.parentNode.insertBefore(shell, pre);
  shell.append(toolbar, pre);
}

function enhanceMessageContent(root) {
  if (!root) return;
  root.querySelectorAll('.remote-image-placeholder[data-remote-image-src]').forEach(button => {
    if (button.dataset.remoteImageBound === 'true') return;
    button.dataset.remoteImageBound = 'true';
    button.addEventListener('click', () => {
      const src = sanitizeMarkdownUrl(button.dataset.remoteImageSrc, 'image');
      if (!src) return;
      const image = document.createElement('img');
      image.src = src;
      image.alt = button.dataset.remoteImageAlt || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      button.replaceWith(image);
    }, { once: true });
  });
  root.querySelectorAll('pre code').forEach(block => {
    const language = getCodeBlockLanguage(block);
    if (window.hljs && !block.dataset.highlighted) {
      try { hljs.highlightElement(block); } catch { /* ignore */ }
    }
    applyFallbackCodeHighlight(block, language);
    enhanceCodeBlock(block.closest('pre'), block);
  });
}

function normalizeContextStatus(status = null) {
  if (!status || typeof status !== 'object') return null;
  return {
    memoryUsed: Boolean(status.memoryUsed),
    memoryCount: Number(status.memoryCount || 0),
    webSearchRequested: Boolean(status.webSearchRequested),
    webSearchUsed: Boolean(status.webSearchUsed),
    webSearchCount: Number(status.webSearchCount || 0),
    summaryUsed: Boolean(status.summaryUsed),
    tailCount: Number(status.tailCount || 0),
    attempt: Number(status.attempt || 1),
  };
}

function safeExternalUrl(url = '') {
  try {
    const parsed = new URL(String(url), window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch {
    /* ignore */
  }
  return '';
}

function normalizeSearchResults(results = []) {
  if (!Array.isArray(results)) return [];
  return results
    .map(item => {
      const url = safeExternalUrl(item?.url || '');
      const domain = String(item?.domain || '').trim() || (url ? new URL(url).hostname.replace(/^www\./, '') : '');
      return {
        title: String(item?.title || domain || '网页来源').replace(/\s+/g, ' ').trim(),
        url,
        domain,
        snippet: String(item?.snippet || '').replace(/\s+/g, ' ').trim(),
      };
    })
    .filter(item => item.url)
    .slice(0, 8);
}

function renderContextStatusDetails(status) {
  const meta = normalizeContextStatus(status);
  if (!meta) return '';
  const emptyContext = !meta.memoryUsed && !meta.webSearchUsed && !meta.summaryUsed;
  const memoryText = meta.memoryUsed ? `记忆 ${meta.memoryCount} 条` : '未使用记忆';
  const webText = meta.webSearchRequested
    ? (meta.webSearchUsed ? `联网 ${meta.webSearchCount} 条` : '联网无来源')
    : '未联网';
  const summaryText = meta.summaryUsed ? '已压缩早期历史' : '未触发历史摘要';
  const tailText = meta.tailCount ? `保留最近 ${meta.tailCount} 条消息` : '按当前上下文回答';

  return `
    <details class="message-extra-panel message-context-panel${emptyContext ? ' is-empty-context' : ''}">
      <summary>
        <span>回答详情</span>
        <span class="message-extra-summary">${escapeHtml([memoryText, webText].join(' · '))}</span>
      </summary>
      <div class="message-context-grid">
        <span class="context-chip ${meta.memoryUsed ? 'is-on' : 'is-off'}">${escapeHtml(memoryText)}</span>
        <span class="context-chip ${meta.webSearchUsed ? 'is-on' : 'is-off'}">${escapeHtml(webText)}</span>
        <span class="context-chip ${meta.summaryUsed ? 'is-on' : 'is-off'}">${escapeHtml(summaryText)}</span>
        <span class="context-chip is-neutral">${escapeHtml(tailText)}</span>
      </div>
    </details>
  `;
}

function renderSearchResultsDetails(results = []) {
  const sources = normalizeSearchResults(results);
  if (!sources.length) return '';
  const rows = sources.map((source, index) => `
    <a class="source-card" href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">
      <span class="source-card-top">
        <span class="source-index">${index + 1}</span>
        <span class="source-domain">${escapeHtml(source.domain || 'source')}</span>
      </span>
      <span class="source-title">${escapeHtml(source.title)}</span>
      <span class="source-snippet">${escapeHtml(source.snippet || '打开查看来源详情')}</span>
    </a>
  `).join('');

  return `
    <details class="message-extra-panel message-sources-panel">
      <summary>
        <span>来源</span>
        <span class="message-extra-summary">${sources.length} 条网页结果</span>
      </summary>
      <div class="source-list">${rows}</div>
    </details>
  `;
}

function renderMessageExtras(msg = {}) {
  if (msg.role !== 'assistant') return '';
  const contextHtml = renderContextStatusDetails(msg.contextStatus);
  const sourcesHtml = renderSearchResultsDetails(msg.searchResults);
  if (!contextHtml && !sourcesHtml) return '';
  return `<div class="message-extras">${contextHtml}${sourcesHtml}</div>`;
}

function updateMessageExtras(bodyEl, msg = {}) {
  if (!bodyEl) return;
  let extras = bodyEl.querySelector('.message-extras');
  const html = renderMessageExtras({ role: 'assistant', ...msg });
  if (!html) {
    extras?.remove();
    return;
  }
  if (!extras) {
    extras = document.createElement('div');
    extras.className = 'message-extras';
    bodyEl.appendChild(extras);
  }
  extras.outerHTML = html;
}

function createMessageElement(msg) {
  const wrap = document.createElement('div');
  wrap.className = `message message-role-${msg.role}`;
  wrap.dataset.messageId = msg.id;
  wrap.dataset.role = msg.role;

  const avatar = msg.role === 'user' ? '你' : 'AI';

  const secondaryActions = [];
  secondaryActions.push(`<button class="message-action message-action-mobile-only" type="button" data-action="copy">复制</button>`);
  if (msg.role === 'user') {
    secondaryActions.push(`<button class="message-action" type="button" data-action="retry-user">重发</button>`);
  }
  if (msg.role === 'assistant') {
    secondaryActions.push(`<button class="message-action" type="button" data-action="continue">继续</button>`);
    secondaryActions.push(`<button class="message-action message-action-danger" type="button" data-action="regenerate">重答</button>`);
  }
  const actionMenuTitle = msg.role === 'assistant' ? 'AI 回答操作' : '我的消息操作';

  wrap.innerHTML = `
    <div class="message-avatar">${escapeHtml(avatar)}</div>
    <div class="message-body">
      <div class="message-content">${renderMarkdown(msg.content)}</div>
      <div class="message-actions">
        <button class="message-action" type="button" data-action="copy">复制</button>
        <div class="message-action-menu">
          <button class="message-action message-action-more" type="button" data-message-menu-toggle aria-expanded="false" aria-label="打开${escapeAttr(actionMenuTitle)}">操作</button>
          <div class="message-action-popover" role="group" aria-label="${escapeAttr(actionMenuTitle)}" aria-hidden="true">
            <div class="message-action-sheet-head">
              <span>${escapeHtml(actionMenuTitle)}</span>
              <span>轻点执行</span>
            </div>
            ${secondaryActions.join('')}
          </div>
        </div>
      </div>
      ${renderMessageExtras(msg)}
    </div>
  `;

  enhanceMessageContent(wrap.querySelector('.message-content'));
  return wrap;
}

export {
  createMessageElement,
  enhanceMessageContent,
  normalizeContextStatus,
  normalizeSearchResults,
  renderMarkdown,
  updateMessageExtras,
};
