import {
  ALLOWED_CHAT_MODELS,
  CHAT_DRAFT_STORAGE_PREFIX,
  DEFAULT_CHAT_MODEL,
  MESSAGE_RENDER_LIMIT,
  THEME_CHOICES,
  THEME_PREFERENCE_STORAGE_KEY,
  dom,
  getStoredThemePreference,
  normalizeChatModel,
  state,
} from './modules/state.mjs';
import { createApiClient } from './modules/api.mjs';
import {
  createMessageElement,
  enhanceMessageContent,
  escapeAttr,
  escapeHtml,
  normalizeContextStatus,
  normalizeSearchResults,
  renderMarkdown,
  updateMessageExtras,
} from './modules/message-renderer.mjs';
import { createSidebarController } from './modules/sidebar.mjs';

function handleAuthExpired() {
  if (!state.token) return;
  abortActiveRequest();
  localStorage.removeItem('ai_chat_token');
  state.token = null;
  state.user = null;
  state.currentChat = null;
  state.messages = [];
  showView('authView');
  toast('登录已过期，请重新登录');
}

const API = createApiClient({ getToken: () => state.token, onAuthExpired: handleAuthExpired });

if (window.marked) {
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight(code, lang) {
      if (!window.hljs) return code;
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      } catch {
        return code;
      }
    },
  });
}

const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');

function themeChoiceLabel(choice) {
  if (choice === 'light') return '浅色';
  if (choice === 'dark') return '深色';
  return '跟随系统';
}

