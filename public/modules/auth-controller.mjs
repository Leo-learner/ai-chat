export function createAuthController({ state, dom, API, ui, chat }) {
  const { closeMobileMoreMenu, closeSidebarOnMobile, showView, syncResponsiveSidebarState, toast } = ui;
  const { abortActiveRequest, clearInputDrafts, loadChats, loadModels, renderChatList, restoreInputDraft, showEmptyState } = chat;

  // Drops the account's data from state and from the hidden chat view, so the
  // next account to sign in on this tab starts from a blank chat view.
  function endSession() {
    abortActiveRequest();
    localStorage.removeItem('ai_chat_token');
    Object.assign(state, {
      token: null, user: null, chats: [], currentChat: null, messages: [], chatListLoading: false, batchMode: false,
      chatSearchQuery: '', stoppedDraft: null, messageRenderExpanded: false, webSearchEnabled: false,
    });
    state.batchSelected.clear();
    if (dom.chatSearchInput) dom.chatSearchInput.value = '';
    renderChatList();
    showEmptyState();
    closeSidebarOnMobile();
    closeMobileMoreMenu();
    showView('authView');
  }

  function handleAuthExpired() {
    if (!state.token) return;
    endSession();
    toast('登录已过期，请重新登录');
  }

  function afterLogin() {
    // Signing in must not leave this account's credentials in the hidden auth
    // forms, where the next person to use the tab would find them.
    dom.loginForm.reset();
    dom.registerForm.reset();
    showView('chatView');
    dom.userName.textContent = state.user.username;
    dom.userAvatar.textContent = state.user.username[0].toUpperCase();
    syncResponsiveSidebarState();
    loadChats();
    loadModels();
    restoreInputDraft('new');
  }
  
  // The server enforces the registration mode; this only hides what cannot work.
  async function loadRegistrationMode() {
    try {
      const { registration } = await API.get('/auth/config');
      [...dom.tabs].find(tab => tab.dataset.tab === 'register')?.classList.toggle('hidden', registration === 'closed');
      dom.regInviteGroup?.classList.toggle('hidden', registration !== 'invite');
    } catch {}
  }

  function initAuth() {
    loadRegistrationMode();
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
  
      if (password.length < 8) {
        dom.regError.textContent = '密码至少需要 8 位字符';
        dom.regError.classList.remove('hidden');
        return;
      }
  
      try {
        const inviteCode = dom.regInvite?.value.trim() || undefined;
        const data = await API.post('/auth/register', { username, email, password, inviteCode });
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

  function logout() {
    clearInputDrafts();
    endSession();
  }

  return { afterLogin, checkAuth, handleAuthExpired, initAuth, logout };
}

