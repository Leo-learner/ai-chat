const APP_MODE_STORAGE_KEY = 'ai_chat_app_mode';
const THEME_PREFERENCE_STORAGE_KEY = 'ai_chat_theme_preference';
const THEME_CHOICES = ['system', 'light', 'dark'];
const urlParams = new URLSearchParams(window.location.search);
const requestedAppMode = urlParams.get('app');
const isMacOSAppMode = requestedAppMode === 'macos' || urlParams.get('client') === 'macos';
const isLikelyAndroidClient = /Android/i.test(navigator.userAgent || '');
const isAndroidAppMode = requestedAppMode === 'android'
  || (!requestedAppMode && isLikelyAndroidClient && localStorage.getItem(APP_MODE_STORAGE_KEY) === 'android');
if (requestedAppMode === 'android') {
  localStorage.setItem(APP_MODE_STORAGE_KEY, 'android');
} else if (isMacOSAppMode) {
  localStorage.removeItem(APP_MODE_STORAGE_KEY);
}
document.body?.classList.toggle('app-mode', isAndroidAppMode);
document.body?.classList.toggle('client-macos', isMacOSAppMode);
if (isMacOSAppMode) document.documentElement.dataset.client = 'macos';

const DEFAULT_CHAT_MODEL = 'deepseek-v4-pro';
const ALLOWED_CHAT_MODELS = [DEFAULT_CHAT_MODEL];
const API_DEFAULT_TIMEOUT_MS = 25000;
const CHAT_DRAFT_STORAGE_PREFIX = 'ai_chat_draft:';
const MESSAGE_RENDER_LIMIT = 60;

function getStoredThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return THEME_CHOICES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function normalizeChatModel(modelId) {
  return ALLOWED_CHAT_MODELS.includes(modelId) ? modelId : DEFAULT_CHAT_MODEL;
}

const state = {
  token: localStorage.getItem('ai_chat_token'),
  user: null,
  chats: [],
  currentChat: null,
  messages: [],
  models: [],
  streaming: false,
  streamAbort: null,
  activeRequestId: 0,
  activeTab: 'chat',
  isAppMode: isAndroidAppMode,
  batchMode: false,
  batchSelected: new Set(),
  chatSearchQuery: '',
  stoppedDraft: null,
  webSearchEnabled: false,
  webSearchAvailable: false,
  isMacOSClient: isMacOSAppMode,
  messageRenderExpanded: false,
  chatListLoading: false,
  sidebarReturnFocus: null,
  moreReturnFocus: null,
  fileSheetReturnFocus: null,
  activeDialog: null,
  themePreference: getStoredThemePreference(),
};