function syncThemeControls() {
  const preference = state.themePreference || getStoredThemePreference();
  document.querySelectorAll('[data-theme-choice]').forEach(btn => {
    const active = btn.dataset.themeChoice === preference;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const label = document.getElementById('themeCurrentLabel');
  if (label) label.textContent = themeChoiceLabel(preference);
}

function resolveThemePreference(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function applyThemePreference(preference = state.themePreference || getStoredThemePreference()) {
  const normalized = THEME_CHOICES.includes(preference) ? preference : 'system';
  state.themePreference = normalized;
  const theme = resolveThemePreference(normalized);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = normalized;
  document.documentElement.style.colorScheme = theme;
  syncThemeControls();
}

function setThemePreference(preference) {
  const normalized = THEME_CHOICES.includes(preference) ? preference : 'system';
  state.themePreference = normalized;
  try { localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, normalized); } catch {}
  applyThemePreference(normalized);
  toast(`外观已切换为${themeChoiceLabel(normalized)}`);
}

function handleSystemThemeChange() {
  if ((state.themePreference || getStoredThemePreference()) === 'system') {
    applyThemePreference('system');
  }
}

applyThemePreference(state.themePreference);
if (themeQuery.addEventListener) {
  themeQuery.addEventListener('change', handleSystemThemeChange);
} else if (themeQuery.addListener) {
  themeQuery.addListener(handleSystemThemeChange);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function closeAppDialog(result = null) {
  const dialog = state.activeDialog;
  if (!dialog) return;
  state.activeDialog = null;
  dialog.backdrop.classList.remove('open');
  dialog.panel.classList.remove('open');
  window.setTimeout(() => dialog.backdrop.remove(), 160);
  restoreFocus(dialog.returnFocus);
  dialog.resolve(result);
}

function openAppDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  fields = [],
} = {}) {
  if (state.activeDialog) closeAppDialog(null);
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    const fieldMarkup = fields.map(field => {
      const value = escapeHtml(field.value || '');
      const label = escapeHtml(field.label || field.name || '');
      const placeholder = escapeHtml(field.placeholder || '');
      const required = field.required ? ' required' : '';
      const input = field.multiline
        ? `<textarea class="app-dialog-input" data-dialog-field="${escapeAttr(field.name)}" rows="${field.rows || 5}" placeholder="${placeholder}"${required}>${value}</textarea>`
        : `<input class="app-dialog-input" data-dialog-field="${escapeAttr(field.name)}" type="text" value="${value}" placeholder="${placeholder}"${required}>`;
      return `<label class="app-dialog-field"><span>${label}</span>${input}</label>`;
    }).join('');

    backdrop.innerHTML = `
      <div class="app-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <div class="app-dialog-head">
          <strong>${escapeHtml(title)}</strong>
          ${message ? `<span>${escapeHtml(message)}</span>` : ''}
        </div>
        ${fieldMarkup ? `<div class="app-dialog-fields">${fieldMarkup}</div>` : ''}
        <div class="app-dialog-actions">
          <button class="btn btn-secondary" type="button" data-dialog-cancel>${escapeHtml(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-dialog-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const panel = backdrop.querySelector('.app-dialog');
    state.activeDialog = { backdrop, panel, resolve, returnFocus };

    const finish = (ok) => {
      if (!ok) return closeAppDialog(null);
      const values = {};
      for (const field of fields) {
        const control = backdrop.querySelector(`[data-dialog-field="${field.name}"]`);
        const value = control?.value?.trim?.() ?? '';
        if (field.required && !value) {
          control?.focus();
          toast('请先填写必要内容');
          return;
        }
        values[field.name] = value;
      }
      closeAppDialog(fields.length ? values : true);
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-dialog-cancel]')) finish(false);
      if (e.target.closest('[data-dialog-confirm]')) finish(true);
    });
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches('input[data-dialog-field]')) {
        e.preventDefault();
        finish(true);
      }
    });
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      panel?.classList.add('open');
      focusFirstInteractive(backdrop);
    });
  });
}

function appConfirm({ title, message, confirmText = '确定', danger = false } = {}) {
  return openAppDialog({ title, message, confirmText, danger });
}

function appPrompt({ title, message, fields, confirmText = '保存', danger = false } = {}) {
  return openAppDialog({ title, message, fields, confirmText, danger });
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function isMobileWebLayout() {
  return isMobileLayout();
}

function syncMobileWebMode() {
  const active = isMobileWebLayout();
  document.body?.classList.toggle('mobile-web-mode', active);
  dom.chatView?.toggleAttribute('data-mobile-web', active);
  if (!active) {
    document.body?.classList.remove('mobile-composer-focus', 'message-action-sheet-open');
  }
}

function syncMobileComposerFocus(focused) {
  document.body?.classList.toggle('mobile-composer-focus', Boolean(focused && isMobileWebLayout()));
}

function setElementSuppressed(el, suppressed) {
  if (!el) return;
  el.toggleAttribute('inert', Boolean(suppressed));
  el.setAttribute('aria-hidden', suppressed ? 'true' : 'false');
}

function focusFirstInteractive(root) {
  if (!root) return;
  const target = root.querySelector('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])');
  window.setTimeout(() => target?.focus?.({ preventScroll: true }), 30);
}

function restoreFocus(el) {
  if (!el || !document.contains(el)) return;
  window.setTimeout(() => el.focus?.({ preventScroll: true }), 30);
}

function closeMessageActionMenus(except = null) {
  dom.messagesContainer?.querySelectorAll('.message-action-menu.open').forEach(menu => {
    if (menu === except) return;
    menu.classList.remove('open');
    menu.querySelector('[data-message-menu-toggle]')?.setAttribute('aria-expanded', 'false');
    menu.querySelector('.message-action-popover')?.setAttribute('aria-hidden', 'true');
  });
  document.body?.classList.toggle('message-action-sheet-open', Boolean(except?.classList?.contains('open')));
}

function setMessageActionMenuOpen(menu, open) {
  if (!menu) return;
  menu.classList.toggle('open', Boolean(open));
  menu.querySelector('[data-message-menu-toggle]')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  menu.querySelector('.message-action-popover')?.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body?.classList.toggle('message-action-sheet-open', Boolean(open));
  if (open && isMobileWebLayout()) focusFirstInteractive(menu.querySelector('.message-action-popover'));
}

function closeMobileMessageActionSheet({ returnFocus = true } = {}) {
  const sheet = document.getElementById('mobileMessageActionSheet');
  const backdrop = document.getElementById('mobileMessageActionBackdrop');
  const returnSelector = sheet?.dataset.returnSelector || '';
  const returnTarget = returnSelector ? document.querySelector(returnSelector) : null;
  returnTarget?.setAttribute('aria-expanded', 'false');
  sheet?.remove();
  backdrop?.remove();
  document.body?.classList.remove('message-action-sheet-open');
  if (returnFocus && returnSelector) {
    returnTarget?.focus?.({ preventScroll: true });
  }
}

function openMobileMessageActionSheet(messageEl, triggerBtn) {
  if (!messageEl || !isMobileWebLayout()) return false;
  const messageId = messageEl.dataset.messageId || '';
  const msg = state.messages.find(m => String(m.id) === String(messageId));
  if (!msg) return false;

  closeMessageActionMenus();
  closeMobileMessageActionSheet({ returnFocus: false });

  const title = msg.role === 'assistant' ? 'AI 回答操作' : '我的消息操作';
  const actions = msg.role === 'assistant'
    ? [
        ['copy', '复制', ''],
        ['continue', '继续', ''],
        ['regenerate', '重答', ' message-action-danger'],
      ]
    : [
        ['copy', '复制', ''],
        ['retry-user', '重发', ''],
      ];

  const backdrop = document.createElement('div');
  backdrop.id = 'mobileMessageActionBackdrop';
  backdrop.className = 'mobile-message-action-backdrop';
  const sheet = document.createElement('div');
  sheet.id = 'mobileMessageActionSheet';
  sheet.className = 'mobile-message-action-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  if (triggerBtn && messageId) {
    const selector = `.message[data-message-id="${window.CSS && CSS.escape ? CSS.escape(messageId) : escapeAttr(messageId)}"] [data-message-menu-toggle]`;
    sheet.dataset.returnSelector = selector;
  }
  sheet.innerHTML = `
    <div class="message-action-sheet-head">
      <span>${escapeHtml(title)}</span>
      <span>轻点执行</span>
    </div>
    <div class="mobile-message-action-grid">
      ${actions.map(([action, label, extraClass]) => `<button class="message-action${extraClass}" type="button" data-action="${escapeAttr(action)}" data-message-id="${escapeAttr(messageId)}">${escapeHtml(label)}</button>`).join('')}
    </div>
  `;
  document.body.append(backdrop, sheet);
  document.body?.classList.add('message-action-sheet-open');
  triggerBtn?.setAttribute('aria-expanded', 'true');
  backdrop.addEventListener('click', () => {
    triggerBtn?.setAttribute('aria-expanded', 'false');
    closeMobileMessageActionSheet();
  });
  focusFirstInteractive(sheet);
  return true;
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.classList.add('hidden');
  });
  const target = document.getElementById(viewId);
  if (!target) return;
  target.classList.remove('hidden');
  target.classList.add('active');
}

function resetViewVisibility() {
  dom.authView.classList.add('hidden');
  dom.chatView.classList.add('hidden');
}

function syncResponsiveSidebarState() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  if (!sidebar.classList.contains('mobile-open')) {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('is-dragging-close');
    sidebar.style.removeProperty('--sidebar-drag-offset');
    setElementSuppressed(sidebar, true);
    dom.sidebarBackdrop?.classList.add('hidden');
    dom.sidebarBackdrop?.classList.remove('open');
    setElementSuppressed(dom.sidebarBackdrop, true);
    document.body.classList.remove('sidebar-open', 'sidebar-docked');
  }
}

function openSidebarOnMobile({ refresh = true, resetSearch = false } = {}) {
  const sidebar = document.getElementById('sidebar');
  if (resetSearch) {
    state.chatSearchQuery = '';
    if (dom.chatSearchInput) dom.chatSearchInput.value = '';
  }
  state.sidebarReturnFocus = document.activeElement;
  sidebar?.classList.remove('hidden');
  sidebar?.classList.add('mobile-open');
  setElementSuppressed(sidebar, false);
  setElementSuppressed(dom.sidebarBackdrop, false);
  dom.sidebarBackdrop?.classList.add('open');
  dom.sidebarBackdrop?.classList.remove('hidden');
  document.body.classList.add('sidebar-open');
  document.querySelectorAll('[aria-controls="sidebar"]').forEach(btn => btn.setAttribute('aria-expanded', 'true'));
  setElementSuppressed(document.getElementById('main'), true);
  setElementSuppressed(document.querySelector('.dialogue-rail'), true);
  if (refresh && state.token) loadChats({ showLoading: state.chats.length === 0, notifyError: true });
  focusFirstInteractive(sidebar);
}

function closeSidebarOnMobile({ returnFocus = true } = {}) {
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.remove('mobile-open', 'is-dragging-close');
  sidebar?.style.removeProperty('--sidebar-drag-offset');
  dom.sidebarBackdrop?.classList.remove('open');
  document.body.classList.remove('sidebar-open');
  document.querySelectorAll('[aria-controls="sidebar"]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  setElementSuppressed(document.getElementById('main'), false);
  setElementSuppressed(document.querySelector('.dialogue-rail'), false);
  window.setTimeout(() => {
    if (!dom.sidebarBackdrop?.classList.contains('open')) {
      dom.sidebarBackdrop?.classList.add('hidden');
      sidebar?.classList.add('hidden');
      setElementSuppressed(sidebar, true);
      setElementSuppressed(dom.sidebarBackdrop, true);
      if (returnFocus) restoreFocus(state.sidebarReturnFocus);
      state.sidebarReturnFocus = null;
    }
  }, 180);
}

function bindSidebarSwipeToClose() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || !dom.sidebarBackdrop) return;

  let gesture = null;
  const resetDrag = () => {
    sidebar.classList.remove('is-dragging-close');
    sidebar.style.removeProperty('--sidebar-drag-offset');
  };
  const start = (event) => {
    if (!isMobileLayout() || !sidebar.classList.contains('mobile-open') || event.touches.length !== 1) return;
    const touch = event.touches[0];
    gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      tracking: false,
    };
  };
  const move = (event) => {
    if (!gesture || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    gesture.lastX = touch.clientX;

    if (!gesture.tracking) {
      if (Math.abs(dx) < 10) return;
      if (dx >= 0 || Math.abs(dy) > Math.abs(dx) * 1.15) {
        gesture = null;
        return;
      }
      gesture.tracking = true;
      sidebar.classList.add('is-dragging-close');
    }

    event.preventDefault();
    sidebar.style.setProperty('--sidebar-drag-offset', `${Math.max(dx, -sidebar.offsetWidth)}px`);
  };
  const end = () => {
    if (!gesture) return;
    const shouldClose = gesture.tracking && gesture.startX - gesture.lastX > 58;
    gesture = null;
    if (shouldClose) closeSidebarOnMobile();
    else resetDrag();
  };

  sidebar.addEventListener('touchstart', start, { passive: true });
  sidebar.addEventListener('touchmove', move, { passive: false });
  sidebar.addEventListener('touchend', end, { passive: true });
  sidebar.addEventListener('touchcancel', end, { passive: true });
  dom.sidebarBackdrop.addEventListener('touchstart', start, { passive: true });
  dom.sidebarBackdrop.addEventListener('touchmove', move, { passive: false });
  dom.sidebarBackdrop.addEventListener('touchend', end, { passive: true });
  dom.sidebarBackdrop.addEventListener('touchcancel', end, { passive: true });
}

function syncMobileMoreMenu() {
  syncThemeControls();
}

function openMobileMoreMenu() {
  if (!dom.mobileMoreMenu || !dom.mobileMoreBackdrop) return;
  syncMobileMoreMenu();
  state.moreReturnFocus = document.activeElement;
  closeSidebarOnMobile({ returnFocus: false });
  setElementSuppressed(dom.mobileMoreMenu, false);
  setElementSuppressed(dom.mobileMoreBackdrop, false);
  dom.mobileMoreMenu.classList.remove('hidden');
  dom.mobileMoreBackdrop.classList.remove('hidden');
  dom.mobileMoreBtn?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-more-open');
  dom.mobileMoreMenu.classList.add('open');
  dom.mobileMoreBackdrop.classList.add('open');
  requestAnimationFrame(() => {
    dom.mobileMoreMenu.classList.add('open');
    dom.mobileMoreBackdrop.classList.add('open');
  });
  focusFirstInteractive(dom.mobileMoreMenu);
}

function closeMobileMoreMenu() {
  if (!dom.mobileMoreMenu || !dom.mobileMoreBackdrop) return;
  dom.mobileMoreMenu.classList.remove('open');
  dom.mobileMoreBackdrop.classList.remove('open');
  dom.mobileMoreBtn?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-more-open');
  window.setTimeout(() => {
    if (!dom.mobileMoreMenu.classList.contains('open')) {
      dom.mobileMoreMenu.classList.add('hidden');
      setElementSuppressed(dom.mobileMoreMenu, true);
      restoreFocus(state.moreReturnFocus);
      state.moreReturnFocus = null;
    }
    if (!dom.mobileMoreBackdrop.classList.contains('open')) {
      dom.mobileMoreBackdrop.classList.add('hidden');
      setElementSuppressed(dom.mobileMoreBackdrop, true);
    }
  }, 180);
}

function syncWebSearchToggle() {
  const btn = dom.webSearchToggle;
  if (!btn) return;
  btn.hidden = !state.webSearchAvailable;
  btn.classList.toggle('hidden', !state.webSearchAvailable);
  btn.disabled = !state.webSearchAvailable || state.streaming;
  btn.classList.toggle('active', state.webSearchEnabled && state.webSearchAvailable);
  btn.classList.toggle('is-unavailable', !state.webSearchAvailable);
  btn.setAttribute('aria-pressed', state.webSearchEnabled && state.webSearchAvailable ? 'true' : 'false');
  btn.title = state.webSearchAvailable
    ? (state.webSearchEnabled ? '本条消息将联网搜索' : '开启本条消息联网搜索')
    : '联网搜索未配置';
}

function setWebSearchAvailability(enabled) {
  state.webSearchAvailable = Boolean(enabled);
  if (!state.webSearchAvailable) state.webSearchEnabled = false;
  syncWebSearchToggle();
}

function setWebSearchEnabled(enabled) {
  state.webSearchEnabled = Boolean(enabled) && state.webSearchAvailable;
  syncWebSearchToggle();
}

function setSelectedModel(modelId) {
  const normalized = normalizeChatModel(modelId);
  if (normalized) dom.modelSelect.value = normalized;
}

async function loadModels() {
  try {
    const data = await API.get('/models');
    state.models = data.models || [];
    state.defaultModel = state.models[0]?.id || '';
    ALLOWED_CHAT_MODELS.splice(0, ALLOWED_CHAT_MODELS.length, ...state.models.map(model => model.id));
    dom.modelSelect.innerHTML = state.models.length
      ? state.models.map(model => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.id)}</option>`).join('')
      : '<option value="">未配置模型</option>';
    dom.modelSelect.value = normalizeChatModel(state.currentChat?.model || state.defaultModel);
    setWebSearchAvailability(Boolean(data.webSearch?.enabled));
  } catch (err) {
    console.error('Failed to load models:', err);
    setWebSearchAvailability(false);
    toast('模型加载失败');
  }
}

