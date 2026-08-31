export function createUiController({
  state,
  dom,
  themeChoices,
  themePreferenceStorageKey,
  getStoredThemePreference,
  escapeHtml,
  escapeAttr,
  getChatController,
}) {
  const THEME_CHOICES = themeChoices;
  const THEME_PREFERENCE_STORAGE_KEY = themePreferenceStorageKey;

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
    if (refresh && state.token) getChatController().loadChats({ showLoading: state.chats.length === 0, notifyError: true });
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

  return { applyThemePreference, appConfirm, appPrompt, bindSidebarSwipeToClose, closeAppDialog, closeMessageActionMenus, closeMobileMessageActionSheet, closeMobileMoreMenu, closeSidebarOnMobile, focusFirstInteractive, isMobileLayout, openAppDialog, openMobileMessageActionSheet, openMobileMoreMenu, openSidebarOnMobile, resetViewVisibility, restoreFocus, setElementSuppressed, setMessageActionMenuOpen, setThemePreference, showView, syncMobileComposerFocus, syncMobileWebMode, syncResponsiveSidebarState, syncThemeControls, toast };
}