const dom = {
  authView: document.getElementById('authView'),
  chatView: document.getElementById('chatView'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginError: document.getElementById('loginError'),
  regError: document.getElementById('regError'),
  loginUser: document.getElementById('loginUser'),
  loginPass: document.getElementById('loginPass'),
  regUser: document.getElementById('regUser'),
  regEmail: document.getElementById('regEmail'),
  regPass: document.getElementById('regPass'),
  tabs: document.querySelectorAll('.auth-tab'),
  logoutBtn: document.getElementById('logoutBtn'),
  newChatBtn: document.getElementById('newChatBtn'),
  mobileMoreBtn: document.getElementById('mobileMoreBtn'),
  mobileMoreMenu: document.getElementById('mobileMoreMenu'),
  mobileMoreBackdrop: document.getElementById('mobileMoreBackdrop'),
  closeMobileMoreBtn: document.getElementById('closeMobileMoreBtn'),
  mobileNewChatBtn: document.getElementById('mobileNewChatBtn'),
  mobileSidebarBtn: document.getElementById('mobileSidebarBtn'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  mobileModelBtn: document.getElementById('mobileModelBtn'),
  mobileCurrentModelLabel: document.getElementById('mobileCurrentModelLabel'),
  chatList: document.getElementById('chatList'),
  chatSearchInput: document.getElementById('chatSearchInput'),
  chatSearchEmpty: document.getElementById('chatSearchEmpty'),
  batchSelectBtn: document.getElementById('batchSelectBtn'),
  batchActionBar: document.getElementById('batchActionBar'),
  batchCount: document.getElementById('batchCount'),
  batchDeleteBtn: document.getElementById('batchDeleteBtn'),
  batchCancelBtn: document.getElementById('batchCancelBtn'),
  chatTitleInput: document.getElementById('chatTitleInput'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  emptyState: document.getElementById('emptyState'),
  emptyModels: document.getElementById('emptyModels'),
  messagesContainer: document.getElementById('messagesContainer'),
  inputArea: document.getElementById('inputArea'),
  tabMemory: document.getElementById('tabMemory'),
  memoryHealth: document.getElementById('memoryHealth'),
  memoryComposeToggle: document.getElementById('memoryComposeToggle'),
  memoryComposeBody: document.getElementById('memoryComposeBody'),
  memoryTitleInput: document.getElementById('memoryTitleInput'),
  memoryContentInput: document.getElementById('memoryContentInput'),
  memoryEnabledInput: document.getElementById('memoryEnabledInput'),
  memorySaveBtn: document.getElementById('memorySaveBtn'),
  memorySearchInput: document.getElementById('memorySearchInput'),
  memoryFilterSelect: document.getElementById('memoryFilterSelect'),
  memoryRefreshBtn: document.getElementById('memoryRefreshBtn'),
  memoryList: document.getElementById('memoryList'),
  memoryEmpty: document.getElementById('memoryEmpty'),
  modelSelect: document.getElementById('modelSelect'),
  modelSheet: document.getElementById('modelSheet'),
  modelSheetBackdrop: document.getElementById('modelSheetBackdrop'),
  modelSheetList: document.getElementById('modelSheetList'),
  closeModelSheet: document.getElementById('closeModelSheet'),
  messageInput: document.getElementById('messageInput'),
  promptAssistToggle: document.getElementById('promptAssistToggle'),
  webSearchToggle: document.getElementById('webSearchToggle'),
  promptQuickbar: document.getElementById('promptQuickbar'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  scrollToBottomBtn: document.getElementById('scrollToBottomBtn'),
  tabFinder: document.getElementById('tabFinder'),
  finderUpBtn: document.getElementById('finderUpBtn'),
  finderRefreshBtn: document.getElementById('finderRefreshBtn'),
  finderSelectAllBtn: document.getElementById('finderSelectAllBtn'),
  finderPasteBtn: document.getElementById('finderPasteBtn'),
  finderUploadBtn: document.getElementById('finderUploadBtn'),
  finderNewFolderBtn: document.getElementById('finderNewFolderBtn'),
  finderSearchInput: document.getElementById('finderSearchInput'),
  finderBreadcrumbs: document.getElementById('finderBreadcrumbs'),
  finderSummary: document.getElementById('finderSummary'),
  finderList: document.getElementById('finderList'),
  finderEmpty: document.getElementById('finderEmpty'),
  finderSelectionBar: document.getElementById('finderSelectionBar'),
  finderSelectionCount: document.getElementById('finderSelectionCount'),
  finderDownloadBtn: document.getElementById('finderDownloadBtn'),
  finderCopyBtn: document.getElementById('finderCopyBtn'),
  finderCutBtn: document.getElementById('finderCutBtn'),
  finderRenameBtn: document.getElementById('finderRenameBtn'),
  finderDeleteBtn: document.getElementById('finderDeleteBtn'),
  finderClearBtn: document.getElementById('finderClearBtn'),
  finderUploadInput: document.getElementById('finderUploadInput'),
  fileSheetBackdrop: document.getElementById('fileSheetBackdrop'),
  fileSheet: document.getElementById('fileSheet'),
  closeFileSheet: document.getElementById('closeFileSheet'),
  fileSheetTitle: document.getElementById('fileSheetTitle'),
  fileSheetMeta: document.getElementById('fileSheetMeta'),
  fileSheetPreview: document.getElementById('fileSheetPreview'),
  fileDownloadBtn: document.getElementById('fileDownloadBtn'),
  fileRenameBtn: document.getElementById('fileRenameBtn'),
  fileDeleteBtn: document.getElementById('fileDeleteBtn'),
  transferBackdrop: document.getElementById('transferBackdrop'),
  transferSheet: document.getElementById('transferSheet'),
  closeTransferSheet: document.getElementById('closeTransferSheet'),
  transferTitle: document.getElementById('transferTitle'),
  transferFile: document.getElementById('transferFile'),
  transferProgress: document.getElementById('transferProgress'),
  transferPercent: document.getElementById('transferPercent'),
  transferSpeed: document.getElementById('transferSpeed'),
  transferEta: document.getElementById('transferEta'),
  transferCancelBtn: document.getElementById('transferCancelBtn'),
};

function syncClientModeAttributes() {
  document.body?.classList.toggle('client-macos', state.isMacOSClient);
  if (state.isMacOSClient) {
    document.documentElement.dataset.client = 'macos';
    dom.chatView?.setAttribute('data-client', 'macos');
  } else {
    if (document.documentElement.dataset.client === 'macos') {
      delete document.documentElement.dataset.client;
    }
    dom.chatView?.removeAttribute('data-client');
  }
}

syncClientModeAttributes();

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

const API = {
  base: '/api',

  async request(method, path, body = null, { signal, timeoutMs = API_DEFAULT_TIMEOUT_MS, authRedirect = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const requestSignal = createRequestSignal(signal, timeoutMs);
    if (requestSignal.signal) opts.signal = requestSignal.signal;

    try {
      const res = await fetch(`${this.base}${path}`, opts);
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : { error: await res.text() };

      if (res.status === 401 && authRedirect && path !== '/auth/me' && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
        handleAuthExpired();
      }
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') {
        if (signal?.aborted && !requestSignal.timedOut()) throw err;
        throw new Error('请求超时，请稍后重试');
      }
      if (err instanceof TypeError) {
        throw new Error('网络连接失败，请检查服务是否正在运行');
      }
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

const finderState = {
  cwd: '',
  rootLabel: 'Home',
  items: [],
  query: '',
  selected: new Set(),
  clipboard: null,
  loading: false,
  previewItem: null,
  searchTimer: null,
  loadSeq: 0,
  loadController: null,
  truncated: false,
  maxResults: 0,
};

const memoryState = {
  memories: [],
  health: null,
  loaded: false,
};

const PROMPT_SHORTCUTS = {
  summarize: '请总结上面的内容，提炼重点、结论和下一步建议。',
  expand: '请继续展开上面的回答，补充关键细节和容易忽略的注意点。',
  rewrite: '请把上面的内容改写得更清楚、更自然，并保留原意。',
  steps: '请把上面的内容整理成可执行步骤，按优先级排列。',
};

const controlAppState = {
  apps: [],
  query: '',
  loading: false,
  lastLoadedAt: 0,
  minRefreshMs: 7000,
};

const controlUiState = {
  refreshing: false,
  terminalRunning: false,
  terminalHistory: [],
  terminalHistoryIndex: -1,
  terminalCwd: '~',
};

function applyAppModeCopy() {
  if (!state.isAppMode) return;
  const heroCopy = document.querySelector('.auth-hero p');
  const headerCopy = document.querySelector('.auth-header p');
  const noteChips = document.querySelectorAll('.auth-hero-notes .note-chip');
  if (heroCopy) heroCopy.textContent = '轻巧、连续、适合手机使用的私人 AI 对话。';
  if (headerCopy) headerCopy.textContent = '登录后继续你的对话、模型和记忆。';
  if (noteChips[2]) noteChips[2].textContent = '个人记忆';
}

applyAppModeCopy();

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

const transferState = {
  xhr: null,
  active: false,
  mode: '',
  title: '',
  name: '',
  startedAt: 0,
  loaded: 0,
  total: 0,
  status: '',
  hideTimer: null,
};

function formatSpeed(bytesPerSecond = 0) {
  const value = Number(bytesPerSecond || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatEta(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return 'ETA --';
  if (value < 1) return 'ETA <1s';
  const total = Math.round(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `ETA ${h}h ${m}m`;
  if (m > 0) return `ETA ${m}m ${s}s`;
  return `ETA ${s}s`;
}

function setTransferModalVisible(visible) {
  dom.transferBackdrop?.classList.toggle('hidden', !visible);
  dom.transferSheet?.classList.toggle('hidden', !visible);
  if (visible) {
    dom.transferBackdrop?.classList.add('open');
    dom.transferSheet?.classList.add('open');
  } else {
    dom.transferBackdrop?.classList.remove('open');
    dom.transferSheet?.classList.remove('open');
  }
}

function updateTransferModalUI({ title, name, loaded, total, status }) {
  const elapsed = Math.max((Date.now() - transferState.startedAt) / 1000, 0.001);
  const totalBytes = Number(total || 0);
  const loadedBytes = Math.max(0, Number(loaded || 0));
  const pct = totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0;
  const speed = loadedBytes / elapsed;
  const remaining = totalBytes > 0 ? Math.max(totalBytes - loadedBytes, 0) : 0;
  const eta = speed > 0 && totalBytes > 0 ? remaining / speed : NaN;

  if (dom.transferTitle) dom.transferTitle.textContent = title || transferState.title || 'Transfer';
  if (dom.transferFile) dom.transferFile.textContent = name || transferState.name || '—';
  if (dom.transferProgress) dom.transferProgress.style.width = `${pct}%`;
  if (dom.transferPercent) dom.transferPercent.textContent = `${Math.round(pct)}%`;
  if (dom.transferSpeed) dom.transferSpeed.textContent = `${formatSpeed(speed)}`;
  if (dom.transferEta) dom.transferEta.textContent = Number.isFinite(eta) ? formatEta(eta) : (status || transferState.status || 'Working…');
}

function beginTransferModal({ mode, title, name, total = 0, cancelable = true }) {
  clearTimeout(transferState.hideTimer);
  transferState.hideTimer = null;
  transferState.active = true;
  transferState.mode = mode;
  transferState.title = title;
  transferState.name = name;
  transferState.loaded = 0;
  transferState.total = Number(total || 0);
  transferState.status = '';
  transferState.startedAt = Date.now();
  if (dom.transferCancelBtn) dom.transferCancelBtn.disabled = !cancelable;
  setTransferModalVisible(true);
  updateTransferModalUI({ title, name, loaded: 0, total: transferState.total, status: 'Starting…' });
}

function finishTransferModal(message = 'Done', isError = false) {
  transferState.active = false;
  transferState.status = message;
  if (dom.transferEta) dom.transferEta.textContent = message;
  if (dom.transferPercent) dom.transferPercent.textContent = isError ? 'Failed' : '100%';
  if (dom.transferProgress) dom.transferProgress.style.width = isError ? '100%' : '100%';
  if (dom.transferSpeed) dom.transferSpeed.textContent = isError ? '—' : formatSpeed(0);
  transferState.xhr = null;
  clearTimeout(transferState.hideTimer);
  transferState.hideTimer = setTimeout(() => {
    setTransferModalVisible(false);
  }, isError ? 1800 : 750);
}

function abortCurrentTransfer() {
  if (transferState.xhr) {
    try { transferState.xhr.abort(); } catch {}
  }
}

function xhrRequest({ method, url, body = null, headers = {}, responseType = '', onProgress, onUploadProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    transferState.xhr = xhr;
    xhr.open(method, url, true);
    if (responseType) xhr.responseType = responseType;
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    Object.entries(headers).forEach(([key, value]) => {
      if (value != null) xhr.setRequestHeader(key, value);
    });

    const parseError = () => {
      const ct = xhr.getResponseHeader('content-type') || '';
      if (ct.includes('application/json')) {
        try { return JSON.parse(xhr.responseText || '{}').error; } catch { return null; }
      }
      return (xhr.responseText || '').trim() || null;
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseType === 'blob' ? xhr.response : xhr.responseText);
      } else {
        reject(new Error(parseError() || `Request failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.onabort = () => reject(new Error('Cancelled'));
    xhr.upload.onprogress = (e) => {
      if (onUploadProgress) onUploadProgress(e);
    };
    xhr.onprogress = (e) => {
      if (onProgress) onProgress(e);
    };
    xhr.send(body);
  });
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function applyTransferProgress({ loaded, total, title, name, status }) {
  transferState.loaded = Number(loaded || 0);
  transferState.total = Number(total || transferState.total || 0);
  if (title) transferState.title = title;
  if (name) transferState.name = name;
  if (status) transferState.status = status;
  updateTransferModalUI({
    title: transferState.title,
    name: transferState.name,
    loaded: transferState.loaded,
    total: transferState.total,
    status: transferState.status,
  });
}

function escHtml(str = '') {
  return String(str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[ch]));
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function isMobileWebLayout() {
  return isMobileLayout() && !state.isAppMode && !state.isMacOSClient;
}

function syncMobileWebMode() {
  const active = isMobileWebLayout();
  document.body?.classList.toggle('mobile-web-mode', active);
  dom.chatView?.toggleAttribute('data-mobile-web', active);
  if (!active) {
    closePromptAssistant({ returnFocus: false });
    document.body?.classList.remove('mobile-composer-focus', 'message-action-sheet-open');
  }
}

function syncMobileComposerFocus(focused) {
  document.body?.classList.toggle('mobile-composer-focus', Boolean(focused && isMobileWebLayout() && state.activeTab === 'chat'));
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
        ['save-memory', '保存记忆', ''],
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

function openPromptAssistant() {
  if (!dom.promptQuickbar || !dom.promptAssistToggle || !isMobileWebLayout()) return;
  dom.promptQuickbar.classList.add('open');
  dom.promptQuickbar.removeAttribute('inert');
  dom.promptQuickbar.setAttribute('aria-hidden', 'false');
  dom.promptAssistToggle.classList.add('is-open');
  dom.promptAssistToggle.setAttribute('aria-expanded', 'true');
}

function closePromptAssistant({ returnFocus = true } = {}) {
  if (!dom.promptQuickbar || !dom.promptAssistToggle) return;
  const wasOpen = dom.promptQuickbar.classList.contains('open');
  dom.promptQuickbar.classList.remove('open');
  dom.promptQuickbar.setAttribute('aria-hidden', 'true');
  dom.promptQuickbar.setAttribute('inert', '');
  dom.promptAssistToggle.classList.remove('is-open');
  dom.promptAssistToggle.setAttribute('aria-expanded', 'false');
  if (returnFocus && wasOpen) dom.promptAssistToggle.focus?.({ preventScroll: true });
}

function togglePromptAssistant() {
  if (dom.promptQuickbar?.classList.contains('open')) closePromptAssistant();
  else openPromptAssistant();
}

function syncSliderFill(sliderEl, fillEl) {
  if (!sliderEl || !fillEl) return;
  const value = Number(sliderEl.value || 0);
  const min = Number(sliderEl.min || 0);
  const max = Number(sliderEl.max || 100);
  const pctRaw = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const pct = Math.max(0, Math.min(100, pctRaw));
  sliderEl.style.setProperty('--fill', `${pct}%`);
  fillEl.style.width = `${pct}%`;
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

function isAdminUser() {
  return state.user?.role === 'admin';
}

function canAccessTab(tab) {
  if (tab === 'control' || tab === 'finder' || tab === 'terminal') {
    return isAdminUser() && !state.isAppMode;
  }
  return tab === 'chat' || tab === 'memory';
}

function resetViewVisibility() {
  dom.authView.classList.add('hidden');
  dom.chatView.classList.add('hidden');
}

function openSidebarOnMobile({ refresh = true, resetSearch = false } = {}) {
  const sidebar = document.getElementById('sidebar');
  if (resetSearch) {
    state.chatSearchQuery = '';
    if (dom.chatSearchInput) dom.chatSearchInput.value = '';
  }
  if (state.isMacOSClient && !isMobileLayout()) {
    sidebar?.classList.remove('hidden');
    setElementSuppressed(sidebar, false);
    if (refresh && state.token) loadChats({ showLoading: state.chats.length === 0, notifyError: true });
    dom.chatSearchInput?.focus?.({ preventScroll: true });
    dom.chatSearchInput?.select?.();
    return;
  }
  state.sidebarReturnFocus = document.activeElement;
  sidebar?.classList.remove('hidden');
  sidebar?.classList.add('mobile-open');
  setElementSuppressed(sidebar, false);
  setElementSuppressed(dom.sidebarBackdrop, false);
  dom.sidebarBackdrop?.classList.add('open');
  dom.sidebarBackdrop?.classList.remove('hidden');
  document.body.classList.add('sidebar-open');
  if (refresh && state.token) loadChats({ showLoading: state.chats.length === 0, notifyError: true });
  focusFirstInteractive(sidebar);
}

function closeSidebarOnMobile({ returnFocus = true } = {}) {
  const sidebar = document.getElementById('sidebar');
  if (state.isMacOSClient && !isMobileLayout()) {
    sidebar?.classList.remove('hidden', 'mobile-open', 'is-dragging-close');
    sidebar?.style.removeProperty('--sidebar-drag-offset');
    setElementSuppressed(sidebar, false);
    dom.sidebarBackdrop?.classList.add('hidden');
    dom.sidebarBackdrop?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    return;
  }
  sidebar?.classList.remove('mobile-open', 'is-dragging-close');
  sidebar?.style.removeProperty('--sidebar-drag-offset');
  dom.sidebarBackdrop?.classList.remove('open');
  document.body.classList.remove('sidebar-open');
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
  if (!dom.mobileMoreMenu) return;
  dom.mobileMoreMenu.querySelectorAll('[data-mobile-tab]').forEach(btn => {
    const tab = btn.dataset.mobileTab;
    const allowed = canAccessTab(tab);
    btn.hidden = !allowed;
    btn.classList.toggle('active', state.activeTab === tab);
  });
  syncThemeControls();
}

function openMobileMoreMenu() {
  if (!dom.mobileMoreMenu || !dom.mobileMoreBackdrop) return;
  syncMobileMoreMenu();
  state.moreReturnFocus = document.activeElement;
  closeSidebarOnMobile({ returnFocus: false });
  closeModelSheet();
  setElementSuppressed(dom.mobileMoreMenu, false);
  setElementSuppressed(dom.mobileMoreBackdrop, false);
  dom.mobileMoreMenu.classList.remove('hidden');
  dom.mobileMoreBackdrop.classList.remove('hidden');
  dom.mobileMoreBtn?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-more-open');
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

function openModelSheet() {
  if (!dom.modelSheet || !dom.modelSheetBackdrop) return;
  setElementSuppressed(dom.modelSheet, false);
  setElementSuppressed(dom.modelSheetBackdrop, false);
  dom.modelSheet.classList.remove('hidden');
  dom.modelSheetBackdrop.classList.remove('hidden');
  requestAnimationFrame(() => {
    dom.modelSheet.classList.add('open');
    dom.modelSheetBackdrop.classList.add('open');
  });
}

function closeModelSheet() {
  if (!dom.modelSheet || !dom.modelSheetBackdrop) return;
  dom.modelSheet.classList.remove('open');
  dom.modelSheetBackdrop.classList.remove('open');
  window.setTimeout(() => {
    if (!dom.modelSheet.classList.contains('open')) {
      dom.modelSheet.classList.add('hidden');
      setElementSuppressed(dom.modelSheet, true);
    }
    if (!dom.modelSheetBackdrop.classList.contains('open')) {
      dom.modelSheetBackdrop.classList.add('hidden');
      setElementSuppressed(dom.modelSheetBackdrop, true);
    }
  }, 220);
}

function currentModelText(modelId = dom.modelSelect.value) {
  const normalized = normalizeChatModel(modelId);
  const option = Array.from(dom.modelSelect.options).find(opt => opt.value === normalized);
  if (option) return option.textContent || normalized;
  return normalized;
}

function firstAvailableModelId() {
  return Array.from(dom.modelSelect.options).find(opt => ALLOWED_CHAT_MODELS.includes(opt.value))?.value || DEFAULT_CHAT_MODEL;
}

function modelOptionExists(modelId) {
  if (!modelId) return false;
  return ALLOWED_CHAT_MODELS.includes(modelId) && Array.from(dom.modelSelect.options).some(opt => opt.value === modelId);
}

function updateModelBadges() {
  const text = currentModelText();
  const selectedModel = normalizeChatModel(dom.modelSelect.value);
  if (dom.mobileCurrentModelLabel) dom.mobileCurrentModelLabel.textContent = text;
  if (dom.mobileModelBtn) dom.mobileModelBtn.setAttribute('aria-label', `当前模型：${text}`);
  if (dom.modelSheetList) {
    dom.modelSheetList.querySelectorAll('.model-choice').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modelId === selectedModel);
    });
  }
  if (dom.emptyModels) {
    dom.emptyModels.querySelectorAll('.empty-model-chip').forEach(btn => {
      const active = btn.dataset.modelId === dom.modelSelect.value;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
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
  dom.modelSelect.value = modelOptionExists(normalized) ? normalized : firstAvailableModelId();
  updateModelBadges();
}

function renderModelPickers(models) {
  const previousModel = normalizeChatModel(dom.modelSelect.value);
  const allowedModels = (models || []).filter(model => ALLOWED_CHAT_MODELS.includes(model.id));
  dom.modelSelect.innerHTML = '';
  dom.emptyModels.innerHTML = '';
  dom.emptyModels.hidden = true;
  dom.emptyModels.classList.add('hidden');
  dom.modelSheetList.innerHTML = '';

  if (!allowedModels.length) {
    dom.modelSelect.innerHTML = '<option value="">未配置模型</option>';
    dom.modelSelect.disabled = true;
    dom.mobileCurrentModelLabel.textContent = '未配置';
    dom.modelSheetList.innerHTML = '<div class="model-group"><div class="model-group-title">无可用模型</div><div class="model-choice" style="cursor:default;opacity:.72"><span class="model-choice-id">未配置模型</span><span class="model-choice-provider">检查服务配置</span></div></div>';
    return;
  }

  const grouped = new Map();
  for (const model of allowedModels) {
    const key = model.providerName || 'Unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(model);
  }

  for (const [provider, providerModels] of grouped.entries()) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = provider;
    for (const m of providerModels) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      optgroup.appendChild(opt);
    }
    dom.modelSelect.appendChild(optgroup);

    const groupWrap = document.createElement('div');
    groupWrap.className = 'model-group';
    groupWrap.innerHTML = `<div class="model-group-title">${escapeHtml(provider)}</div>`;
    for (const m of providerModels) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model-choice';
      btn.dataset.modelId = m.id;
      btn.innerHTML = `<span class="model-choice-id">${escapeHtml(m.id)}</span><span class="model-choice-provider">${escapeHtml(provider)}</span>`;
      groupWrap.appendChild(btn);
    }
    dom.modelSheetList.appendChild(groupWrap);
  }

  dom.modelSelect.disabled = true;
  setSelectedModel(previousModel || state.currentChat?.model || DEFAULT_CHAT_MODEL);
}

async function loadModels() {
  try {
    const data = await API.get('/models');
    state.models = (data.models || []).filter(model => ALLOWED_CHAT_MODELS.includes(model.id));
    renderModelPickers(state.models);
    setWebSearchAvailability(Boolean(data.webSearch?.enabled));
  } catch (err) {
    console.error('Failed to load models:', err);
    setWebSearchAvailability(false);
    toast('模型加载失败');
  }
}

async function loadChats({ showLoading = false, notifyError = false } = {}) {
  if (showLoading) {
    state.chatListLoading = true;
    renderChatList();
  }
  try {
    const data = await API.get('/chats');
    state.chats = (data.chats || []).map(chat => ({ ...chat, model: normalizeChatModel(chat.model) }));
    state.chatListLoading = false;
    renderChatList();

    if (state.currentChat) {
      const stillExists = state.chats.find(c => c.id === state.currentChat.id);
      if (stillExists) {
        state.currentChat = { ...state.currentChat, ...stillExists, model: normalizeChatModel(stillExists.model) };
        updateChatHeaderTitle();
      } else {
        state.currentChat = null;
        state.messages = [];
        showEmptyState();
      }
    } else {
      updateChatHeaderTitle();
    }
  } catch (err) {
    state.chatListLoading = false;
    renderChatList();
    console.error('Failed to load chats:', err);
    if (notifyError) toast('会话列表加载失败');
  }
}

function formatRelativeChatTime(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const parsed = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (!Number.isFinite(parsed)) return '';
  const diff = Math.max(0, Date.now() - parsed);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚更新';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return new Date(parsed).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function chatListMeta(chat = {}) {
  if (ALLOWED_CHAT_MODELS.length === 1) {
    return formatRelativeChatTime(chat.updated_at || chat.created_at) || '单一模型';
  }
  return normalizeChatModel(chat.model || DEFAULT_CHAT_MODEL);
}

function renderChatList() {
  dom.chatList.innerHTML = '';
  const query = state.chatSearchQuery.trim().toLowerCase();
  const visibleChats = query
    ? state.chats.filter(chat => `${chat.title || ''} ${chatListMeta(chat)} ${chat.model || ''}`.toLowerCase().includes(query))
    : state.chats;
  dom.chatSearchEmpty?.classList.add('hidden');

  if (state.chatListLoading) {
    const loading = document.createElement('div');
    loading.className = 'chat-list-state chat-list-loading';
    loading.textContent = '正在加载会话…';
    dom.chatList.appendChild(loading);
    updateBatchUI();
    return;
  }

  if (!visibleChats.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-list-state';
    empty.textContent = query ? '没有匹配的会话' : '暂无会话，点“新对话”开始';
    dom.chatList.appendChild(empty);
    updateBatchUI();
    return;
  }

  for (const chat of visibleChats) {
    const item = document.createElement('div');
    item.className = `chat-item${state.currentChat?.id === chat.id ? ' active' : ''}`;
    item.dataset.chatId = chat.id;

    // Checkbox (visible in batch mode)
    const cb = document.createElement('span');
    cb.className = `chat-item-check${state.batchMode ? '' : ' hidden'}${state.batchSelected.has(chat.id) ? ' checked' : ''}`;
    cb.textContent = state.batchSelected.has(chat.id) ? '☑' : '☐';
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBatchSelect(chat.id);
    });

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    body.innerHTML = `
      <div class="chat-item-title">${escapeHtml(chat.title)}</div>
      <div class="chat-item-model chat-item-meta">${escapeHtml(chatListMeta(chat))}</div>
    `;

    // Double-click to rename
    body.addEventListener('dblclick', (e) => {
      if (state.batchMode) return;
      e.stopPropagation();
      promptRenameChat(chat);
    });

    const delBtn = document.createElement('button');
    delBtn.className = `chat-item-delete${state.batchMode ? ' hidden' : ''}`;
    delBtn.type = 'button';
    delBtn.title = '删除会话';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await appConfirm({
        title: '删除会话',
        message: `确定删除“${chat.title || '未命名会话'}”？此操作无法撤销。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      await deleteSingleChat(chat);
    });

    item.appendChild(cb);
    item.appendChild(body);
    item.appendChild(delBtn);

    item.addEventListener('click', (e) => {
      if (state.batchMode || e.target.closest('.chat-item-check') || e.target.closest('.chat-item-delete')) return;
      openChat(chat);
      closeSidebarOnMobile();
    });

    dom.chatList.appendChild(item);
  }
  updateBatchUI();
}

function toggleBatchSelect(chatId) {
  if (state.batchSelected.has(chatId)) {
    state.batchSelected.delete(chatId);
  } else {
    state.batchSelected.add(chatId);
  }
  renderChatList();
}

function updateBatchUI() {
  const count = state.batchSelected.size;
  if (dom.batchCount) dom.batchCount.textContent = `已选 ${count} 个`;
  if (dom.batchActionBar) dom.batchActionBar.classList.toggle('hidden', !state.batchMode);
  if (dom.batchDeleteBtn) dom.batchDeleteBtn.disabled = count === 0;
  if (dom.batchSelectBtn) {
    dom.batchSelectBtn.textContent = state.batchMode ? '完成' : '管理';
    dom.batchSelectBtn.classList.toggle('active', state.batchMode);
  }
}

function enterBatchMode() {
  state.batchMode = true;
  state.batchSelected.clear();
  renderChatList();
}

function exitBatchMode() {
  state.batchMode = false;
  state.batchSelected.clear();
  renderChatList();
}

async function batchDeleteSelected() {
  if (!state.batchSelected.size) return;
  const ok = await appConfirm({
    title: '批量删除会话',
    message: `将删除 ${state.batchSelected.size} 个会话，此操作无法撤销。`,
    confirmText: '全部删除',
    danger: true,
  });
  if (!ok) return;
  for (const id of state.batchSelected) {
    try {
      await API.del(`/chats/${id}`);
      if (state.currentChat?.id === id) {
        state.currentChat = null;
        state.messages = [];
      }
    } catch { /* skip */ }
  }
  if (!state.currentChat) showEmptyState();
  exitBatchMode();
  await loadChats();
}

async function deleteSingleChat(chat) {
  try {
    await API.del(`/chats/${chat.id}`);
    if (state.currentChat?.id === chat.id) {
      state.currentChat = null;
      state.messages = [];
      showEmptyState();
    }
    await loadChats();
  } catch {
    toast('删除失败');
  }
}

async function promptRenameChat(chat) {
  const oldTitle = chat.title;
  const result = await appPrompt({
    title: '重命名会话',
    fields: [{ name: 'title', label: '会话名', value: oldTitle, required: true }],
    confirmText: '重命名',
  });
  const newTitle = result?.title;
  if (!newTitle || newTitle.trim() === oldTitle) return;
  renameChat(chat, newTitle.trim());
}

async function renameChat(chat, title) {
  try {
    await API.patch(`/chats/${chat.id}`, { title });
    chat.title = title;
    renderChatList();
    if (state.currentChat?.id === chat.id) {
      updateChatHeaderTitle();
    }
    toast('已重命名');
  } catch {
    toast('重命名失败');
  }
}

function updateChatHeaderTitle() {
  const h1 = document.querySelector('.main-title-copy h1');
  const input = dom.chatTitleInput;
  const pageTitles = {
    memory: '记忆库',
    control: '控制台',
    terminal: '终端',
    finder: '文件',
  };
  const title = state.activeTab === 'chat'
    ? (state.currentChat?.title || '新对话')
    : (pageTitles[state.activeTab] || 'AI Dialogue');
  if (h1) h1.textContent = title;
  if (input) {
    input.value = state.activeTab === 'chat' ? (state.currentChat?.title || '') : '';
    if (state.activeTab !== 'chat') {
      input.style.display = 'none';
      if (h1) h1.style.display = '';
    }
  }
}

function showEmptyState() {
  updateChatHeaderTitle();
  dom.emptyState.classList.remove('hidden');
  dom.messagesContainer.classList.add('hidden');
  dom.messagesContainer.innerHTML = '';
}

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

function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
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
        <span>上下文</span>
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

  const avatar = msg.role === 'user'
    ? (state.user?.username?.[0]?.toUpperCase() || 'U')
    : 'AI';

  const secondaryActions = [];
  secondaryActions.push(`<button class="message-action message-action-mobile-only" type="button" data-action="copy">复制</button>`);
  if (msg.role === 'user') {
    secondaryActions.push(`<button class="message-action" type="button" data-action="retry-user">重发</button>`);
  }
  if (msg.role === 'assistant') {
    secondaryActions.push(`<button class="message-action" type="button" data-action="continue">继续</button>`);
    secondaryActions.push(`<button class="message-action message-action-danger" type="button" data-action="regenerate">重答</button>`);
    secondaryActions.push(`<button class="message-action" type="button" data-action="save-memory">保存记忆</button>`);
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
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  dom.scrollToBottomBtn.classList.toggle('hidden', remaining < 120 || state.streaming);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
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

function applyPromptShortcut(action) {
  const prompt = PROMPT_SHORTCUTS[action];
  if (!prompt) return;
  applyPromptToInput(prompt, { append: Boolean(dom.messageInput?.value.trim()) });
}

function focusMacOSPrimaryField() {
  if (!state.isMacOSClient) return;
  const target = (() => {
    if (state.activeTab === 'memory') return dom.memorySearchInput || dom.messageInput;
    if (state.activeTab === 'finder') return dom.finderSearchInput || dom.messageInput;
    if (state.activeTab === 'control') return document.getElementById('appNameInput') || dom.messageInput;
    if (state.activeTab === 'terminal') return document.getElementById('terminalInput') || dom.messageInput;
    return dom.messageInput;
  })();
  target?.focus?.({ preventScroll: true });
  if (target && target !== dom.messageInput && typeof target.select === 'function') target.select();
}

function handleMacOSClientShortcut(e) {
  if (!state.isMacOSClient || e.altKey || e.ctrlKey || !e.metaKey) return false;
  if (state.activeDialog) return false;
  const key = e.key.toLowerCase();

  if (key === 'n') {
    e.preventDefault();
    if (state.token && !state.streaming) newChat();
    return true;
  }

  if (key === 'l') {
    e.preventDefault();
    focusMacOSPrimaryField();
    return true;
  }

  if (e.key === 'Enter' && document.activeElement !== dom.messageInput) {
    e.preventDefault();
    if (!state.streaming) sendMessage();
    return true;
  }

  return false;
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
      dom.sendBtn.innerHTML = '<span class="send-icon">↑</span>';
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

async function saveMessageAsMemory(messageId, btn) {
  const msg = state.messages.find(m => String(m.id) === String(messageId));
  if (!msg?.content?.trim()) return toast('没有可保存的内容');
  const original = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '保存中';
  }
  try {
    const titlePrefix = msg.role === 'assistant' ? 'AI 回答' : '我的消息';
    const title = `${titlePrefix}: ${compactPlainText(msg.content, 34)}`;
    await API.post('/memories', { title, content: msg.content, enabled: true });
    toast('已保存到记忆');
    if (memoryState.loaded) await loadMemories();
    refreshMemoryHealth();
    btn?.classList.add('is-success');
  } catch (err) {
    toast(err.message || '保存记忆失败');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || '保存记忆';
      window.setTimeout(() => btn.classList.remove('is-success'), 900);
    }
  }
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
          fullContent += parsed.content || '';
          renderLiveContent(streamContentEl, fullContent);
          scrollToBottom();
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
  if (action === 'continue-stopped') {
    continueStoppedDraft();
    return;
  }
  if (action === 'copy-stopped') {
    if (!state.stoppedDraft?.content?.trim()) return toast('没有可复制的内容');
    await copyMessageContent(state.stoppedDraft.content);
    return;
  }
  if (action === 'retry-last') {
    const prompt = state.stoppedDraft?.prompt || dom.messageInput?.value?.trim?.() || '';
    if (!prompt) return toast('没有可重试的内容');
    await sendPrompt(prompt, { clearInput: true });
    return;
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
  } else if (action === 'save-memory') {
    await saveMessageAsMemory(messageId, btn);
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

async function quickStart(modelId) {
  setSelectedModel(normalizeChatModel(modelId));
  await newChat();
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

function setMemoryHealth(status) {
  memoryState.health = status;
  if (!dom.memoryHealth) return;
  const ok = Boolean(status?.ok);
  const loading = !status;
  dom.memoryHealth.classList.toggle('ok', ok);
  dom.memoryHealth.classList.toggle('bad', Boolean(status && !ok));
  dom.memoryHealth.classList.toggle('loading', loading);

  if (dom.memorySaveBtn) {
    dom.memorySaveBtn.classList.toggle('memory-save-risk', Boolean(status && !ok));
    dom.memorySaveBtn.title = status && !ok ? '本地 embedding 不可用，保存可能失败' : '保存记忆';
  }

  if (loading) {
    dom.memoryHealth.innerHTML = `
      <div class="memory-health-main">
        <span class="memory-health-dot"></span>
        <div class="memory-health-copy">
          <strong>正在检测本地记忆服务</strong>
          <span>检查 embedding 服务与模型状态…</span>
        </div>
      </div>
    `;
    return;
  }

  const model = status.model || '未配置';
  const baseUrl = status.baseUrl || '未知地址';
  const dim = status.dim ? `${status.dim}d` : '自动';
  const installed = status.installed ? '目标模型已确认' : (ok ? '服务可用，未确认目标模型' : '模型不可用');
  const title = ok ? '本地 embedding 可用' : '本地 embedding 不可用';
  const detail = ok
    ? `${installed} · ${status.availableModels || 0} 个本地模型`
    : (status.error || '请检查 Ollama / embedding 服务是否启动');

  dom.memoryHealth.innerHTML = `
    <div class="memory-health-main">
      <span class="memory-health-dot"></span>
      <div class="memory-health-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <button class="memory-health-refresh" type="button" data-memory-health-refresh>重试</button>
    </div>
    <details class="memory-health-details">
      <summary>服务详情</summary>
      <div class="memory-health-meta">
        <span>地址：${escapeHtml(baseUrl)}</span>
        <span>模型：${escapeHtml(model)}</span>
        <span>维度：${escapeHtml(dim)}</span>
        <span>超时：${escapeHtml(String(status.timeoutMs || ''))}ms</span>
      </div>
    </details>
  `;
}

async function refreshMemoryHealth() {
  if (!dom.memoryHealth) return;
  setMemoryHealth(null);
  try {
    setMemoryHealth(await API.get('/memories/health'));
  } catch {
    setMemoryHealth({ ok: false });
  }
}

function setMemoryComposerOpen(open, { focus = false } = {}) {
  if (!dom.memoryComposeBody || !dom.memoryComposeToggle) return;
  dom.memoryComposeBody.classList.toggle('hidden', !open);
  dom.memoryComposeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  dom.memoryComposeToggle.textContent = open ? '收起' : '展开';
  dom.memoryComposeBody.closest('.memory-compose')?.classList.toggle('is-open', open);
  if (open && focus) {
    window.setTimeout(() => (dom.memoryContentInput || dom.memoryTitleInput)?.focus?.({ preventScroll: false }), 30);
  }
}

function memoryFilterQuery() {
  const params = new URLSearchParams();
  const q = dom.memorySearchInput?.value.trim();
  const filter = dom.memoryFilterSelect?.value || 'all';
  if (q) params.set('q', q);
  if (filter === 'enabled') params.set('enabled', '1');
  if (filter === 'disabled') params.set('enabled', '0');
  params.set('limit', '120');
  return params.toString();
}

async function loadMemories() {
  if (!dom.memoryList) return;
  try {
    const query = memoryFilterQuery();
    const data = await API.get(`/memories${query ? `?${query}` : ''}`);
    memoryState.memories = data.memories || [];
    memoryState.loaded = true;
    renderMemories();
  } catch (err) {
    toast(err.message || '记忆加载失败');
  }
}

function renderMemories() {
  if (!dom.memoryList) return;
  dom.memoryList.innerHTML = '';
  const memories = memoryState.memories || [];
  if (dom.memoryEmpty) {
    dom.memoryEmpty.classList.toggle('hidden', memories.length > 0);
    if (!memories.length) {
      dom.memoryEmpty.innerHTML = `
        <strong>暂无记忆。</strong>
        <span>把常用偏好、项目背景或固定要求保存下来，之后对话会更省心。</span>
        <button class="memory-empty-cta" type="button" data-memory-empty-compose>添加第一条记忆</button>
      `;
    }
  }
  for (const memory of memories) {
    const card = document.createElement('article');
    card.className = `memory-card${memory.enabled ? '' : ' is-disabled'}`;
    card.dataset.memoryId = memory.id;
    const title = memory.title || '未命名记忆';
    const dim = memory.embedding_dim ? `${memory.embedding_dim}d` : '';
    card.innerHTML = `
      <div class="memory-card-head">
        <div class="memory-card-title">${escapeHtml(title)}</div>
        <span class="memory-state">${memory.enabled ? '启用' : '停用'}</span>
      </div>
      <div class="memory-card-content">${escapeHtml(memory.content || '')}</div>
      <div class="memory-card-meta">
        <span>${escapeHtml(memory.embedding_model || 'local')}</span>
        <span>${escapeHtml(dim)}</span>
      </div>
      <div class="memory-card-actions">
        <button class="message-action" type="button" data-memory-action="toggle">${memory.enabled ? '停用' : '启用'}</button>
        <button class="message-action" type="button" data-memory-action="edit">编辑</button>
        <button class="message-action message-action-danger" type="button" data-memory-action="delete">删除</button>
      </div>
    `;
    dom.memoryList.appendChild(card);
  }
}

async function saveMemory() {
  const title = dom.memoryTitleInput?.value.trim() || '';
  const content = dom.memoryContentInput?.value.trim() || '';
  const enabled = Boolean(dom.memoryEnabledInput?.checked);
  if (!content) return toast('先写入记忆内容');
  if (dom.memorySaveBtn) dom.memorySaveBtn.disabled = true;
  try {
    await API.post('/memories', { title, content, enabled });
    if (dom.memoryTitleInput) dom.memoryTitleInput.value = '';
    if (dom.memoryContentInput) dom.memoryContentInput.value = '';
    if (dom.memoryEnabledInput) dom.memoryEnabledInput.checked = true;
    toast('记忆已保存');
    setMemoryComposerOpen(false);
    await loadMemories();
    refreshMemoryHealth();
  } catch (err) {
    toast(err.message || '保存失败，请检查本地 embedding 服务');
  } finally {
    if (dom.memorySaveBtn) dom.memorySaveBtn.disabled = false;
  }
}

async function updateMemory(memory, patch) {
  const data = await API.patch(`/memories/${memory.id}`, patch);
  const idx = memoryState.memories.findIndex(item => item.id === memory.id);
  if (idx >= 0 && data.memory) memoryState.memories[idx] = data.memory;
  renderMemories();
}

async function handleMemoryAction(btn) {
  const card = btn.closest('.memory-card');
  const memory = memoryState.memories.find(item => item.id === card?.dataset.memoryId);
  if (!memory) return;
  const action = btn.dataset.memoryAction;
  try {
    if (action === 'toggle') {
      await updateMemory(memory, { enabled: !memory.enabled });
      toast(memory.enabled ? '记忆已停用' : '记忆已启用');
    } else if (action === 'edit') {
      const result = await appPrompt({
        title: '编辑记忆',
        fields: [
          { name: 'title', label: '标题', value: memory.title || '', placeholder: '可选' },
          { name: 'content', label: '内容', value: memory.content || '', multiline: true, required: true },
        ],
        confirmText: '更新',
      });
      if (!result) return;
      const { title, content } = result;
      await updateMemory(memory, { title, content, enabled: memory.enabled });
      toast('记忆已更新');
    } else if (action === 'delete') {
      const ok = await appConfirm({
        title: '删除记忆',
        message: `确定删除“${memory.title || '未命名记忆'}”？`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      await API.del(`/memories/${memory.id}`);
      memoryState.memories = memoryState.memories.filter(item => item.id !== memory.id);
      renderMemories();
      toast('记忆已删除');
    }
  } catch (err) {
    toast(err.message || '操作失败');
  }
}

function afterLogin() {
  document.body?.classList.toggle('app-mode', state.isAppMode);
  syncClientModeAttributes();
  document.body?.classList.toggle('is-admin', isAdminUser());
  showView('chatView');
  dom.userName.textContent = state.user.username;
  dom.userAvatar.textContent = state.user.username[0].toUpperCase();
  initControlPanel();
  setActiveTab('chat');
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

function initEvents() {
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.add('hidden');
  setElementSuppressed(sidebar, true);
  setElementSuppressed(dom.sidebarBackdrop, true);
  setElementSuppressed(dom.mobileMoreMenu, true);
  setElementSuppressed(dom.mobileMoreBackdrop, true);
  setElementSuppressed(dom.modelSheet, true);
  setElementSuppressed(dom.modelSheetBackdrop, true);
  setElementSuppressed(dom.fileSheet, true);
  setElementSuppressed(dom.fileSheetBackdrop, true);

  dom.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('ai_chat_token');
    state.token = null;
    state.user = null;
    state.chats = [];
    state.currentChat = null;
    state.messages = [];
    state.activeTab = 'chat';
    memoryState.memories = [];
    memoryState.health = null;
    memoryState.loaded = false;
    finderState.cwd = '';
    finderState.items = [];
    finderState.selected.clear();
    finderState.clipboard = null;
    finderState.loadSeq += 1;
    clearTimeout(transferState.hideTimer);
    transferState.hideTimer = null;
    abortCurrentTransfer();
    transferState.xhr = null;
    transferState.active = false;
    setTransferModalVisible(false);
    initControlPanel.initialized = false;
    document.body?.classList.remove('is-admin');
    document.querySelectorAll('.tab-btn').forEach(btn => { btn.style.display = ''; btn.hidden = false; });
    closeSidebarOnMobile();
    closeMobileMoreMenu();
    closeModelSheet();
    closeFileSheet();
    showView('authView');
  });

  dom.newChatBtn.addEventListener('click', newChat);
  dom.mobileNewChatBtn?.addEventListener('click', newChat);
  dom.memoryComposeToggle?.addEventListener('click', () => {
    const next = dom.memoryComposeToggle.getAttribute('aria-expanded') !== 'true';
    setMemoryComposerOpen(next, { focus: next });
  });
  dom.memorySaveBtn?.addEventListener('click', saveMemory);
  dom.memoryRefreshBtn?.addEventListener('click', () => {
    loadMemories();
    refreshMemoryHealth();
  });
  dom.memoryHealth?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-memory-health-refresh]');
    if (!btn) return;
    refreshMemoryHealth();
  });
  dom.memorySearchInput?.addEventListener('input', () => {
    clearTimeout(dom.memorySearchInput._memoryTimer);
    dom.memorySearchInput._memoryTimer = setTimeout(loadMemories, 220);
  });
  dom.memoryFilterSelect?.addEventListener('change', loadMemories);
  dom.memoryList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-memory-action]');
    if (btn) handleMemoryAction(btn);
  });
  dom.tabMemory?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-memory-empty-compose]');
    if (!btn) return;
    setMemoryComposerOpen(true, { focus: true });
  });

  dom.chatSearchInput?.addEventListener('input', () => {
    state.chatSearchQuery = dom.chatSearchInput.value || '';
    renderChatList();
  });

  // Batch delete
  dom.batchSelectBtn?.addEventListener('click', () => {
    if (state.batchMode) exitBatchMode();
    else enterBatchMode();
  });
  dom.batchCancelBtn?.addEventListener('click', exitBatchMode);
  dom.batchDeleteBtn?.addEventListener('click', batchDeleteSelected);

  // Chat title inline edit
  const titleH1 = document.querySelector('.main-title-copy h1');
  const titleInput = dom.chatTitleInput;
  if (titleH1 && titleInput) {
    titleH1.addEventListener('click', () => {
      if (state.activeTab !== 'chat') return;
      if (!state.currentChat) return;
      titleH1.style.display = 'none';
      titleInput.style.display = '';
      titleInput.value = state.currentChat.title || '';
      titleInput.focus();
      titleInput.select();
    });
    titleInput.addEventListener('blur', () => {
      if (!state.currentChat) return;
      const newTitle = titleInput.value.trim();
      if (newTitle && newTitle !== state.currentChat.title) {
        renameChat(state.currentChat, newTitle);
      }
      titleInput.style.display = 'none';
      titleH1.style.display = '';
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { titleInput.blur(); }
      if (e.key === 'Escape') {
        titleInput.value = state.currentChat?.title || '';
        titleInput.blur();
      }
    });
  }
  dom.mobileSidebarBtn?.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
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
  dom.mobileMoreMenu?.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('button[data-mobile-action]');
    if (actionBtn?.dataset.mobileAction === 'sidebar') {
      closeMobileMoreMenu();
      openSidebarOnMobile({ refresh: true, resetSearch: true });
      return;
    }
    if (actionBtn?.dataset.mobileAction === 'new-chat') {
      closeMobileMoreMenu();
      newChat();
      return;
    }

    const themeBtn = e.target.closest('button[data-theme-choice]');
    if (themeBtn?.dataset.themeChoice) {
      setThemePreference(themeBtn.dataset.themeChoice);
      return;
    }

    const tabBtn = e.target.closest('button[data-mobile-tab]');
    if (tabBtn?.dataset.mobileTab) {
      setActiveTab(tabBtn.dataset.mobileTab);
      closeMobileMoreMenu();
    }
  });
  dom.mobileModelBtn?.addEventListener('click', openModelSheet);
  dom.closeModelSheet?.addEventListener('click', closeModelSheet);
  dom.modelSheetBackdrop?.addEventListener('click', closeModelSheet);

  dom.modelSheetList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.model-choice');
    if (!btn || !btn.dataset.modelId) return;
    const modelId = normalizeChatModel(btn.dataset.modelId);
    setSelectedModel(modelId);
    closeModelSheet();

    if (state.currentChat) {
      try {
        await API.patch(`/chats/${state.currentChat.id}`, { model: modelId });
        state.currentChat.model = modelId;
        await loadChats();
      } catch {
        /* ignore */
      }
    }
  });

  dom.modelSelect.addEventListener('change', async () => {
    const model = normalizeChatModel(dom.modelSelect.value);
    setSelectedModel(model);
    updateModelBadges();
    if (state.currentChat && model) {
      try {
        await API.patch(`/chats/${state.currentChat.id}`, { model });
        state.currentChat.model = model;
        await loadChats();
      } catch {
        /* ignore */
      }
    }
  });

  dom.finderUpBtn?.addEventListener('click', finderGoUp);
  dom.finderRefreshBtn?.addEventListener('click', finderRefresh);
  dom.finderSelectAllBtn?.addEventListener('click', () => updateFinderSelectionFromVisible(true));
  dom.finderPasteBtn?.addEventListener('click', finderPaste);
  dom.finderDownloadBtn?.addEventListener('click', downloadSelectedFinderItem);
  dom.finderUploadBtn?.addEventListener('click', () => dom.finderUploadInput?.click());
  dom.finderNewFolderBtn?.addEventListener('click', async () => {
    const result = await appPrompt({
      title: '新建文件夹',
      fields: [{ name: 'name', label: '文件夹名称', required: true }],
      confirmText: '创建',
    });
    const name = result?.name;
    if (!name || !name.trim()) return;
    setFinderButtonBusy(dom.finderNewFolderBtn, true);
    try {
      await API.post('/finder/mkdir', { path: finderState.cwd, name: name.trim() });
      await loadFinder(finderState.cwd);
    } catch (err) {
      toast(err.message || '创建文件夹失败');
    } finally {
      setFinderButtonBusy(dom.finderNewFolderBtn, false);
    }
  });
  dom.finderSearchInput?.addEventListener('input', () => {
    finderState.query = dom.finderSearchInput.value || '';
    clearTimeout(finderState.searchTimer);
    finderState.searchTimer = setTimeout(() => loadFinder(finderState.cwd), 180);
  });
  dom.finderList?.addEventListener('click', (e) => {
    const row = e.target.closest('.finder-item');
    if (!row) return;
    if (e.target.closest('.finder-select')) return;
    const item = finderState.items.find(it => it.path === row.dataset.path);
    if (!item) return;
    if (item.type === 'dir') {
      if (finderState.query.trim()) {
        finderState.query = '';
        if (dom.finderSearchInput) dom.finderSearchInput.value = '';
      }
      loadFinder(item.path);
    }
    else openFileSheet(item);
  });
  dom.finderSelectionBar?.addEventListener('click', (e) => { if (e.target === dom.finderSelectionBar) finderClearSelection(); });
  dom.finderCopyBtn?.addEventListener('click', () => finderSetClipboard('copy', [...finderState.selected]));
  dom.finderCutBtn?.addEventListener('click', () => finderSetClipboard('cut', [...finderState.selected]));
  dom.finderRenameBtn?.addEventListener('click', finderRenameSingle);
  dom.finderDeleteBtn?.addEventListener('click', () => finderDelete());
  dom.finderClearBtn?.addEventListener('click', finderClearSelection);
  dom.finderUploadInput?.addEventListener('change', async () => {
    try {
      await finderUploadFiles(Array.from(dom.finderUploadInput.files || []));
      dom.finderUploadInput.value = '';
    } catch (err) {
      toast(err.message || 'Upload failed');
    }
  });
  dom.fileSheetBackdrop?.addEventListener('click', closeFileSheet);
  dom.closeFileSheet?.addEventListener('click', closeFileSheet);
  dom.transferBackdrop?.addEventListener('click', abortCurrentTransfer);
  dom.closeTransferSheet?.addEventListener('click', abortCurrentTransfer);
  dom.transferCancelBtn?.addEventListener('click', abortCurrentTransfer);

  dom.messageInput.addEventListener('input', () => {
    updateSendButton();
    resizeComposer();
    saveInputDraft();
  });
  dom.inputArea?.addEventListener('focusin', () => syncMobileComposerFocus(true));
  dom.inputArea?.addEventListener('focusout', () => {
    window.setTimeout(() => syncMobileComposerFocus(dom.inputArea?.contains(document.activeElement)), 30);
  });

  dom.promptQuickbar?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-prompt-action]');
    if (!btn) return;
    applyPromptShortcut(btn.dataset.promptAction);
    closePromptAssistant({ returnFocus: false });
  });

  dom.promptAssistToggle?.addEventListener('click', togglePromptAssistant);

  dom.webSearchToggle?.addEventListener('click', () => {
    if (!state.webSearchAvailable || state.streaming) return;
    setWebSearchEnabled(!state.webSearchEnabled);
  });

  dom.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (state.streaming) return;
      sendMessage();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.streaming) return;
      sendMessage();
    }
  });

  dom.sendBtn.addEventListener('click', () => {
    if (state.streaming) {
      abortActiveRequest();
      return;
    }
    sendMessage();
  });

  dom.stopBtn?.addEventListener('click', () => {
    abortActiveRequest();
  });

  dom.messagesContainer.addEventListener('click', async (e) => {
    const codeCopyBtn = e.target.closest('button[data-code-copy]');
    if (codeCopyBtn) {
      const shell = codeCopyBtn.closest('.code-block-shell');
      const code = shell?.querySelector('pre code')?.textContent || '';
      if (!code) return;
      await copyMessageContent(code);
      const original = codeCopyBtn.textContent;
      codeCopyBtn.textContent = '已复制';
      codeCopyBtn.classList.add('is-success');
      window.setTimeout(() => {
        codeCopyBtn.textContent = original || '复制代码';
        codeCopyBtn.classList.remove('is-success');
      }, 1100);
      return;
    }

    const messageMenuBtn = e.target.closest('button[data-message-menu-toggle]');
    if (messageMenuBtn) {
      const menu = messageMenuBtn.closest('.message-action-menu');
      const messageEl = messageMenuBtn.closest('.message');
      if (openMobileMessageActionSheet(messageEl, messageMenuBtn)) return;
      const willOpen = !menu?.classList.contains('open');
      closeMessageActionMenus(menu);
      setMessageActionMenuOpen(menu, willOpen);
      return;
    }

    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    closeMessageActionMenus();
    const messageEl = btn.closest('.message');
    const messageId = messageEl?.dataset.messageId;
    const action = btn.dataset.action;
    await runMessageAction(action, messageId, btn);
  });

  document.addEventListener('click', async (e) => {
    const sheetBtn = e.target.closest('#mobileMessageActionSheet button[data-action]');
    if (!sheetBtn) return;
    const action = sheetBtn.dataset.action;
    const messageId = sheetBtn.dataset.messageId;
    closeMobileMessageActionSheet({ returnFocus: false });
    await runMessageAction(action, messageId, sheetBtn);
  });
  dom.messagesContainer.addEventListener('scroll', () => syncScrollToBottomButton(), { passive: true });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.message-action-menu')) closeMessageActionMenus();
    if (!e.target.closest('#promptQuickbar') && !e.target.closest('#promptAssistToggle')) {
      closePromptAssistant({ returnFocus: false });
    }
  });
  dom.scrollToBottomBtn?.addEventListener('click', () => scrollToBottom());

  syncMobileWebMode();
  window.addEventListener('resize', syncMobileWebMode, { passive: true });
  window.visualViewport?.addEventListener?.('resize', syncMobileWebMode, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (handleMacOSClientShortcut(e)) return;
    if (e.key === 'Escape') {
      closeMessageActionMenus();
      closeMobileMessageActionSheet({ returnFocus: false });
      closeMobileMoreMenu();
      closeSidebarOnMobile();
      closeModelSheet();
      closeFileSheet();
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) closeModelSheet();
  });
}

