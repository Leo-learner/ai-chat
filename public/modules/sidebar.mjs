export function createSidebarController({
  state,
  dom,
  API,
  allowedChatModels,
  defaultChatModel,
  normalizeChatModel,
  escapeHtml,
  escapeAttr,
  toast,
  appConfirm,
  appPrompt,
  openChat,
  closeSidebarOnMobile,
}) {
  const ALLOWED_CHAT_MODELS = allowedChatModels;
  const DEFAULT_CHAT_MODEL = defaultChatModel;

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
  return normalizeChatModel(chat.model || DEFAULT_CHAT_MODEL || state.defaultModel || '');
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
    item.tabIndex = 0;
    item.setAttribute('role', 'group');
    item.setAttribute('aria-label', chat.title || '未命名会话');
    item.addEventListener('keydown', (e) => {
      if (e.target !== item || !['Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      if (state.batchMode) toggleBatchSelect(chat.id);
      else { openChat(chat); closeSidebarOnMobile(); }
    });

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
  const title = state.currentChat?.title || '新对话';
  if (h1) h1.textContent = title;
  if (dom.chatTitleInput) dom.chatTitleInput.value = state.currentChat?.title || '';
}

function showEmptyState() {
  updateChatHeaderTitle();
  dom.emptyState.classList.remove('hidden');
  dom.messagesContainer.classList.add('hidden');
  dom.messagesContainer.innerHTML = '';
}

  return {
    batchDeleteSelected,
    enterBatchMode,
    exitBatchMode,
    loadChats,
    renderChatList,
    renameChat,
    showEmptyState,
    updateChatHeaderTitle,
  };
}
