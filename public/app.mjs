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
import { createUiController } from './modules/ui-controller.mjs';
import { createChatController } from './modules/chat-controller.mjs';
import { createAuthController } from './modules/auth-controller.mjs';
import { createSettingsController } from './modules/settings-controller.mjs';
import {
  escapeAttr,
  escapeHtml,
} from './modules/message-renderer.mjs';

let authController;
const API = createApiClient({ getToken: () => state.token, onAuthExpired: () => authController?.handleAuthExpired() });

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

let chatController;
const ui = createUiController({
  state,
  dom,
  themeChoices: THEME_CHOICES,
  themePreferenceStorageKey: THEME_PREFERENCE_STORAGE_KEY,
  getStoredThemePreference,
  escapeHtml,
  escapeAttr,
  getChatController: () => chatController,
});
const {
  bindSidebarSwipeToClose,
  closeMessageActionMenus,
  closeMobileMessageActionSheet,
  closeMobileMoreMenu,
  closeSidebarOnMobile,
  openMobileMessageActionSheet,
  openMobileMoreMenu,
  openSidebarOnMobile,
  resetViewVisibility,
  setElementSuppressed,
  setMessageActionMenuOpen,
  setThemePreference,
  syncMobileComposerFocus,
  syncMobileWebMode,
  syncResponsiveSidebarState,
} = ui;


chatController = createChatController({
  state,
  dom,
  API,
  allowedChatModels: ALLOWED_CHAT_MODELS,
  defaultChatModel: DEFAULT_CHAT_MODEL,
  normalizeChatModel,
  chatDraftStoragePrefix: CHAT_DRAFT_STORAGE_PREFIX,
  messageRenderLimit: MESSAGE_RENDER_LIMIT,
  ui,
});
const {
  abortActiveRequest,
  batchDeleteSelected,
  copyMessageContent,
  enterBatchMode,
  exitBatchMode,
  newChat,
  renderChatList,
  renameChat,
  resizeComposer,
  runMessageAction,
  saveInputDraft,
  scrollToBottom,
  sendMessage,
  setWebSearchEnabled,
  syncScrollToBottomButton,
  updateSendButton,
} = chatController;


authController = createAuthController({ state, dom, API, ui, chat: chatController });
const { checkAuth, initAuth, logout } = authController;
const settingsController = createSettingsController({ state, dom, API, ui });
const { closeSettings, openSettings, submitSettings } = settingsController;


function initEvents() {
  const sidebar = document.getElementById('sidebar');
  sidebar?.classList.add('hidden');
  for (const element of [sidebar, dom.sidebarBackdrop, dom.mobileMoreMenu, dom.mobileMoreBackdrop, dom.settingsModal, dom.settingsBackdrop]) {
    setElementSuppressed(element, true);
  }

  dom.logoutBtn.addEventListener('click', logout);

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