resetViewVisibility();
initAuth();
initEvents();
checkAuth();

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDateTime(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

function finderPathParts(rel) {
  if (!rel) return [];
  return rel.split('/').filter(Boolean);
}

function finderVisibleItems() {
  const q = finderState.query.trim().normalize('NFKC').toLowerCase();
  if (!q) return finderState.items;
  return finderState.items.filter(item => `${item.name} ${item.path}`.normalize('NFKC').toLowerCase().includes(q));
}

function finderSelectedItems() {
  return finderState.items.filter(item => finderState.selected.has(item.path));
}

function finderSetClipboard(mode, paths) {
  finderState.clipboard = { mode, paths: [...new Set(paths)], source: finderState.cwd };
  updateFinderToolbarState();
}

function finderToggleSelection(path, force) {
  if (typeof force === 'boolean') {
    if (force) finderState.selected.add(path);
    else finderState.selected.delete(path);
  } else if (finderState.selected.has(path)) {
    finderState.selected.delete(path);
  } else {
    finderState.selected.add(path);
  }
  updateFinderSelectionBar();
  renderFinderList();
}

function finderClearSelection() {
  finderState.selected.clear();
  updateFinderSelectionBar();
  renderFinderList();
}

function updateFinderToolbarState() {
  if (dom.finderPasteBtn) {
    dom.finderPasteBtn.disabled = !finderState.clipboard?.paths?.length;
  }
}

function setFinderButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.finderWasDisabled) {
      button.dataset.finderWasDisabled = button.disabled ? 'true' : 'false';
    }
    button.classList.add('is-busy');
    button.setAttribute('aria-busy', 'true');
    button.disabled = true;
    return;
  }

  const wasDisabled = button.dataset.finderWasDisabled === 'true';
  delete button.dataset.finderWasDisabled;
  button.classList.remove('is-busy');
  button.removeAttribute('aria-busy');
  button.disabled = wasDisabled;
}

