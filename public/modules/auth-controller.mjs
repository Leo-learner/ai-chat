export function createAuthController({ state, dom, API, ui, chat }) {
  const { closeMobileMoreMenu, closeSidebarOnMobile, showView, syncResponsiveSidebarState, toast } = ui;
  const { abortActiveRequest, loadChats, loadModels, restoreInputDraft } = chat;

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

  function logout() {
    localStorage.removeItem('ai_chat_token');
    abortActiveRequest();
    Object.assign(state, { token: null, user: null, chats: [], currentChat: null, messages: [], batchMode: false });
    state.batchSelected.clear();
    closeSidebarOnMobile();
    closeMobileMoreMenu();
    showView('authView');
  }

  return { afterLogin, checkAuth, handleAuthExpired, initAuth, logout };
}