const sidebarController = createSidebarController({
  state,
  dom,
  API,
  allowedChatModels: ALLOWED_CHAT_MODELS,
  defaultChatModel: DEFAULT_CHAT_MODEL,
  normalizeChatModel,
  escapeHtml,
  escapeAttr,
  toast,
  appConfirm,
  appPrompt,
  openChat,
  closeSidebarOnMobile,
});
const {
  batchDeleteSelected,
  enterBatchMode,
  exitBatchMode,
  loadChats,
  renderChatList,
  renameChat,
  showEmptyState,
  updateChatHeaderTitle,
} = sidebarController;

function cleanupStreamingBubble() {
  const stream = document.getElementById('streamingMessage');
  if (stream) stream.remove();
}

function getMessageElement(messageId) {
  if (!messageId) return null;
  const safeId = String(messageId).replace(/"/g, '&quot;');
  return dom.messagesContainer.querySelector(`.message[data-message-id="${safeId}"]`);
}

function findPreviousUserMessageId(messageId) {
  const idx = state.messages.findIndex(m => String(m.id) === String(messageId));
  if (idx <= 0 || state.messages[idx]?.role !== 'assistant') return null;
  for (let i = idx - 1; i >= 0; i--) {
    if (state.messages[i]?.role === 'user') return state.messages[i].id;
  }
  return null;
}

function setMessageBubbleStreaming(messageEl, statusText = '生成中…') {
  if (!messageEl) return null;
  messageEl.classList.add('is-streaming');
  const body = messageEl.querySelector('.message-body');
  if (!body) return null;
  body.innerHTML = `
    <div class="message-content streaming-cursor"></div>
    <div class="message-actions"><span class="message-status">${escapeHtml(statusText)}</span></div>
  `;
  return body.querySelector('.message-content');
}

function renderMessages({ scroll = true } = {}) {
  cleanupStreamingBubble();
  dom.messagesContainer.innerHTML = '';
  const shouldLimit = state.messages.length > MESSAGE_RENDER_LIMIT && !state.messageRenderExpanded;
  const messages = shouldLimit ? state.messages.slice(-MESSAGE_RENDER_LIMIT) : state.messages;
  if (shouldLimit) {
    const loadMore = document.createElement('button');
    loadMore.className = 'older-messages-btn';
    loadMore.type = 'button';
    loadMore.textContent = `加载更早的 ${state.messages.length - messages.length} 条消息`;
    loadMore.addEventListener('click', () => {
      state.messageRenderExpanded = true;
      renderMessages({ scroll: false });
      dom.messagesContainer.scrollTo({ top: 0, behavior: 'auto' });
    });
    dom.messagesContainer.appendChild(loadMore);
  }
  for (const msg of messages) {
    dom.messagesContainer.appendChild(createMessageElement(msg));
  }
  if (scroll) scrollToBottom({ smooth: false });
}

function isNearBottom(el = dom.messagesContainer, threshold = 120) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function scrollToBottom({ smooth = true } = {}) {
  requestAnimationFrame(() => {
    try {
      dom.messagesContainer.scrollTo({
        top: dom.messagesContainer.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    } catch {
      dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
    }
    syncScrollToBottomButton();
  });
}

function syncScrollToBottomButton() {
  if (!dom.scrollToBottomBtn) return;
  const el = dom.messagesContainer;
  const activeTab = document.getElementById('tabNav')?.querySelector('.tab-btn.active')?.dataset.tab;
  if (!el || activeTab !== 'chat') {
    dom.scrollToBottomBtn.classList.add('hidden');
    return;
  }
  // Show the "back to latest" button whenever the user is scrolled up — including
  // mid-stream, so they can return after reading earlier content.
  dom.scrollToBottomBtn.classList.toggle('hidden', isNearBottom(el));
}

function compactPlainText(text = '', maxChars = 1200) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + '…';
}

function applyPromptToInput(text, { append = false } = {}) {
  if (!dom.messageInput) return;
  const current = dom.messageInput.value.trim();
  dom.messageInput.value = append && current ? `${current}\n\n${text}` : text;
  resizeComposer();
  updateSendButton();
  saveInputDraft();
  dom.messageInput.focus();
}

function chatDraftKey(chatId = state.currentChat?.id || 'new') {
  return `${CHAT_DRAFT_STORAGE_PREFIX}${chatId || 'new'}`;
}

function saveInputDraft() {
  if (!dom.messageInput) return;
  const value = dom.messageInput.value || '';
  const key = chatDraftKey();
  try {
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {}
}

function clearInputDraftByKey(key) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
}

function clearCurrentInputDraft() {
  clearInputDraftByKey(chatDraftKey());
}

function restoreInputDraft(chatId = state.currentChat?.id || 'new') {
  if (!dom.messageInput) return;
  let value = '';
  try { value = localStorage.getItem(chatDraftKey(chatId)) || ''; } catch {}
  dom.messageInput.value = value;
  resizeComposer();
  updateSendButton();
}

function getMessageElementById(messageId) {
  if (!messageId) return null;
  const escaped = window.CSS && CSS.escape ? CSS.escape(String(messageId)) : escapeAttr(messageId);
  return dom.messagesContainer.querySelector(`.message[data-message-id="${escaped}"]`);
}

function setMessageContent(messageId, html, { streaming = false } = {}) {
  const el = getMessageElementById(messageId);
  if (!el) return null;
  const contentNode = el.querySelector('.message-content');
  if (!contentNode) return null;
  contentNode.innerHTML = html;
  if (streaming) contentNode.classList.add('streaming-cursor');
  else contentNode.classList.remove('streaming-cursor');
  enhanceMessageContent(contentNode);
  return contentNode;
}

function abortActiveRequest() {
  if (state.streaming && state.streamAbort) {
    try { state.streamAbort.abort(); } catch {}
  }
}

function updateSendButton() {
  const hasText = dom.messageInput.value.trim().length > 0;
  const canSend = hasText && !state.streaming;

  if (dom.sendBtn) {
    dom.sendBtn.classList.toggle('hidden', state.streaming);
    dom.sendBtn.disabled = !canSend;
    if (!state.streaming) {
      dom.sendBtn.innerHTML = '<span class="ui-icon icon-send" aria-hidden="true"></span>';
      dom.sendBtn.title = '发送消息';
    }
  }

  if (dom.stopBtn) {
    dom.stopBtn.classList.toggle('hidden', !state.streaming);
    dom.stopBtn.disabled = !state.streaming;
    dom.stopBtn.title = '停止生成';
  }
  if (dom.messageInput) {
    dom.messageInput.disabled = false;
  }
  syncWebSearchToggle();
  syncScrollToBottomButton();
}

function resizeComposer() {
  if (!dom.messageInput) return;
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 720;
  const maxHeight = isMobile
    ? Math.min(180, Math.max(128, Math.round(viewportHeight * 0.32)))
    : 240;
  dom.messageInput.style.height = 'auto';
  const nextHeight = Math.min(dom.messageInput.scrollHeight, maxHeight);
  dom.messageInput.style.height = nextHeight + 'px';
  dom.messageInput.style.overflowY = dom.messageInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function appendStreamingBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'message message-role-assistant is-streaming';
  bubble.id = 'streamingMessage';
  bubble.dataset.role = 'assistant';
  bubble.innerHTML = `
      <div class="message-avatar">AI</div>
      <div class="message-body">
        <div class="message-content streaming-cursor"></div>
        <div class="message-actions"><span class="message-status">正在生成，可随时停止</span></div>
      </div>
  `;
  dom.messagesContainer.appendChild(bubble);
  scrollToBottom();
  return bubble.querySelector('.message-content');
}

async function copyMessage(messageId) {
  const msg = state.messages.find(m => String(m.id) === String(messageId));
  if (!msg) return toast('Message not found');
  await copyMessageContent(msg.content || '');
}

async function copyMessageContent(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制');
  }
}

function continueFromMessage(messageId) {
  const msg = state.messages.find(m => String(m.id) === String(messageId));
  if (!msg) return toast('找不到这条消息');
  applyPromptToInput('请继续上面的回答，保持同样的语气和结构，不要重复已经说过的内容。');
}

async function retryUserMessage(messageId) {
  if (state.streaming) return toast('正在生成中');
  const msg = state.messages.find(m => String(m.id) === String(messageId));
  const content = msg?.role === 'user' ? String(msg.content || '').trim() : '';
  if (!content) return toast('没有可重发的内容');
  await sendPrompt(content, { clearInput: false });
}

function continueStoppedDraft() {
  const draft = state.stoppedDraft;
  if (!draft?.content) {
    applyPromptToInput('请继续刚才被中断的回答，不要重复已经说过的内容。');
    return;
  }
  const partial = compactPlainText(draft.content, 1400);
  applyPromptToInput(`上一次回答被中断，已生成的内容如下：\n\n${partial}\n\n请从中断处继续，不要重复已生成内容。`);
}

async function regenerateFromAssistant(messageId) {
  if (state.streaming) return toast('正在生成中');

  const sourceUserMessageId = findPreviousUserMessageId(messageId);
  if (!sourceUserMessageId) {
    return toast('无法重答这条消息');
  }

  await sendPrompt('', {
    clearInput: false,
    mode: 'regenerate',
    assistantMessageId: messageId,
    sourceUserMessageId,
  });
}

async function sendPrompt(content, { clearInput = true, mode = 'send', assistantMessageId = null, sourceUserMessageId = null } = {}) {
  if (state.streaming) return;

  cleanupStreamingBubble();
  const text = (content || '').trim();
  if (mode === 'send' && !text) return;
  const draftKeyAtStart = chatDraftKey();
  state.stoppedDraft = null;

  if (!state.currentChat) {
    await newChat();
    if (!state.currentChat) return;
  }

  const model = normalizeChatModel(dom.modelSelect.value);
  setSelectedModel(model);

  const messagesEl = dom.messagesContainer;
  dom.emptyState.classList.add('hidden');
  messagesEl.classList.remove('hidden');

  const requestId = ++state.activeRequestId;
  const controller = new AbortController();
  state.streaming = true;
  state.streamAbort = controller;
  updateSendButton();

  if (clearInput) {
    dom.messageInput.value = '';
    resizeComposer();
    updateSendButton();
  }

  let streamContentEl = null;
  let regenOriginalMessage = null;
  let regenOriginalEl = null;
  let regenMessageIndex = -1;
  let responseStarted = false;
  let tempUserMessage = null;

  if (mode === 'send') {
    const userMsg = {
      id: `temp-user-${requestId}`,
      chat_id: state.currentChat.id,
      role: 'user',
      content: text,
    };
    tempUserMessage = userMsg;
    state.messages.push(userMsg);
    messagesEl.appendChild(createMessageElement(userMsg));
    scrollToBottom();

    const bubble = document.createElement('div');
    bubble.className = 'message message-role-assistant is-streaming';
    bubble.id = 'streamingMessage';
    bubble.dataset.role = 'assistant';
    bubble.innerHTML = `
      <div class="message-avatar">AI</div>
      <div class="message-body">
        <div class="message-content streaming-cursor"></div>
        <div class="message-actions"><span class="message-status">正在生成，可随时停止</span></div>
      </div>
    `;
    messagesEl.appendChild(bubble);
    streamContentEl = bubble.querySelector('.message-content');
  } else {
    regenMessageIndex = state.messages.findIndex(m => String(m.id) === String(assistantMessageId));
    if (regenMessageIndex < 0 || state.messages[regenMessageIndex]?.role !== 'assistant') {
      state.streaming = false;
      state.streamAbort = null;
      updateSendButton();
      return toast('无法重答这条消息');
    }

    regenOriginalMessage = { ...state.messages[regenMessageIndex] };
    regenOriginalEl = getMessageElement(assistantMessageId);
    if (regenOriginalEl) {
      streamContentEl = setMessageBubbleStreaming(regenOriginalEl, '正在重新生成');
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'message message-role-assistant is-streaming';
      bubble.id = 'streamingMessage';
      bubble.dataset.role = 'assistant';
      bubble.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-body">
          <div class="message-content streaming-cursor"></div>
          <div class="message-actions"><span class="message-status">正在重新生成</span></div>
        </div>
      `;
      messagesEl.appendChild(bubble);
      streamContentEl = bubble.querySelector('.message-content');
    }
  }

  let fullContent = '';
  let finalize = 'pending';
  let assistantMessage = null;
  let responseContextStatus = null;
  let responseSearchResults = [];

  const body = {
    model,
    webSearch: Boolean(state.webSearchEnabled && state.webSearchAvailable),
  };
  if (mode === 'send') {
    body.content = text;
  } else {
    body.regenerateFromMessageId = sourceUserMessageId;
    body.replaceMessageId = assistantMessageId;
  }

  const renderLiveContent = (target, value) => {
    if (!target) return;
    target.innerHTML = renderMarkdown(value);
    enhanceMessageContent(target);
    target.classList.add('streaming-cursor');
  };

  const updateStreamStatus = (message, status = '') => {
    const bodyEl = streamContentEl?.closest('.message-body')
      || document.getElementById('streamingMessage')?.querySelector('.message-body')
      || regenOriginalEl?.querySelector('.message-body');
    const statusEl = bodyEl?.querySelector('.message-status');
    if (!statusEl || !message) return;
    statusEl.textContent = message;
    statusEl.dataset.status = status;
  };

  const updateStreamingExtras = () => {
    const bodyEl = streamContentEl?.closest('.message-body')
      || document.getElementById('streamingMessage')?.querySelector('.message-body')
      || regenOriginalEl?.querySelector('.message-body');
    updateMessageExtras(bodyEl, {
      contextStatus: responseContextStatus,
      searchResults: responseSearchResults,
    });
  };

  try {
    const res = await fetch(`/api/chats/${state.currentChat.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errText = 'Stream failed';
      try {
        const err = await res.json();
        errText = err.error || errText;
      } catch {
        errText = await res.text().catch(() => errText);
      }
      throw new Error(errText || 'Stream failed');
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('响应为空');
    const decoder = new TextDecoder();
    let buffer = '';

    const processEvent = (rawEvent) => {
      const lines = rawEvent.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (parsed.type === 'content') {
          responseStarted = true;
          // Only follow the stream if the user is already near the bottom; if they
          // scrolled up to read, don't yank them back down.
          const stick = isNearBottom();
          fullContent += parsed.content || '';
          renderLiveContent(streamContentEl, fullContent);
          if (stick) scrollToBottom({ smooth: false });
        } else if (parsed.type === 'search_status') {
          updateStreamStatus(parsed.message || '联网搜索状态已更新', parsed.status || '');
        } else if (parsed.type === 'context_status') {
          responseContextStatus = normalizeContextStatus(parsed.context);
          updateStreamingExtras();
        } else if (parsed.type === 'search_results') {
          responseSearchResults = normalizeSearchResults(parsed.results);
          updateStreamingExtras();
        } else if (parsed.type === 'done') {
          if (parsed.userMessageId && tempUserMessage) {
            const oldId = tempUserMessage.id;
            tempUserMessage.id = parsed.userMessageId;
            const userEl = getMessageElement(oldId);
            if (userEl) userEl.dataset.messageId = parsed.userMessageId;
          }
          assistantMessage = {
            id: parsed.messageId || `assistant-${requestId}`,
            chat_id: state.currentChat.id,
            role: 'assistant',
            content: fullContent,
            contextStatus: responseContextStatus,
            searchResults: responseSearchResults,
          };
          finalize = 'done';
        } else if (parsed.type === 'error') {
          throw new Error(parsed.error || 'Stream failed');
        }
      }
    };

    while (true) {
      if (state.activeRequestId !== requestId) {
        throw new DOMException('Request superseded', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split(/\n\n+/);
      buffer = events.pop() || '';
      for (const event of events) {
        if (!event.trim()) continue;
        processEvent(event);
        if (finalize === 'done') break;
      }
      if (finalize === 'done') break;
    }

    if (buffer.trim() && finalize !== 'done') {
      processEvent(buffer);
    }

    if (!assistantMessage && fullContent.trim()) {
      assistantMessage = {
        id: `assistant-${requestId}`,
        chat_id: state.currentChat.id,
        role: 'assistant',
        content: fullContent,
        contextStatus: responseContextStatus,
        searchResults: responseSearchResults,
      };
      finalize = 'done';
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      finalize = 'abort';
    } else {
      finalize = 'error';
      const target = streamContentEl || document.querySelector('#streamingMessage .message-content');
      if (target) {
        target.innerHTML = `<span style="color:var(--danger)">Error: ${escapeHtml(err.message || 'Request failed')}</span>`;
        target.classList.remove('streaming-cursor');
      }
    }
  } finally {
    state.streaming = false;
    state.streamAbort = null;
    updateSendButton();

    if (finalize === 'done' && assistantMessage) {
      if (mode === 'send') {
        state.messages.push(assistantMessage);
        clearInputDraftByKey(draftKeyAtStart);
        clearCurrentInputDraft();
        const bubble = document.getElementById('streamingMessage');
        if (bubble) {
          bubble.replaceWith(createMessageElement(assistantMessage));
        } else {
          messagesEl.appendChild(createMessageElement(assistantMessage));
        }
      } else if (regenMessageIndex >= 0) {
        state.messages = [...state.messages.slice(0, regenMessageIndex), assistantMessage];
        renderMessages();
      }
      await loadChats();
      if (mode === 'regenerate') {
        await loadMessages();
        const refreshed = state.messages.find(m => String(m.id) === String(assistantMessage.id));
        if (refreshed) {
          refreshed.contextStatus = assistantMessage.contextStatus;
          refreshed.searchResults = assistantMessage.searchResults;
          renderMessages();
        }
      } else {
        scrollToBottom();
      }
    } else if (finalize === 'abort') {
      if (mode === 'regenerate' && regenOriginalMessage) {
        const currentEl = regenOriginalEl && regenOriginalEl.isConnected ? regenOriginalEl : getMessageElement(assistantMessageId);
        if (currentEl && currentEl.isConnected) {
          currentEl.replaceWith(createMessageElement(regenOriginalMessage));
        }
      } else if (mode === 'send') {
        state.stoppedDraft = fullContent.trim()
          ? { content: fullContent, prompt: text, chatId: state.currentChat?.id || '' }
          : { content: '', prompt: text, chatId: state.currentChat?.id || '' };
        const bubble = document.getElementById('streamingMessage');
        if (bubble) {
          const contentNode = bubble.querySelector('.message-content');
          if (contentNode) {
            state.stoppedDraft = fullContent.trim()
              ? { content: fullContent, prompt: text, chatId: state.currentChat?.id || '' }
              : { content: '', prompt: text, chatId: state.currentChat?.id || '' };
            contentNode.innerHTML = responseStarted
              ? renderMarkdown(fullContent || '')
              : '<span class="message-status">已停止</span>';
            contentNode.classList.remove('streaming-cursor');
            enhanceMessageContent(contentNode);
            const actions = bubble.querySelector('.message-actions');
            if (actions) {
              actions.innerHTML = `
                <span class="message-status">已停止</span>
                <button class="message-action" type="button" data-action="continue-stopped">继续生成</button>
                ${fullContent.trim() ? '<button class="message-action" type="button" data-action="copy-stopped">复制已生成</button>' : ''}
              `;
            }
          }
        }
      }
      await loadChats();
    } else if (finalize === 'error') {
      if (mode === 'regenerate' && regenOriginalMessage) {
        const currentEl = regenOriginalEl && regenOriginalEl.isConnected ? regenOriginalEl : getMessageElement(assistantMessageId);
        if (currentEl && currentEl.isConnected) {
          currentEl.replaceWith(createMessageElement(regenOriginalMessage));
        }
      } else if (mode === 'send') {
        state.stoppedDraft = {
          content: fullContent || '',
          prompt: text,
          chatId: state.currentChat?.id || '',
        };
        if (clearInput && !dom.messageInput.value.trim()) {
          dom.messageInput.value = text;
          resizeComposer();
          updateSendButton();
          saveInputDraft();
        }
        const bubble = document.getElementById('streamingMessage');
        if (bubble) {
          const contentNode = bubble.querySelector('.message-content');
          if (contentNode) {
            contentNode.classList.remove('streaming-cursor');
          }
          const actions = bubble.querySelector('.message-actions');
          if (actions) {
            actions.innerHTML = `
              <span class="message-status" data-status="error">出错，可重试</span>
              <button class="message-action" type="button" data-action="retry-last">重试</button>
              ${fullContent.trim() ? '<button class="message-action" type="button" data-action="continue-stopped">继续生成</button><button class="message-action" type="button" data-action="copy-stopped">复制已生成</button>' : ''}
            `;
          }
        }
      }
    }

    dom.messageInput.focus();
  }
}

async function sendMessage() {
  await sendPrompt(dom.messageInput.value.trim(), { clearInput: true });
}

async function runMessageAction(action, messageId, btn) {
  if (action === 'continue-stopped') return continueStoppedDraft();
  if (action === 'copy-stopped') {
    if (!state.stoppedDraft?.content?.trim()) return toast('没有可复制的内容');
    return copyMessageContent(state.stoppedDraft.content);
  }
  if (action === 'retry-last') {
    const prompt = state.stoppedDraft?.prompt || dom.messageInput?.value?.trim?.() || '';
    if (!prompt) return toast('没有可重试的内容');
    return sendPrompt(prompt, { clearInput: true });
  }
  if (!messageId) return;
  if (action === 'copy') {
    await copyMessage(messageId);
    const original = btn?.textContent;
    if (btn) {
      btn.textContent = '已复制';
      btn.classList.add('is-success');
      window.setTimeout(() => {
        btn.textContent = original || '复制';
        btn.classList.remove('is-success');
      }, 1100);
    }
  } else if (action === 'retry-user') {
    await retryUserMessage(messageId);
  } else if (action === 'continue') {
    continueFromMessage(messageId);
  } else if (action === 'regenerate') {
    await regenerateFromAssistant(messageId);
  }
}

async function newChat() {
  abortActiveRequest();
  const model = normalizeChatModel(dom.modelSelect.value);
  setSelectedModel(model);

  try {
    const data = await API.post('/chats', { model });
    state.currentChat = { ...data.chat, model: normalizeChatModel(data.chat?.model) };
    state.messages = [];
    state.messageRenderExpanded = false;
    updateChatHeaderTitle();
    await loadChats();
    dom.emptyState.classList.add('hidden');
    dom.messagesContainer.classList.remove('hidden');
    dom.messagesContainer.innerHTML = '';
    restoreInputDraft(state.currentChat.id);
    closeSidebarOnMobile();
  } catch (err) {
    toast('创建会话失败');
  }
}

async function openChat(chat) {
  abortActiveRequest();
  state.currentChat = { ...chat, model: normalizeChatModel(chat.model) };
  state.messages = [];
  state.messageRenderExpanded = false;
  renderChatList();
  updateChatHeaderTitle();
  dom.emptyState.classList.add('hidden');
  dom.messagesContainer.classList.remove('hidden');
  setSelectedModel(state.currentChat.model);
  await loadMessages();
  restoreInputDraft(state.currentChat.id);
}

async function loadMessages() {
  if (!state.currentChat) return;

  try {
    const data = await API.get(`/chats/${state.currentChat.id}/messages`);
    state.messages = data.messages || [];
    renderMessages();
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

function afterLogin() {
  showView('chatView');
  dom.userName.textContent = state.user.username;
  dom.userAvatar.textContent = state.user.username[0].toUpperCase();
  syncResponsiveSidebarState();
  loadChats();
  loadModels();
  restoreInputDraft('new');
}

function initAuth() {
  dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dom.tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      dom.loginForm.classList.toggle('hidden', !isLogin);
      dom.registerForm.classList.toggle('hidden', isLogin);
      dom.loginError.classList.add('hidden');
      dom.regError.classList.add('hidden');
    });
  });

  dom.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.loginError.classList.add('hidden');

    try {
      const data = await API.post('/auth/login', {
        login: dom.loginUser.value.trim(),
        password: dom.loginPass.value,
      });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('ai_chat_token', data.token);
      afterLogin();
    } catch (err) {
      dom.loginError.textContent = err.message;
      dom.loginError.classList.remove('hidden');
    }
  });

  dom.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    dom.regError.classList.add('hidden');

    const username = dom.regUser.value.trim();
    const email = dom.regEmail.value.trim();
    const password = dom.regPass.value;

    if (password.length < 6) {
      dom.regError.textContent = '密码至少需要 6 位字符';
      dom.regError.classList.remove('hidden');
      return;
    }

    try {
      const data = await API.post('/auth/register', { username, email, password });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('ai_chat_token', data.token);
      afterLogin();
    } catch (err) {
      dom.regError.textContent = err.message;
      dom.regError.classList.remove('hidden');
    }
  });
}