function updateFinderSelectionBar() {
  const count = finderState.selected.size;
  if (dom.finderSelectionBar) dom.finderSelectionBar.classList.toggle('hidden', count === 0);
  if (dom.finderSelectionCount) dom.finderSelectionCount.textContent = `已选 ${count} 项`;
  if (dom.finderRenameBtn) dom.finderRenameBtn.disabled = count !== 1;
  if (dom.finderDownloadBtn) dom.finderDownloadBtn.disabled = count === 0;
  updateFinderToolbarState();
}

function renderFinderBreadcrumbs() {
  if (!dom.finderBreadcrumbs) return;
  const crumbs = [];
  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'finder-crumb';
  rootBtn.textContent = finderState.rootLabel || 'Home';
  rootBtn.addEventListener('click', () => loadFinder(''));
  crumbs.push(rootBtn);

  let accum = '';
  for (const part of finderPathParts(finderState.cwd)) {
    const sep = document.createElement('span');
    sep.className = 'finder-crumb-sep';
    sep.textContent = '›';
    crumbs.push(sep);
    accum = accum ? `${accum}/${part}` : part;
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'finder-crumb';
    crumb.textContent = part;
    const target = accum;
    crumb.addEventListener('click', () => loadFinder(target));
    crumbs.push(crumb);
  }

  dom.finderBreadcrumbs.replaceChildren(...crumbs);
}

