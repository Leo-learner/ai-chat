export const THEME_PREFERENCE_STORAGE_KEY = 'ai_chat_theme_preference';
export const THEME_CHOICES = ['system', 'light', 'dark'];
export const DEFAULT_CHAT_MODEL = '';
export const ALLOWED_CHAT_MODELS = [];
export const CHAT_DRAFT_STORAGE_PREFIX = 'ai_chat_draft:';
export const MESSAGE_RENDER_LIMIT = 60;

export function getStoredThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return THEME_CHOICES.includes(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

export const state = {
  token: localStorage.getItem('ai_chat_token'),
  user: null,
  chats: [],
  currentChat: null,
  messages: [],
  models: [],
  defaultModel: '',
  streaming: false,
  streamAbort: null,
  activeRequestId: 0,
  batchMode: false,
  batchSelected: new Set(),
  chatSearchQuery: '',
  stoppedDraft: null,
  webSearchEnabled: false,
  webSearchAvailable: false,
  messageRenderExpanded: false,
  chatListLoading: false,
  sidebarReturnFocus: null,
  moreReturnFocus: null,
  activeDialog: null,
  themePreference: getStoredThemePreference(),
};

export function normalizeChatModel(modelId) {
  if (!modelId) return DEFAULT_CHAT_MODEL || (state.models[0]?.id || '');
  if (!ALLOWED_CHAT_MODELS.length) return modelId;
  return ALLOWED_CHAT_MODELS.includes(modelId) ? modelId : (DEFAULT_CHAT_MODEL || ALLOWED_CHAT_MODELS[0]);
}

export const dom = Object.fromEntries([
  'authView', 'chatView', 'loginForm', 'registerForm', 'loginError', 'regError',
  'loginUser', 'loginPass', 'regUser', 'regEmail', 'regPass', 'logoutBtn',
  'newChatBtn', 'mobileMoreBtn', 'mobileMoreMenu', 'mobileMoreBackdrop',
  'closeMobileMoreBtn', 'mobileNewChatBtn', 'mobileSidebarBtn', 'sidebarBackdrop',
  'chatList', 'chatSearchInput', 'chatSearchEmpty', 'batchSelectBtn',
  'batchActionBar', 'batchCount', 'batchDeleteBtn', 'batchCancelBtn',
  'chatTitleInput', 'userAvatar', 'userName', 'emptyState',
  'messagesContainer', 'inputArea', 'modelSelect', 'messageInput',
  'webSearchToggle', 'sendBtn', 'stopBtn', 'scrollToBottomBtn', 'settingsBtn',
  'settingsBackdrop', 'settingsModal', 'closeSettingsBtn', 'settingsForm',
  'settingsUsername', 'settingsNewPassword', 'settingsConfirmPassword',
  'settingsCurrentPassword', 'settingsMessage', 'settingsSaveBtn',
  'settingsLogoutBtn'
].map(id => [id, document.getElementById(id)]));
dom.tabs = document.querySelectorAll('.auth-tab');