async function checkAuth() {
  if (!state.token) {
    showView('authView');
    return;
  }
  try {
    const data = await API.get('/auth/me');
    state.user = data.user;
    afterLogin();
  } catch {
    localStorage.removeItem('ai_chat_token');
    state.token = null;
    showView('authView');
  }
}

function setSettingsMessage(text, kind = '') {
  const el = dom.settingsMessage;
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    el.removeAttribute('data-kind');
    return;
  }
  el.textContent = text;
  el.dataset.kind = kind;
  el.classList.remove('hidden');
}

function openSettings() {
  if (!dom.settingsModal) return;
  dom.settingsModal._returnFocus = document.activeElement;
  if (dom.settingsUsername) dom.settingsUsername.value = state.user?.username || '';
  if (dom.settingsNewPassword) dom.settingsNewPassword.value = '';
  if (dom.settingsConfirmPassword) dom.settingsConfirmPassword.value = '';
  if (dom.settingsCurrentPassword) dom.settingsCurrentPassword.value = '';
  setSettingsMessage('');
  syncThemeControls();
  dom.settingsBackdrop?.classList.remove('hidden');
  dom.settingsModal.classList.remove('hidden');
  setElementSuppressed(dom.settingsModal, false);
  setElementSuppressed(dom.settingsBackdrop, false);
  setTimeout(() => dom.settingsUsername?.focus(), 30);
}