function renderFinderSummary() {
  if (!dom.finderSummary) return;
  if (finderState.loading && finderState.query.trim()) {
    dom.finderSummary.textContent = '搜索中…';
    return;
  }
  const visible = finderVisibleItems();
  const folders = visible.filter(item => item.type === 'dir').length;
  const files = visible.length - folders;
  const suffix = finderState.query.trim() ? ' 个结果' : ' 项';
  const limited = finderState.truncated && finderState.query.trim()
    ? ` · 已显示前 ${finderState.maxResults || visible.length} 项`
    : '';
  dom.finderSummary.textContent = `${visible.length}${suffix} · ${folders} 个文件夹 · ${files} 个文件${limited}`;
}

function finderIconFor(item) {
  if (item.type === 'dir') return '📁';
  if (item.type === 'symlink') return '🔗';
  const ext = (item.ext || '').replace('.', '');
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'mkv', 'webm'].includes(ext)) return '🎞️';
  if (['mp3', 'm4a', 'wav', 'flac', 'aac'].includes(ext)) return '🎵';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['js', 'ts', 'json', 'html', 'css', 'md', 'txt'].includes(ext)) return '📝';
  return '📄';
}

function renderFinderList() {
  if (!dom.finderList || !dom.finderEmpty) return;
  const visible = finderVisibleItems();
  dom.finderList.innerHTML = '';
  dom.finderEmpty.textContent = finderState.loading
    ? (finderState.query.trim() ? '搜索中…' : '加载中…')
    : (finderState.query.trim() ? '没有匹配的文件。' : '此文件夹为空。');
  dom.finderEmpty.classList.toggle('hidden', finderState.loading || visible.length > 0);

  for (const item of visible) {
    const row = document.createElement('div');
    row.className = `finder-item finder-item-${item.type}${finderState.selected.has(item.path) ? ' selected' : ''}`;
    row.dataset.path = item.path;
    row.dataset.type = item.type;

    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'finder-select';
    checkbox.setAttribute('aria-label', `Select ${item.name}`);
    checkbox.textContent = finderState.selected.has(item.path) ? '✓' : '';
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      finderToggleSelection(item.path);
    });

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'finder-main';
    main.innerHTML = `
      <span class="finder-icon">${finderIconFor(item)}</span>
      <span class="finder-main-copy">
        <span class="finder-name">${escHtml(item.name)}</span>
        <span class="finder-meta">${item.type === 'dir' ? '文件夹' : formatBytes(item.size)} · ${formatDateTime(item.mtimeMs)}</span>
      </span>
    `;
    main.addEventListener('click', () => {
      if (item.type === 'dir') {
        loadFinder(item.path);
      } else {
        openFileSheet(item);
      }
    });

    const chevron = document.createElement('span');
    chevron.className = 'finder-chevron';
    chevron.textContent = item.type === 'dir' ? '›' : '↗';

    row.append(checkbox, main, chevron);
    dom.finderList.appendChild(row);
  }

  renderFinderBreadcrumbs();
  renderFinderSummary();
  updateFinderSelectionBar();
}

