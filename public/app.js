(function () {
  'use strict';

  const MODEL_KEY = 'ai_chat_cloud_lite_model';
  const API_TIMEOUT_MS = 25000;

  let defaultModel = 'gpt-4o-mini';
  let allowedModels = [];

  const state = {
    settings: null,
    models: [],
    conversations: [],
    currentConversation: null,
    messages: [],
    activeTab: 'chat',
    search: '',
    streaming: false,
    abortController: null,
    activeRequestId: 0,
  };

  const dom = {
    appView: document.getElementById('appView'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    emptyNewChatBtn: document.getElementById('emptyNewChatBtn'),
    historyNewChatBtn: document.getElementById('historyNewChatBtn'),
    refreshAppBtn: document.getElementById('refreshAppBtn'),
    settingsRefreshBtn: document.getElementById('settingsRefreshBtn'),
    conversationSearchInput: document.getElementById('conversationSearchInput'),
    conversationList: document.getElementById('conversationList'),
    historyList: document.getElementById('historyList'),
    pageKicker: document.getElementById('pageKicker'),
    pageTitle: document.getElementById('pageTitle'),
    modelSelect: document.getElementById('modelSelect'),
    settingsModelSelect: document.getElementById('settingsModelSelect'),
    modelStatus: document.getElementById('modelStatus'),
    featureList: document.getElementById('featureList'),
    tabChat: document.getElementById('tabChat'),
    tabHistory: document.getElementById('tabHistory'),
    tabStilltype: document.getElementById('tabStilltype'),
    tabSettings: document.getElementById('tabSettings'),
    emptyState: document.getElementById('emptyState'),
    messages: document.getElementById('messages'),
    composer: document.getElementById('composer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    navButtons: document.querySelectorAll('.nav-btn'),
  };

  function showApp() {
    dom.appView.classList.remove('hidden');
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function createSignal(timeoutMs = API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs);
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
  }

  const API = {
    async request(method, path, body = null, { signal, timeoutMs = API_TIMEOUT_MS } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      const opts = { method, headers };
      if (body !== null) opts.body = JSON.stringify(body);

      const localSignal = signal ? null : createSignal(timeoutMs);
      if (signal) opts.signal = signal;
      else opts.signal = localSignal.signal;

      try {
        const res = await fetch(`/api${path}`, opts);
        const type = res.headers.get('content-type') || '';
        const data = type.includes('application/json') ? await res.json() : { error: await res.text() };
        if (res.status === 401) {
          throw new Error('请求失败，请检查服务状态。');
        }
        if (!res.ok) throw new Error(data.error || '请求失败');
        return data;
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('请求超时，请稍后重试');
        if (err instanceof TypeError) throw new Error('无法连接服务');
        throw err;
      } finally {
        localSignal?.cleanup();
      }
    },
    get(path, options) { return this.request('GET', path, null, options); },
    post(path, body, options) { return this.request('POST', path, body, options); },
    patch(path, body, options) { return this.request('PATCH', path, body, options); },
    del(path, options) { return this.request('DELETE', path, null, options); },
  };

  function escapeHtml(value = '') {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function sanitizeHtml(html = '') {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || '').trim().toLowerCase();
        if (name.startsWith('on') || value.startsWith('javascript:')) node.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function renderMarkdown(text = '') {
    if (!window.marked) return escapeHtml(text);
    try {
      return sanitizeHtml(marked.parse(text));
    } catch {
      return escapeHtml(text);
    }
  }

  function enhanceCode(root) {
    if (!root || !window.hljs) return;
    root.querySelectorAll('pre code').forEach(block => {
      try { hljs.highlightElement(block); } catch {}
    });
  }

  function formatTime(value) {
    if (!value) return '';
    const parsed = Date.parse(String(value).replace(' ', 'T'));
    if (!Number.isFinite(parsed)) return '';
    const diff = Math.max(0, Date.now() - parsed);
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return new Date(parsed).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function normalizeModel(model) {
    const options = allowedModels.length ? allowedModels : [defaultModel];
    return options.includes(model) ? model : options[0];
  }

  function selectedModel() {
    return normalizeModel(dom.modelSelect.value || localStorage.getItem(MODEL_KEY) || defaultModel);
  }

  function setSelectedModel(model) {
    const next = normalizeModel(model);
    dom.modelSelect.value = next;
    dom.settingsModelSelect.value = next;
    localStorage.setItem(MODEL_KEY, next);
  }

  function renderModelSelects() {
    const models = state.models.length ? state.models : [{ id: defaultModel, providerName: 'Configured model' }];
    allowedModels = models.map(model => model.id).filter(Boolean);
    const current = normalizeModel(localStorage.getItem(MODEL_KEY) || state.currentConversation?.model || defaultModel);
    const options = models.map(model => {
      const label = model.providerName ? `${model.id} · ${model.providerName}` : model.id;
      return `<option value="${escapeHtml(model.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    dom.modelSelect.innerHTML = options;
    dom.settingsModelSelect.innerHTML = options;
    dom.modelSelect.disabled = models.length <= 1;
    dom.settingsModelSelect.disabled = models.length <= 1;
    setSelectedModel(current);
    dom.modelStatus.textContent = models.length
      ? `已加载 ${models.length} 个模型，默认 ${defaultModel}`
      : '未读取到模型，请检查服务环境变量';
  }

  function filteredConversations() {
    const query = state.search.trim().toLowerCase();
    if (!query) return state.conversations;
    return state.conversations.filter(item => `${item.title || ''} ${item.model || ''}`.toLowerCase().includes(query));
  }

  function conversationButton(conversation) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `conversation-item${state.currentConversation?.id === conversation.id ? ' active' : ''}`;
    button.dataset.id = conversation.id;
    button.innerHTML = `
      <span class="conversation-title">${escapeHtml(conversation.title || '未命名会话')}</span>
      <span class="conversation-meta">${escapeHtml(formatTime(conversation.updated_at || conversation.created_at) || conversation.model || '')}</span>
    `;
    button.addEventListener('click', () => {
      openConversation(conversation);
      closeSidebar();
      setActiveTab('chat');
    });
    return button;
  }

  function renderConversations() {
    const visible = filteredConversations();
    dom.conversationList.innerHTML = '';
    dom.historyList.innerHTML = '';

    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-list';
      empty.textContent = state.search ? '没有匹配的会话' : '暂无会话';
      dom.conversationList.appendChild(empty.cloneNode(true));
      dom.historyList.appendChild(empty);
      return;
    }

    visible.forEach(conversation => {
      dom.conversationList.appendChild(conversationButton(conversation));

      const row = document.createElement('article');
      row.className = 'history-row';
      row.innerHTML = `
        <button class="history-main" type="button">
          <strong>${escapeHtml(conversation.title || '未命名会话')}</strong>
          <span>${escapeHtml(conversation.model || '')} · ${escapeHtml(formatTime(conversation.updated_at || conversation.created_at))}</span>
        </button>
        <button class="danger-text-btn" type="button">删除</button>
      `;
      row.querySelector('.history-main').addEventListener('click', () => {
        openConversation(conversation);
        setActiveTab('chat');
      });
      row.querySelector('.danger-text-btn').addEventListener('click', async () => {
        if (!confirm(`删除“${conversation.title || '未命名会话'}”？`)) return;
        await deleteConversation(conversation.id);
      });
      dom.historyList.appendChild(row);
    });
  }

  function updateHeader() {
    const names = {
      chat: ['chat', state.currentConversation?.title || '新对话'],
      history: ['history', '历史会话'],
      stilltype: ['typing', '打字练习'],
      settings: ['settings', '设置'],
    };
    const [kicker, title] = names[state.activeTab] || names.chat;
    dom.pageKicker.textContent = kicker;
    dom.pageTitle.textContent = title;
  }

  function setActiveTab(tab) {
    state.activeTab = ['chat', 'history', 'stilltype', 'settings'].includes(tab) ? tab : 'chat';
    dom.tabChat.classList.toggle('hidden', state.activeTab !== 'chat');
    dom.tabHistory.classList.toggle('hidden', state.activeTab !== 'history');
    dom.tabStilltype.classList.toggle('hidden', state.activeTab !== 'stilltype');
    dom.tabSettings.classList.toggle('hidden', state.activeTab !== 'settings');
    dom.composer.classList.toggle('hidden', state.activeTab !== 'chat');
    dom.navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.activeTab));
    if (state.activeTab === 'stilltype') window.StilltypePage?.activate?.();
    else window.StilltypePage?.deactivate?.();
    updateHeader();
  }

  function setEmptyState(show) {
    dom.emptyState.classList.toggle('hidden', !show);
    dom.messages.classList.toggle('hidden', show);
  }

  function messageElement(message, { streaming = false } = {}) {
    const wrap = document.createElement('article');
    wrap.className = `message ${message.role === 'user' ? 'from-user' : 'from-ai'}${streaming ? ' streaming' : ''}`;
    wrap.dataset.id = message.id || '';
    wrap.innerHTML = `
      <div class="avatar">${message.role === 'user' ? '我' : 'AI'}</div>
      <div class="bubble">
        <div class="message-content">${renderMarkdown(message.content || '')}</div>
        <div class="message-actions">
          <button type="button" data-copy>复制</button>
          ${message.role === 'assistant' ? '<button type="button" data-regenerate>重答</button>' : '<button type="button" data-retry>重发</button>'}
        </div>
      </div>
    `;
    enhanceCode(wrap);
    return wrap;
  }

  function renderMessages() {
    dom.messages.innerHTML = '';
    if (!state.messages.length) {
      setEmptyState(true);
      return;
    }
    setEmptyState(false);
    state.messages.forEach(message => dom.messages.appendChild(messageElement(message)));
    scrollMessagesToBottom();
  }

  function scrollMessagesToBottom() {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }

  function resizeComposer() {
    const input = dom.messageInput;
    input.style.height = 'auto';
    const max = window.matchMedia('(max-width: 720px)').matches ? 150 : 220;
    input.style.height = `${Math.min(input.scrollHeight, max)}px`;
  }

  function updateSendState() {
    const hasText = dom.messageInput.value.trim().length > 0;
    dom.sendBtn.disabled = !hasText || state.streaming;
    dom.sendBtn.classList.toggle('hidden', state.streaming);
    dom.stopBtn.classList.toggle('hidden', !state.streaming);
  }

  async function loadSettings() {
    state.settings = await API.get('/settings');
    defaultModel = state.settings.defaultModel || defaultModel;
    renderFeatureList();
  }

  async function loadModels() {
    const data = await API.get('/models');
    defaultModel = data.defaultModel || defaultModel;
    state.models = data.models || [];
    renderModelSelects();
  }

  async function loadConversations() {
    const data = await API.get('/conversations');
    state.conversations = data.conversations || [];
    renderConversations();
    if (state.currentConversation) {
      const fresh = state.conversations.find(item => item.id === state.currentConversation.id);
      if (fresh) state.currentConversation = fresh;
    }
    updateHeader();
  }

  async function loadMessages() {
    if (!state.currentConversation) return;
    const data = await API.get(`/conversations/${state.currentConversation.id}/messages`);
    state.messages = data.messages || [];
    renderMessages();
  }

  async function createConversation() {
    const data = await API.post('/conversations', { model: selectedModel() });
    state.currentConversation = data.conversation;
    state.messages = [];
    setSelectedModel(state.currentConversation.model);
    setActiveTab('chat');
    setEmptyState(true);
    await loadConversations();
    dom.messageInput.focus();
  }

  async function openConversation(conversation) {
    abortStream();
    state.currentConversation = conversation;
    setSelectedModel(conversation.model);
    await loadMessages();
    renderConversations();
    updateHeader();
  }

  async function deleteConversation(id) {
    await API.del(`/conversations/${id}`);
    if (state.currentConversation?.id === id) {
      state.currentConversation = null;
      state.messages = [];
      setEmptyState(true);
    }
    await loadConversations();
  }

  function parseStreamEvent(rawEvent) {
    const lines = rawEvent.split(/\r?\n/);
    const events = [];
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        events.push(JSON.parse(data));
      } catch {}
    }
    return events;
  }

  function updateStreamingNode(node, content) {
    const target = node.querySelector('.message-content');
    target.innerHTML = renderMarkdown(content || '');
    enhanceCode(target);
    scrollMessagesToBottom();
  }

  async function ensureConversation() {
    if (state.currentConversation) return true;
    await createConversation();
    return Boolean(state.currentConversation);
  }

  async function sendMessage(content = dom.messageInput.value.trim(), options = {}) {
    if (state.streaming || !content.trim()) return;
    const ok = await ensureConversation();
    if (!ok) return;

    const requestId = ++state.activeRequestId;
    const userMessage = options.regenerate ? null : {
      id: `local-user-${requestId}`,
      chat_id: state.currentConversation.id,
      role: 'user',
      content,
    };
    if (userMessage) state.messages.push(userMessage);

    const assistantMessage = {
      id: `local-ai-${requestId}`,
      chat_id: state.currentConversation.id,
      role: 'assistant',
      content: '',
    };
    state.messages.push(assistantMessage);
    renderMessages();

    dom.messageInput.value = '';
    resizeComposer();
    state.streaming = true;
    state.abortController = new AbortController();
    updateSendState();

    const body = options.regenerate
      ? {
          model: selectedModel(),
          regenerateFromMessageId: options.sourceUserMessageId,
          replaceMessageId: options.assistantMessageId,
        }
      : { content, model: selectedModel() };

    let fullContent = '';
    try {
      const res = await fetch(`/api/conversations/${state.currentConversation.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: state.abortController.signal,
      });
      if (res.status === 401) {
        throw new Error('请求失败，请检查服务状态。');
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '发送失败');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const rawEvents = buffer.split(/\n\n+/);
        buffer = rawEvents.pop() || '';
        for (const raw of rawEvents) {
          for (const event of parseStreamEvent(raw)) {
            if (event.type === 'content') {
              fullContent += event.content || '';
              assistantMessage.content = fullContent;
              const node = dom.messages.querySelector(`[data-id="${assistantMessage.id}"]`);
              if (node) updateStreamingNode(node, fullContent);
            } else if (event.type === 'done') {
              if (event.userMessageId && userMessage) userMessage.id = event.userMessageId;
              if (event.messageId) assistantMessage.id = event.messageId;
            } else if (event.type === 'error') {
              throw new Error(event.error || '生成失败');
            }
          }
        }
      }
      if (buffer.trim()) {
        for (const event of parseStreamEvent(buffer)) {
          if (event.type === 'content') fullContent += event.content || '';
        }
      }
      assistantMessage.content = fullContent;
      await loadMessages();
      await loadConversations();
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMessage.content = fullContent || '已停止。';
      } else {
        assistantMessage.content = `出错：${err.message || '生成失败'}`;
        toast(err.message || '发送失败');
      }
      renderMessages();
    } finally {
      state.streaming = false;
      state.abortController = null;
      updateSendState();
      dom.messageInput.focus();
    }
  }

  function abortStream() {
    if (state.abortController && state.streaming) state.abortController.abort();
  }

  function previousUserMessageId(assistantId) {
    const index = state.messages.findIndex(item => String(item.id) === String(assistantId));
    for (let i = index - 1; i >= 0; i -= 1) {
      if (state.messages[i]?.role === 'user') return state.messages[i].id;
    }
    return null;
  }

  async function handleMessageAction(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const messageNode = button.closest('.message');
    const messageId = messageNode?.dataset.id;
    const message = state.messages.find(item => String(item.id) === String(messageId));
    if (!message) return;

    if (button.hasAttribute('data-copy')) {
      await navigator.clipboard.writeText(message.content || '');
      toast('已复制');
    } else if (button.hasAttribute('data-retry')) {
      await sendMessage(message.content || '');
    } else if (button.hasAttribute('data-regenerate')) {
      const sourceUserMessageId = previousUserMessageId(messageId);
      if (!sourceUserMessageId) return toast('无法重答这条消息');
      await sendMessage('regenerate', {
        regenerate: true,
        sourceUserMessageId,
        assistantMessageId: messageId,
      });
    }
  }

  function renderFeatureList() {
    const features = state.settings?.features || {};
    const rows = [
      ['聊天', features.chat],
      ['历史会话', features.conversations],
      ['打字练习', features.typingPractice],
      ['长期记忆', features.memory],
      ['终端执行', features.terminal],
      ['电脑控制', features.control],
      ['MCP 本地权限', features.mcp],
      ['文件访问', features.fileAccess],
    ];
    dom.featureList.innerHTML = rows.map(([name, enabled]) => (
      `<li><span>${escapeHtml(name)}</span><strong class="${enabled ? 'on' : 'off'}">${enabled ? '启用' : '禁用'}</strong></li>`
    )).join('');
  }

  function openSidebar() {
    dom.sidebar.classList.add('open');
    dom.sidebarBackdrop.classList.remove('hidden');
    requestAnimationFrame(() => dom.sidebarBackdrop.classList.add('open'));
  }

  function closeSidebar() {
    dom.sidebar.classList.remove('open');
    dom.sidebarBackdrop.classList.remove('open');
    setTimeout(() => {
      if (!dom.sidebarBackdrop.classList.contains('open')) dom.sidebarBackdrop.classList.add('hidden');
    }, 160);
  }

  function refreshApp() {
    abortStream();
    window.location.reload();
  }

  async function bootstrap() {
    try {
      await loadSettings();
      await loadModels();
      await loadConversations();
      showApp();
      setActiveTab('chat');
      setEmptyState(true);
    } catch (err) {
      showApp();
      toast(err.message || '请求失败，请检查服务状态。');
    }
  }

  function bindEvents() {
    dom.newChatBtn.addEventListener('click', createConversation);
    dom.emptyNewChatBtn.addEventListener('click', createConversation);
    dom.historyNewChatBtn.addEventListener('click', createConversation);
    dom.refreshAppBtn.addEventListener('click', refreshApp);
    dom.settingsRefreshBtn.addEventListener('click', refreshApp);
    dom.sidebarToggleBtn.addEventListener('click', openSidebar);
    dom.sidebarBackdrop.addEventListener('click', closeSidebar);
    dom.conversationSearchInput.addEventListener('input', () => {
      state.search = dom.conversationSearchInput.value || '';
      renderConversations();
    });

    dom.navButtons.forEach(button => {
      button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    });

    dom.modelSelect.addEventListener('change', async () => {
      setSelectedModel(dom.modelSelect.value);
      if (!state.currentConversation) return;
      try {
        const data = await API.patch(`/conversations/${state.currentConversation.id}`, { model: selectedModel() });
        state.currentConversation = data.conversation;
        await loadConversations();
      } catch {
        toast('模型更新失败');
      }
    });
    dom.settingsModelSelect.addEventListener('change', () => {
      setSelectedModel(dom.settingsModelSelect.value);
      dom.modelSelect.dispatchEvent(new Event('change'));
    });

    dom.messageInput.addEventListener('input', () => {
      resizeComposer();
      updateSendState();
    });
    dom.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    dom.sendBtn.addEventListener('click', () => sendMessage());
    dom.stopBtn.addEventListener('click', abortStream);
    dom.messages.addEventListener('click', handleMessageAction);
    window.addEventListener('resize', resizeComposer, { passive: true });
  }

  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  bindEvents();
  updateSendState();
  bootstrap();
}());