function closeSettings() {
  const wasOpen = dom.settingsModal && !dom.settingsModal.classList.contains('hidden');
  dom.settingsModal?.classList.add('hidden');
  dom.settingsBackdrop?.classList.add('hidden');
  setElementSuppressed(dom.settingsModal, true);
  setElementSuppressed(dom.settingsBackdrop, true);
  if (wasOpen) restoreFocus(dom.settingsModal._returnFocus);
}

async function submitSettings(e) {
  e.preventDefault();
  const currentPassword = dom.settingsCurrentPassword?.value || '';
  const newUsername = (dom.settingsUsername?.value || '').trim();
  const newPassword = dom.settingsNewPassword?.value || '';
  const confirmPassword = dom.settingsConfirmPassword?.value || '';

  const usernameChanged = newUsername && newUsername !== (state.user?.username || '');
  const wantsPassword = newPassword.length > 0;

  if (!usernameChanged && !wantsPassword) return setSettingsMessage('没有需要修改的内容', 'error');
  if (usernameChanged && (newUsername.length < 2 || newUsername.length > 30)) {
    return setSettingsMessage('用户名需为 2-30 个字符', 'error');
  }
  if (wantsPassword && newPassword.length < 6) return setSettingsMessage('新密码至少 6 位字符', 'error');
  if (wantsPassword && newPassword !== confirmPassword) return setSettingsMessage('两次输入的新密码不一致', 'error');
  if (!currentPassword) return setSettingsMessage('请输入当前密码以确认修改', 'error');

  const payload = { currentPassword };
  if (usernameChanged) payload.newUsername = newUsername;
  if (wantsPassword) payload.newPassword = newPassword;

  const btn = dom.settingsSaveBtn;
  const original = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  try {
    // authRedirect:false so a wrong current password (400) doesn't trip the
    // global 401/redirect handling; we surface the message inline instead.
    const data = await API.patch('/auth/profile', payload, { authRedirect: false });
    if (data.token) {
      state.token = data.token;
      try { localStorage.setItem('ai_chat_token', data.token); } catch {}
    }
    if (data.user) {
      state.user = data.user;
      if (dom.userName) dom.userName.textContent = data.user.username;
      if (dom.userAvatar && data.user.username) dom.userAvatar.textContent = data.user.username[0].toUpperCase();
      if (dom.settingsUsername) dom.settingsUsername.value = data.user.username;
    }
    if (dom.settingsNewPassword) dom.settingsNewPassword.value = '';
    if (dom.settingsConfirmPassword) dom.settingsConfirmPassword.value = '';
    if (dom.settingsCurrentPassword) dom.settingsCurrentPassword.value = '';
    setSettingsMessage('已保存', 'success');
    toast('设置已更新');
    setTimeout(closeSettings, 800);
  } catch (err) {
    setSettingsMessage(err.message || '保存失败', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original || '保存修改'; }
  }
}