async function loadFinder(path = finderState.cwd) {
  if (!dom.finderList) return;
  const seq = ++finderState.loadSeq;
  if (finderState.loadController) {
    try { finderState.loadController.abort(); } catch {}
  }
  const controller = new AbortController();
  finderState.loadController = controller;
  finderState.loading = true;
  finderState.truncated = false;
  finderState.maxResults = 0;
  dom.tabFinder?.classList.add('is-loading');
  setFinderButtonBusy(dom.finderRefreshBtn, true);
  finderState.query = dom.finderSearchInput ? dom.finderSearchInput.value : finderState.query;
  dom.finderSearchInput?.classList.toggle('is-searching', Boolean(finderState.query.trim()));
  renderFinderList();

  const query = finderState.query.trim();
  const endpoint = query
    ? `/finder/search?path=${encodeURIComponent(path || '')}&q=${encodeURIComponent(query)}`
    : `/finder/list?path=${encodeURIComponent(path || '')}`;

  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const data = await API.get(endpoint, { signal: controller.signal });
        if (seq !== finderState.loadSeq || finderState.loadController !== controller) return;
        finderState.cwd = data.cwd || '';
        finderState.rootLabel = data.rootLabel || 'Home';
        finderState.items = data.items || [];
        finderState.truncated = Boolean(data.truncated);
        finderState.maxResults = Number(data.maxResults || 0);
        finderState.selected = new Set([...finderState.selected].filter(p => finderState.items.some(item => item.path === p)));
        if (dom.finderUpBtn) dom.finderUpBtn.disabled = !finderState.cwd;
        renderFinderList();
        return;
      } catch (err) {
        lastErr = err;
        if (err?.name === 'AbortError') return;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 150 * attempt));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    if (seq !== finderState.loadSeq || finderState.loadController !== controller) return;
    console.error('Failed to load finder:', err);
    finderState.items = [];
    renderFinderList();
    if (dom.finderEmpty) {
      dom.finderEmpty.textContent = err.message || '文件夹加载失败';
      dom.finderEmpty.classList.remove('hidden');
    }
    if (dom.finderUpBtn) dom.finderUpBtn.disabled = !finderState.cwd;
  } finally {
    if (finderState.loadController === controller) finderState.loadController = null;
    if (seq !== finderState.loadSeq) return;
    finderState.loading = false;
    dom.tabFinder?.classList.remove('is-loading');
    dom.finderSearchInput?.classList.remove('is-searching');
    setFinderButtonBusy(dom.finderRefreshBtn, false);
    renderFinderList();
  }
}

function finderGoUp() {
  if (!finderState.cwd) return;
  if (finderState.query.trim()) {
    finderState.query = '';
    if (dom.finderSearchInput) dom.finderSearchInput.value = '';
  }
  const parent = finderPathParts(finderState.cwd).slice(0, -1).join('/');
  loadFinder(parent);
}

function finderRefresh() {
  loadFinder(finderState.cwd);
}

async function finderPaste() {
  const clip = finderState.clipboard;
  if (!clip?.paths?.length) return;
  setFinderButtonBusy(dom.finderPasteBtn, true);
  try {
    const endpoint = clip.mode === 'cut' ? '/finder/move' : '/finder/copy';
    await API.post(endpoint, { sources: clip.paths, target: finderState.cwd });
    if (clip.mode === 'cut') finderState.clipboard = null;
    await loadFinder(finderState.cwd);
  } catch (err) {
    toast(err.message || 'Paste failed');
  } finally {
    setFinderButtonBusy(dom.finderPasteBtn, false);
    updateFinderToolbarState();
  }
}

async function finderDelete(paths = [...finderState.selected]) {
  if (!paths.length) return;
  const ok = await appConfirm({
    title: '删除文件',
    message: `将删除 ${paths.length} 项，此操作无法撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  setFinderButtonBusy(dom.finderDeleteBtn, true);
  try {
    await API.post('/finder/delete', { paths });
    finderClearSelection();
    await loadFinder(finderState.cwd);
  } catch (err) {
    toast(err.message || '删除失败');
  } finally {
    setFinderButtonBusy(dom.finderDeleteBtn, false);
  }
}

async function finderRenameSingle() {
  const [item] = finderSelectedItems();
  if (!item) return;
  const result = await appPrompt({
    title: '重命名',
    fields: [{ name: 'name', label: '新名称', value: item.name, required: true }],
    confirmText: '重命名',
  });
  const newName = result?.name;
  if (!newName || newName.trim() === item.name) return;
  setFinderButtonBusy(dom.finderRenameBtn, true);
  try {
    await API.post('/finder/rename', { path: item.path, name: newName.trim() });
    finderClearSelection();
    await loadFinder(finderState.cwd);
  } catch (err) {
    toast(err.message || '重命名失败');
  } finally {
    setFinderButtonBusy(dom.finderRenameBtn, false);
  }
}

function finderDownloadUrl(path) {
  return `/api/finder/download?path=${encodeURIComponent(path)}`;
}

async function downloadFinderItem(item) {
  if (transferState.active) {
    toast('A transfer is already running');
    return false;
  }
  const downloadName = item.type === 'dir' ? `${item.name}.zip` : item.name;
  beginTransferModal({ mode: 'download', title: '下载中', name: downloadName, total: 0, cancelable: true });
  try {
    const blob = await xhrRequest({
      method: 'GET',
      url: finderDownloadUrl(item.path),
      responseType: 'blob',
      onProgress: (e) => {
        if (!e.lengthComputable) return;
        applyTransferProgress({ loaded: e.loaded, total: e.total, title: '下载中', name: downloadName, status: '下载中…' });
      },
    });
    triggerBrowserDownload(blob, downloadName);
    finishTransferModal(`已保存 ${downloadName}`);
    return true;
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('cancel')) {
      finishTransferModal('Cancelled', true);
      return false;
    }
    finishTransferModal(err.message || '下载失败', true);
    toast(err.message || '下载失败');
    return false;
  }
}

async function downloadSelectedFinderItem() {
  const items = finderSelectedItems();
  if (!items.length) return;
  setFinderButtonBusy(dom.finderDownloadBtn, true);
  try {
    for (const item of items) {
      const ok = await downloadFinderItem(item);
      if (!ok) break;
    }
  } finally {
    setFinderButtonBusy(dom.finderDownloadBtn, false);
  }
}

async function readFinderPreview(item) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const data = await API.get(`/finder/read?path=${encodeURIComponent(item.path)}`);
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 120 * attempt));
        continue;
      }
    }
  }
  return { path: item.path, preview: null, reason: lastErr?.message || '文件读取失败', size: item.size, mtimeMs: item.mtimeMs };
}

async function openFileSheet(item) {
  finderState.previewItem = item;
  const preview = await readFinderPreview(item);
  if (dom.fileSheetTitle) dom.fileSheetTitle.textContent = item.name;
  if (dom.fileSheetMeta) {
    dom.fileSheetMeta.innerHTML = `
      <div class="file-meta-row"><span>类型</span><strong>${item.type === 'dir' ? '文件夹' : '文件'}</strong></div>
      <div class="file-meta-row"><span>大小</span><strong>${formatBytes(item.size)}</strong></div>
      <div class="file-meta-row"><span>修改时间</span><strong>${formatDateTime(item.mtimeMs)}</strong></div>
      <div class="file-meta-row"><span>路径</span><strong>${escHtml(item.path)}</strong></div>
    `;
  }
  if (dom.fileSheetPreview) {
    dom.fileSheetPreview.textContent = preview.preview ?? preview.reason ?? '无法预览。';
  }
  state.fileSheetReturnFocus = document.activeElement;
  dom.fileSheetBackdrop?.classList.remove('hidden');
  requestAnimationFrame(() => dom.fileSheetBackdrop?.classList.add('open'));
  dom.fileSheet?.classList.add('open');
  dom.fileSheet?.classList.remove('hidden');
  setElementSuppressed(dom.fileSheet, false);
  setElementSuppressed(dom.fileSheetBackdrop, false);
  focusFirstInteractive(dom.fileSheet);
  if (dom.fileDownloadBtn) {
    dom.fileDownloadBtn.textContent = item.type === 'dir' ? '下载文件夹' : '下载';
    dom.fileDownloadBtn.onclick = async () => {
      setFinderButtonBusy(dom.fileDownloadBtn, true);
      try {
        await downloadFinderItem(item);
      } finally {
        setFinderButtonBusy(dom.fileDownloadBtn, false);
      }
    };
  }
  dom.fileRenameBtn && (dom.fileRenameBtn.onclick = async () => {
    const result = await appPrompt({
      title: '重命名',
      fields: [{ name: 'name', label: '新名称', value: item.name, required: true }],
      confirmText: '重命名',
    });
    const newName = result?.name;
    if (!newName || newName.trim() === item.name) return;
    setFinderButtonBusy(dom.fileRenameBtn, true);
    try {
      await API.post('/finder/rename', { path: item.path, name: newName.trim() });
      closeFileSheet();
      await loadFinder(finderState.cwd);
    } catch (err) {
      toast(err.message || '重命名失败');
    } finally {
      setFinderButtonBusy(dom.fileRenameBtn, false);
    }
  });
  dom.fileDeleteBtn && (dom.fileDeleteBtn.onclick = async () => {
    const ok = await appConfirm({
      title: '删除文件',
      message: `确定删除“${item.name}”？此操作无法撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setFinderButtonBusy(dom.fileDeleteBtn, true);
    try {
      await API.post('/finder/delete', { paths: [item.path] });
      closeFileSheet();
      await loadFinder(finderState.cwd);
    } catch (err) {
      toast(err.message || '删除失败');
    } finally {
      setFinderButtonBusy(dom.fileDeleteBtn, false);
    }
  });
}

function closeFileSheet() {
  dom.fileSheetBackdrop?.classList.remove('open');
  dom.fileSheet?.classList.remove('open');
  dom.fileSheet?.classList.add('hidden');
  setElementSuppressed(dom.fileSheet, true);
  window.setTimeout(() => {
    if (!dom.fileSheetBackdrop?.classList.contains('open')) {
      dom.fileSheetBackdrop?.classList.add('hidden');
      setElementSuppressed(dom.fileSheetBackdrop, true);
      restoreFocus(state.fileSheetReturnFocus);
      state.fileSheetReturnFocus = null;
    }
  }, 180);
  finderState.previewItem = null;
}

function updateFinderSelectionFromVisible(selectAll) {
  const visible = finderVisibleItems();
  for (const item of visible) {
    if (selectAll) finderState.selected.add(item.path);
    else finderState.selected.delete(item.path);
  }
  updateFinderSelectionBar();
  renderFinderList();
}

