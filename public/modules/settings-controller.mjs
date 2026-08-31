export function createSettingsController({ state, dom, API, ui }) {
  const { restoreFocus, setElementSuppressed, syncThemeControls, toast } = ui;

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

  return { closeSettings, openSettings, submitSettings };
}