function initEvents() {
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.add('hidden');
  for (const element of [sidebar, dom.sidebarBackdrop, dom.mobileMoreMenu, dom.mobileMoreBackdrop, dom.settingsModal, dom.settingsBackdrop]) {
    setElementSuppressed(element, true);
  }

  dom.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('ai_chat_token');
    abortActiveRequest();
    Object.assign(state, { token: null, user: null, chats: [], currentChat: null, messages: [], batchMode: false });
    state.batchSelected.clear();
    closeSidebarOnMobile();
    closeMobileMoreMenu();
    showView('authView');
  });

  dom.newChatBtn.addEventListener('click', newChat);
  dom.mobileNewChatBtn?.addEventListener('click', newChat);
  document.getElementById('railNewChatBtn')?.addEventListener('click', newChat);
  document.getElementById('railChatBtn')?.addEventListener('click', () => {
    closeSidebarOnMobile({ returnFocus: false });
    dom.messageInput.focus();
  });
  for (const id of ['railHistoryBtn', 'titleHistoryBtn']) {
    document.getElementById(id)?.addEventListener('click', () => openSidebarOnMobile());
  }
  document.getElementById('railSearchBtn')?.addEventListener('click', () => {
    openSidebarOnMobile();
    window.setTimeout(() => dom.chatSearchInput?.focus(), 40);
  });
  document.getElementById('closeHistoryBtn')?.addEventListener('click', () => closeSidebarOnMobile());

  dom.settingsBtn?.addEventListener('click', openSettings);
  dom.closeSettingsBtn?.addEventListener('click', closeSettings);
  dom.settingsBackdrop?.addEventListener('click', closeSettings);
  dom.settingsForm?.addEventListener('submit', submitSettings);
  dom.settingsLogoutBtn?.addEventListener('click', () => { closeSettings(); dom.logoutBtn.click(); });
  dom.settingsModal?.addEventListener('click', event => {
    const choice = event.target.closest('button[data-theme-choice]')?.dataset.themeChoice;
    if (choice) setThemePreference(choice);
  });

  dom.chatSearchInput?.addEventListener('input', () => {
    state.chatSearchQuery = dom.chatSearchInput.value || '';
    renderChatList();
  });
  dom.batchSelectBtn?.addEventListener('click', () => state.batchMode ? exitBatchMode() : enterBatchMode());
  dom.batchCancelBtn?.addEventListener('click', exitBatchMode);
  dom.batchDeleteBtn?.addEventListener('click', batchDeleteSelected);

  const title = document.querySelector('.main-title-copy h1');
  if (title && dom.chatTitleInput) {
    const beginRename = () => {
      if (!state.currentChat) return;
      title.hidden = true;
      dom.chatTitleInput.hidden = false;
      dom.chatTitleInput.value = state.currentChat.title || '';
      dom.chatTitleInput.focus();
      dom.chatTitleInput.select();
    };
    title.addEventListener('click', beginRename);
    title.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); beginRename(); }
    });
    dom.chatTitleInput.addEventListener('blur', () => {
      const value = dom.chatTitleInput.value.trim();
      dom.chatTitleInput.hidden = true;
      title.hidden = false;
      if (state.currentChat && value && value !== state.currentChat.title) renameChat(state.currentChat, value);
    });
    dom.chatTitleInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') dom.chatTitleInput.blur();
      if (event.key === 'Escape') {
        dom.chatTitleInput.value = state.currentChat?.title || '';
        dom.chatTitleInput.blur();
      }
    });
  }

  dom.mobileSidebarBtn?.addEventListener('click', () => {
    if (sidebar?.classList.contains('mobile-open')) closeSidebarOnMobile();
    else openSidebarOnMobile();
  });
  dom.sidebarBackdrop?.addEventListener('click', closeSidebarOnMobile);
  bindSidebarSwipeToClose();
  dom.mobileMoreBtn?.addEventListener('click', () => {
    if (dom.mobileMoreMenu?.classList.contains('open')) closeMobileMoreMenu();
    else openMobileMoreMenu();
  });
  dom.closeMobileMoreBtn?.addEventListener('click', closeMobileMoreMenu);
  dom.mobileMoreBackdrop?.addEventListener('click', closeMobileMoreMenu);
  dom.mobileMoreMenu?.addEventListener('click', event => {
    const action = event.target.closest('button[data-mobile-action]')?.dataset.mobileAction;
    if (action === 'sidebar') { closeMobileMoreMenu(); return openSidebarOnMobile({ refresh: true, resetSearch: true }); }
    if (action === 'new-chat') { closeMobileMoreMenu(); return newChat(); }
    if (action === 'settings') { closeMobileMoreMenu(); return openSettings(); }
    const choice = event.target.closest('button[data-theme-choice]')?.dataset.themeChoice;
    if (choice) setThemePreference(choice);
  });

  dom.messageInput.addEventListener('input', () => {
    updateSendButton();
    resizeComposer();
    saveInputDraft();
  });
  dom.inputArea?.addEventListener('focusin', () => syncMobileComposerFocus(true));
  dom.inputArea?.addEventListener('focusout', () => window.setTimeout(() => syncMobileComposerFocus(dom.inputArea?.contains(document.activeElement)), 30));
  dom.webSearchToggle?.addEventListener('click', () => {
    if (state.webSearchAvailable && !state.streaming) setWebSearchEnabled(!state.webSearchEnabled);
  });
  dom.messageInput.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!state.streaming) sendMessage();
    }
  });
  dom.sendBtn.addEventListener('click', () => state.streaming ? abortActiveRequest() : sendMessage());
  dom.stopBtn?.addEventListener('click', abortActiveRequest);

  dom.messagesContainer.addEventListener('click', async event => {
    const codeButton = event.target.closest('button[data-code-copy]');
    if (codeButton) {
      const code = codeButton.closest('.code-block-shell')?.querySelector('pre code')?.textContent || '';
      if (code) {
        await copyMessageContent(code);
        const original = codeButton.textContent;
        codeButton.textContent = '已复制';
        window.setTimeout(() => { codeButton.textContent = original || '复制代码'; }, 1100);
      }
      return;
    }
    const menuButton = event.target.closest('button[data-message-menu-toggle]');
    if (menuButton) {
      const menu = menuButton.closest('.message-action-menu');
      const message = menuButton.closest('.message');
      if (openMobileMessageActionSheet(message, menuButton)) return;
      const willOpen = !menu?.classList.contains('open');
      closeMessageActionMenus(menu);
      setMessageActionMenuOpen(menu, willOpen);
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    closeMessageActionMenus();
    await runMessageAction(button.dataset.action, button.closest('.message')?.dataset.messageId, button);
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('#mobileMessageActionSheet button[data-action]');
    if (!button) return;
    closeMobileMessageActionSheet({ returnFocus: false });
    await runMessageAction(button.dataset.action, button.dataset.messageId, button);
  });
  dom.messagesContainer.addEventListener('scroll', syncScrollToBottomButton, { passive: true });
  document.addEventListener('click', event => {
    if (!event.target.closest('.message-action-menu')) closeMessageActionMenus();
  });
  dom.scrollToBottomBtn?.addEventListener('click', () => scrollToBottom());

  syncMobileWebMode();
  syncResponsiveSidebarState();
  window.addEventListener('resize', syncMobileWebMode, { passive: true });
  window.visualViewport?.addEventListener?.('resize', syncMobileWebMode, { passive: true });
  window.addEventListener('resize', () => syncResponsiveSidebarState(), { passive: true });

  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const modal = state.activeDialog?.panel
        || (!dom.settingsModal?.classList.contains('hidden') ? dom.settingsModal : null)
        || (!dom.mobileMoreMenu?.classList.contains('hidden') ? dom.mobileMoreMenu : null)
        || (sidebar?.classList.contains('mobile-open') ? sidebar : null);
      if (modal) {
        const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
          .filter(element => !element.closest('[inert]') && element.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    }
    if (event.key === 'Escape') {
      closeMessageActionMenus();
      closeMobileMessageActionSheet({ returnFocus: false });
      closeMobileMoreMenu();
      closeSidebarOnMobile();
      closeSettings();
    }
  });
}
resetViewVisibility();
initAuth();
initEvents();
checkAuth();