async function uploadSingleFile(file, { totalBytes = 0, completedBytes = 0, index = 1, count = 1 } = {}) {
  const url = `/api/finder/upload?path=${encodeURIComponent(finderState.cwd || '')}&name=${encodeURIComponent(file.name)}`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await xhrRequest({
        method: 'POST',
        url,
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
        onProgress: (e) => {
          const loaded = completedBytes + (e.loaded || 0);
          applyTransferProgress({
            loaded,
            total: totalBytes,
            title: count > 1 ? `上传 ${index}/${count}` : '上传中',
            name: file.name,
            status: '上传中…',
          });
        },
      });
      return result;
    } catch (err) {
      if (String(err.message || '').toLowerCase().includes('cancel')) throw err;
      if (attempt >= maxAttempts) throw err;
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
  }
}

async function finderUploadFiles(files) {
  if (!files?.length) return;
  if (transferState.active) {
    toast('A transfer is already running');
    return;
  }
  setFinderButtonBusy(dom.finderUploadBtn, true);
  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
  let completedBytes = 0;
  beginTransferModal({ mode: 'upload', title: files.length > 1 ? `上传 ${files.length} 个文件` : '上传中', name: files[0]?.name || '文件', total: totalBytes, cancelable: true });
  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      await uploadSingleFile(file, { totalBytes, completedBytes, index: i + 1, count: files.length });
      completedBytes += file.size || 0;
      applyTransferProgress({
        loaded: completedBytes,
        total: totalBytes,
        title: files.length > 1 ? `上传 ${i + 1}/${files.length}` : '上传中',
        name: file.name,
        status: '已上传',
      });
    }
    await loadFinder(finderState.cwd);
    finishTransferModal(`已上传 ${files.length} 个文件`);
  } catch (err) {
    if (String(err.message || '').toLowerCase().includes('cancel')) {
      finishTransferModal('Cancelled', true);
      return;
    }
    finishTransferModal(err.message || 'Upload failed', true);
    throw err;
  } finally {
    setFinderButtonBusy(dom.finderUploadBtn, false);
  }
}

function setActiveTab(tab) {
  if (!canAccessTab(tab)) tab = 'chat';
  state.activeTab = tab;
  const tabChat = document.getElementById('tabChat');
  const tabMemory = document.getElementById('tabMemory');
  const tabControl = document.getElementById('tabControl');
  const tabTerminal = document.getElementById('tabTerminal');
  const tabFinder = document.getElementById('tabFinder');
  const inputArea = document.getElementById('inputArea');
  const tabNav = document.getElementById('tabNav');
  const buttons = tabNav?.querySelectorAll('.tab-btn') || [];

  dom.chatView?.classList.toggle('is-chat-tab-active', tab === 'chat');
  dom.chatView?.setAttribute('data-active-tab', tab);
  buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  if (tabChat) tabChat.classList.toggle('hidden', tab !== 'chat');
  if (tabMemory) tabMemory.classList.toggle('hidden', tab !== 'memory');
  if (tabControl) tabControl.classList.toggle('hidden', tab !== 'control');
  if (tabTerminal) tabTerminal.classList.toggle('hidden', tab !== 'terminal');
  if (tabFinder) tabFinder.classList.toggle('hidden', tab !== 'finder');
  if (inputArea) inputArea.classList.toggle('hidden', tab !== 'chat');
  updateChatHeaderTitle();
  syncMobileMoreMenu();
  if (tab !== 'chat') {
    closePromptAssistant({ returnFocus: false });
    closeMessageActionMenus();
    syncMobileComposerFocus(false);
  }

  if (tab === 'control') {
    refreshControlState();
    refreshApps({ force: true });
    if (controlPollTimer) clearInterval(controlPollTimer);
    controlPollTimer = setInterval(refreshControlState, 3000);
  } else {
    if (controlPollTimer) { clearInterval(controlPollTimer); controlPollTimer = null; }
  }

  if (tab === 'finder') {
    loadFinder(finderState.cwd || '');
  }
  if (tab === 'memory') {
    loadMemories();
    refreshMemoryHealth();
  }
  if (tab === 'terminal') {
    ensureTerminalEmptyState();
    syncTerminalCwdLabel();
    setTimeout(() => document.getElementById('terminalInput')?.focus?.({ preventScroll: true }), 50);
  }
  syncScrollToBottomButton();
}

// ── Control Panel ───────────────────────────────────────
let controlPollTimer = null;

function initControlPanel() {
  const tabNav = document.getElementById('tabNav');
  if (!tabNav || initControlPanel.initialized) return;
  initControlPanel.initialized = true;

  const tabBtns = tabNav.querySelectorAll('.tab-btn');
  const tabChat = document.getElementById('tabChat');
  const tabMemory = document.getElementById('tabMemory');
  const tabControl = document.getElementById('tabControl');
  const tabTerminal = document.getElementById('tabTerminal');
  const tabFinder = document.getElementById('tabFinder');
  const inputArea = document.getElementById('inputArea');

  tabBtns.forEach(btn => {
    const tab = btn.dataset.tab || 'chat';
    const allowed = canAccessTab(tab);
    btn.hidden = !allowed;
    btn.style.display = allowed ? '' : 'none';
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.hidden || btn.style.display === 'none') return;
      setActiveTab(btn.dataset.tab || 'chat');
    });
  });

  setActiveTab('chat');

  document.getElementById('controlRefreshBtn')?.addEventListener('click', () => {
    refreshControlState({ force: true, manual: true });
  });

  // Volume
  const volSlider = document.getElementById('volSlider');
  const muteBtn = document.getElementById('muteBtn');
  if (volSlider) {
    const volFill = document.getElementById('volFill');
    syncSliderFill(volSlider, volFill);
    volSlider.addEventListener('input', () => {
      document.getElementById('volVal').textContent = volSlider.value;
      syncSliderFill(volSlider, volFill);
    });
    volSlider.addEventListener('change', async () => {
      setControlStatus('正在设置音量…', 'loading');
      const ok = await ctrlPost('/control/volume', { volume: parseInt(volSlider.value) });
      setControlStatus(ok ? '音量已更新' : '音量更新失败', ok ? 'ok' : 'error');
    });
  }
  if (muteBtn) {
    muteBtn.addEventListener('click', async () => {
      const isMuted = muteBtn.classList.toggle('muted');
      setControlBusy(muteBtn, true);
      const ok = await ctrlPost('/control/volume/mute', { muted: isMuted });
      if (!ok) muteBtn.classList.toggle('muted', !isMuted);
      setControlStatus(ok ? (isMuted ? '已静音' : '已取消静音') : '静音切换失败', ok ? 'ok' : 'error');
      setControlBusy(muteBtn, false);
    });
  }

  // Brightness
  const briSlider = document.getElementById('briSlider');
  if (briSlider) {
    const briFill = document.getElementById('briFill');
    syncSliderFill(briSlider, briFill);
    briSlider.addEventListener('input', () => {
      document.getElementById('briVal').textContent = briSlider.value;
      syncSliderFill(briSlider, briFill);
    });
    briSlider.addEventListener('change', async () => {
      setControlStatus('正在设置亮度…', 'loading');
      const ok = await ctrlPost('/control/brightness', { brightness: parseInt(briSlider.value) });
      setControlStatus(ok ? '亮度已更新' : '亮度更新失败', ok ? 'ok' : 'error');
    });
  }

  document.querySelectorAll('[data-control-preset]').forEach(btn => {
    btn.addEventListener('click', () => applyControlPreset(btn.dataset.controlPreset, btn));
  });

  // Bluetooth
  const btToggle = document.getElementById('btToggle');
  if (btToggle) {
    btToggle.addEventListener('change', async () => {
      const previous = !btToggle.checked;
      document.getElementById('btStatus').textContent = btToggle.checked ? '已开启' : '已关闭';
      setControlHint('btHint', '切换中', 'loading');
      btToggle.disabled = true;
      const ok = await ctrlPost('/control/bluetooth', { enabled: btToggle.checked });
      if (!ok) {
        btToggle.checked = previous;
        document.getElementById('btStatus').textContent = previous ? '已开启' : '已关闭';
      }
      setControlHint('btHint', ok ? '已同步' : '失败', ok ? 'ok' : 'error');
      setControlStatus(ok ? '蓝牙状态已更新' : '蓝牙切换失败', ok ? 'ok' : 'error');
      btToggle.disabled = false;
    });
  }

  // Apps
  const appNameInput = document.getElementById('appNameInput');
  if (appNameInput) {
    document.getElementById('appOpenBtn')?.addEventListener('click', async () => {
      const name = appNameInput.value.trim();
      if (!name) return;
      const btn = document.getElementById('appOpenBtn');
      setControlBusy(btn, true, '打开中…');
      const ok = await ctrlPost('/control/apps/open', { app: name });
      appNameInput.value = '';
      setControlBusy(btn, false);
      setAppStatus(ok ? `已发送打开 ${name} 的请求。` : `打开 ${name} 失败。`, ok ? '' : 'error');
      refreshApps({ force: true });
    });
    document.getElementById('appCloseBtn')?.addEventListener('click', async () => {
      const name = appNameInput.value.trim();
      if (!name) return;
      const btn = document.getElementById('appCloseBtn');
      setControlBusy(btn, true, '关闭中…');
      const ok = await ctrlPost('/control/apps/close', { app: name });
      appNameInput.value = '';
      setControlBusy(btn, false);
      setAppStatus(ok ? `已发送关闭 ${name} 的请求。` : `关闭 ${name} 失败。`, ok ? '' : 'error');
      refreshApps({ force: true });
    });
    appNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('appOpenBtn')?.click();
    });
  }
  document.getElementById('appRefreshBtn')?.addEventListener('click', () => refreshApps({ force: true }));
  document.getElementById('appSearchInput')?.addEventListener('input', (e) => {
    controlAppState.query = e.target.value.trim();
    renderApps();
  });

  // Terminal
  const terminalInput = document.getElementById('terminalInput');
  if (terminalInput) {
    ensureTerminalEmptyState();
    syncTerminalCwdLabel();
    document.getElementById('terminalRunBtn')?.addEventListener('click', runTerminalCommand);
    document.getElementById('terminalClearBtn')?.addEventListener('click', clearTerminalOutput);
    document.getElementById('terminalCopyBtn')?.addEventListener('click', copyTerminalOutput);
    document.getElementById('terminalHomeBtn')?.addEventListener('click', resetTerminalCwd);
    terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runTerminalCommand();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        clearTerminalOutput();
      } else if (e.key === 'ArrowUp') {
        const command = getTerminalHistory(-1);
        if (command !== null) {
          e.preventDefault();
          terminalInput.value = command;
          terminalInput.setSelectionRange(command.length, command.length);
        }
      } else if (e.key === 'ArrowDown') {
        const command = getTerminalHistory(1);
        if (command !== null) {
          e.preventDefault();
          terminalInput.value = command;
          terminalInput.setSelectionRange(command.length, command.length);
        }
      }
    });
  }
}

function setControlStatus(text, tone = '') {
  const status = document.getElementById('controlStatus');
  const strip = status?.closest('.control-status-strip');
  if (!status || !strip) return;
  status.textContent = text;
  strip.dataset.tone = tone;
}

function setControlLastRefresh(date = new Date()) {
  const el = document.getElementById('controlLastRefresh');
  if (!el) return;
  const text = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.textContent = `上次刷新 ${text}`;
}

function setControlHint(id, text, tone = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function setControlBusy(btn, busy, busyText = '') {
  if (!btn) return;
  if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
  btn.disabled = Boolean(busy);
  btn.classList.toggle('is-busy', Boolean(busy));
  if (busy && busyText) btn.textContent = busyText;
  if (!busy) btn.innerHTML = btn.dataset.idleHtml;
}

function setControlSlider(kind, value) {
  const slider = document.getElementById(kind === 'volume' ? 'volSlider' : 'briSlider');
  const fill = document.getElementById(kind === 'volume' ? 'volFill' : 'briFill');
  const label = document.getElementById(kind === 'volume' ? 'volVal' : 'briVal');
  if (!slider) return;
  slider.value = String(value);
  if (label) label.textContent = String(value);
  syncSliderFill(slider, fill);
}

async function applyControlPreset(value, btn) {
  if (!value) return;
  const [kind, rawAmount] = value.split(':');
  const amount = Math.max(0, Math.min(100, parseInt(rawAmount, 10) || 0));
  if (kind !== 'volume' && kind !== 'brightness') return;
  setControlSlider(kind, amount);
  setControlBusy(btn, true);
  setControlStatus(`正在设置${kind === 'volume' ? '音量' : '亮度'}…`, 'loading');
  const ok = await ctrlPost(kind === 'volume' ? '/control/volume' : '/control/brightness', {
    [kind === 'volume' ? 'volume' : 'brightness']: amount,
  });
  setControlStatus(ok ? `${kind === 'volume' ? '音量' : '亮度'}已更新` : `${kind === 'volume' ? '音量' : '亮度'}更新失败`, ok ? 'ok' : 'error');
  setControlBusy(btn, false);
}

function setTerminalStatus(text, tone = '') {
  const el = document.getElementById('terminalStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
  const pill = el.closest('.terminal-status-pill');
  if (pill) pill.dataset.tone = tone;
}

function setTerminalBusy(busy) {
  controlUiState.terminalRunning = Boolean(busy);
  setControlBusy(document.getElementById('terminalRunBtn'), busy, '运行中…');
  const input = document.getElementById('terminalInput');
  if (input) input.disabled = Boolean(busy);
}

function normalizeTerminalCwd(cwd) {
  const value = String(cwd || '').trim();
  return value || '~';
}

function syncTerminalCwdLabel(cwd = controlUiState.terminalCwd) {
  const display = normalizeTerminalCwd(cwd);
  controlUiState.terminalCwd = display;
  const cwdEl = document.getElementById('terminalCwd');
  const promptEl = document.getElementById('terminalPromptCwd');
  if (cwdEl) cwdEl.textContent = display;
  if (promptEl) promptEl.textContent = display;
}

function resetTerminalCwd() {
  syncTerminalCwdLabel('~');
  appendTerminalEntry('meta', 'cwd reset to home');
  setTerminalStatus('已回到 Home', 'ok');
  document.getElementById('terminalInput')?.focus?.({ preventScroll: true });
}

function addTerminalHistory(command) {
  if (!command) return;
  const history = controlUiState.terminalHistory;
  if (history[history.length - 1] !== command) history.push(command);
  if (history.length > 30) history.shift();
  controlUiState.terminalHistoryIndex = history.length;
}

function getTerminalHistory(direction) {
  const history = controlUiState.terminalHistory;
  if (!history.length) return null;
  const next = Math.max(0, Math.min(history.length, controlUiState.terminalHistoryIndex + direction));
  controlUiState.terminalHistoryIndex = next;
  return next === history.length ? '' : history[next];
}

function ensureTerminalEmptyState() {
  const output = document.getElementById('terminalOutput');
  if (!output) return;
  if (!output.children.length) {
    const empty = document.createElement('div');
    empty.className = 'terminal-empty';
    empty.textContent = '暂无命令输出。';
    output.appendChild(empty);
  }
}

function clearTerminalOutput() {
  const output = document.getElementById('terminalOutput');
  if (!output) return;
  output.innerHTML = '';
  ensureTerminalEmptyState();
  setTerminalStatus('已清空', 'ok');
}

async function copyTerminalOutput() {
  const output = document.getElementById('terminalOutput');
  const text = output?.innerText?.trim() || '';
  if (!text || output?.querySelector('.terminal-empty')) {
    toast('没有可复制的输出');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制终端输出');
    setTerminalStatus('输出已复制', 'ok');
  } catch {
    toast('复制失败');
    setTerminalStatus('复制失败', 'error');
  }
}

function appendTerminalEntry(kind, text) {
  const output = document.getElementById('terminalOutput');
  if (!output) return;
  const empty = output.querySelector('.terminal-empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = `terminal-line terminal-line-${kind}`;
  row.innerHTML = text;
  output.appendChild(row);
  output.scrollTop = output.scrollHeight;
}

async function runTerminalCommand() {
  const input = document.getElementById('terminalInput');
  if (!input) return;
  if (controlUiState.terminalRunning) return;
  const command = input.value.trim();
  if (!command) return;

  if (command === 'clear') {
    clearTerminalOutput();
    input.value = '';
    return;
  }

  const cwdBeforeRun = normalizeTerminalCwd(controlUiState.terminalCwd);
  appendTerminalEntry('command', `<span class="terminal-prefix">${escHtml(cwdBeforeRun)} $</span> ${escHtml(command)}`);
  addTerminalHistory(command);
  input.value = '';
  setTerminalBusy(true);
  setTerminalStatus('运行中…', 'loading');
  const started = performance.now();
  const res = await ctrlPost('/control/terminal/run', {
    command,
    cwd: cwdBeforeRun === '~' ? '' : cwdBeforeRun,
  });
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  if (!res) {
    appendTerminalEntry('error', '命令运行失败。');
    appendTerminalEntry('meta', `failed · ${elapsed}s`);
    setTerminalStatus(`运行失败 · ${elapsed}s`, 'error');
    setTerminalBusy(false);
    return;
  }
  if (res.stdout) appendTerminalEntry('output', escHtml(res.stdout).replace(/\n/g, '<br>'));
  if (res.stderr) appendTerminalEntry('error', escHtml(res.stderr).replace(/\n/g, '<br>'));
  if (res.cwd) syncTerminalCwdLabel(res.cwd);
  const code = res.code ?? 0;
  appendTerminalEntry('meta', `exit ${escHtml(String(code))} · ${elapsed}s`);
  setTerminalStatus(`退出码 ${code} · ${elapsed}s`, Number(code) === 0 ? 'ok' : 'error');
  setTerminalBusy(false);
}

async function ctrlPost(path, body) {
  try {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
    return res.ok && !data?.error ? data : null;
  } catch (e) { return null; }
}

async function ctrlGet(path) {
  try {
    const r = await fetch(`/api${path}`, { headers: { 'Authorization': `Bearer ${state.token}` } });
    const data = await r.json();
    return r.ok && !data?.error ? data : null;
  } catch (e) { return null; }
}

async function refreshControlState({ force = false, manual = false } = {}) {
  if (controlUiState.refreshing && !force) return;
  controlUiState.refreshing = true;
  const refreshBtn = document.getElementById('controlRefreshBtn');
  setControlBusy(refreshBtn, true, '刷新中…');
  setControlStatus('正在读取控制状态…', 'loading');
  let okCount = 0;

  const vol = await ctrlGet('/control/volume');
  if (vol) {
    okCount += 1;
    setControlSlider('volume', Number(vol.volume) || 0);
    const m = document.getElementById('muteBtn');
    if (m) m.classList.toggle('muted', Boolean(vol.muted));
  }

  const bri = await ctrlGet('/control/brightness');
  if (bri) {
    okCount += 1;
    setControlSlider('brightness', Number(bri.brightness) || 0);
  }

  const mem = await ctrlGet('/control/memory');
  if (mem) {
    okCount += 1;
    const percent = Math.max(0, Math.min(100, Number(mem.percent) || 0));
    const usedGB = (mem.used / 1073741824).toFixed(1);
    const freeGB = (mem.available / 1073741824).toFixed(1);
    const totalGB = (mem.total / 1073741824).toFixed(0);
    const p = document.getElementById('memPct'); if (p) p.textContent = `${percent.toFixed(1)}%`;
    const u = document.getElementById('mUsed'); if (u) u.textContent = usedGB + ' GB';
    const f = document.getElementById('mFree'); if (f) f.textContent = freeGB + ' GB';
    const t = document.getElementById('mTotal'); if (t) t.textContent = totalGB + ' GB';
    const ring = document.getElementById('memRing');
    if (ring) ring.style.strokeDashoffset = 207.3 - (percent / 100) * 207.3;
    const memCard = document.getElementById('memoryCard');
    if (memCard) memCard.classList.toggle('is-high-memory', percent >= 82);
    setControlHint('memLoadTag', percent >= 82 ? '偏高' : '正常', percent >= 82 ? 'warn' : 'ok');
  } else {
    setControlHint('memLoadTag', '读取失败', 'error');
  }

  const bt = await ctrlGet('/control/bluetooth');
  if (bt) {
    okCount += 1;
    const tgl = document.getElementById('btToggle');
    const st = document.getElementById('btStatus');
    if (tgl) tgl.checked = Boolean(bt.enabled);
    if (st) st.textContent = bt.enabled ? '已开启' : '已关闭';
    setControlHint('btHint', '已同步', 'ok');
  } else {
    setControlHint('btHint', '读取失败', 'error');
  }

  const vpn = await ctrlGet('/control/vpn');
  const c = document.getElementById('vpnList');
  if (vpn && c) {
    okCount += 1;
    if (!vpn.vpns?.length) {
      c.innerHTML = '<span class="vpn-empty">未发现 VPN 配置</span>';
    } else {
      c.innerHTML = '';
      for (const vp of vpn.vpns) {
        const item = document.createElement('div');
        item.className = 'vpn-item';
        item.innerHTML = `<span class="vpn-dot${vp.connected ? ' on' : ''}"></span><span class="vpn-name">${escHtml(vp.name)}</span><button class="vpn-connect-btn${vp.connected ? ' connected' : ''}" type="button">${vp.connected ? '断开' : '连接'}</button>`;
        item.querySelector('button').addEventListener('click', async function() {
          setControlBusy(this, true, vp.connected ? '断开中…' : '连接中…');
          const ok = await ctrlPost('/control/vpn/toggle', { name: vp.name, connect: !vp.connected });
          setControlStatus(ok ? 'VPN 操作已发送' : 'VPN 操作失败', ok ? 'ok' : 'error');
          setTimeout(() => refreshControlState({ force: true }), 1200);
        });
        c.appendChild(item);
      }
    }
  } else if (c) {
    c.innerHTML = '<span class="vpn-empty vpn-error">无法读取 VPN 配置</span>';
  }

  await refreshApps({ force: manual });
  if (okCount > 0) {
    setControlStatus('控制服务已连接', 'ok');
    setControlLastRefresh();
  } else {
    setControlStatus('控制服务无响应', 'error');
  }
  setControlBusy(refreshBtn, false);
  controlUiState.refreshing = false;
}

function normalizeRunningApps(payload) {
  const items = Array.isArray(payload?.apps) ? payload.apps : [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const app = typeof item === 'string'
      ? { name: item }
      : { name: item?.name || item?.app || '', pid: item?.pid || null, frontmost: Boolean(item?.frontmost) };
    app.name = String(app.name || '').trim();
    if (!app.name || seen.has(app.name)) continue;
    seen.add(app.name);
    normalized.push(app);
  }
  return normalized.sort((a, b) => {
    if (a.frontmost !== b.frontmost) return a.frontmost ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

function visibleRunningApps() {
  const query = (controlAppState.query || '').toLowerCase();
  if (!query) return controlAppState.apps;
  return controlAppState.apps.filter(app => app.name.toLowerCase().includes(query));
}

function setAppStatus(text, tone = '') {
  const status = document.getElementById('appStatus');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('is-error', tone === 'error');
  status.classList.toggle('is-loading', tone === 'loading');
}

function renderApps() {
  const container = document.getElementById('appChips');
  if (!container) return;
  container.innerHTML = '';

  const apps = visibleRunningApps();
  if (!apps.length) {
    setAppStatus(controlAppState.query ? '没有匹配的运行中应用。' : '未发现正在运行的前台应用。');
    return;
  }

  const frontmost = apps.find(app => app.frontmost);
  setAppStatus(frontmost ? `当前：${frontmost.name} · 共 ${apps.length} 个应用` : `正在运行 ${apps.length} 个前台应用`);
  for (const app of apps) {
    const item = document.createElement('div');
    item.className = `running-app-item${app.frontmost ? ' is-frontmost' : ''}`;
    item.innerHTML = `
      <div class="running-app-main">
        <span class="running-app-dot"></span>
        <span class="running-app-name">${escHtml(app.name)}</span>
        ${app.frontmost ? '<span class="running-app-front">当前</span>' : ''}
      </div>
      <button class="running-app-close" type="button" aria-label="关闭 ${escHtml(app.name)}"><span class="running-app-close-mark">×</span><span>关闭</span></button>
    `;
    item.querySelector('.running-app-close').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      setControlBusy(btn, true, '关闭中…');
      const ok = await ctrlPost('/control/apps/close', { app: app.name });
      setAppStatus(ok ? `已发送关闭 ${app.name} 的请求。` : `关闭 ${app.name} 失败。`, ok ? '' : 'error');
      setTimeout(() => refreshApps({ force: true }), 700);
    });
    container.appendChild(item);
  }
}

async function refreshApps({ force = false } = {}) {
  const now = Date.now();
  if (!force && controlAppState.loading) return;
  if (!force && now - controlAppState.lastLoadedAt < controlAppState.minRefreshMs) return;

  controlAppState.loading = true;
  const refreshBtn = document.getElementById('appRefreshBtn');
  setControlBusy(refreshBtn, true, '扫描中…');
  setAppStatus('正在扫描运行中的应用…', 'loading');
  try {
    const apps = await ctrlGet('/control/apps');
    if (!apps) {
      setAppStatus('无法读取运行中应用。', 'error');
      return;
    }
    controlAppState.apps = normalizeRunningApps(apps);
    controlAppState.lastLoadedAt = Date.now();
    renderApps();
  } catch {
    setAppStatus('无法读取运行中应用。', 'error');
  } finally {
    controlAppState.loading = false;
    setControlBusy(refreshBtn, false);
  }
}
