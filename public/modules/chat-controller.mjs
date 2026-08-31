import { consumeChatStream } from './chat-stream.mjs';
import {
  createMessageElement,
  enhanceMessageContent,
  escapeAttr,
  escapeHtml,
  normalizeContextStatus,
  normalizeSearchResults,
  renderMarkdown,
  updateMessageExtras,
} from './message-renderer.mjs';
import { createSidebarController } from './sidebar.mjs';

export function createChatController({ state, dom, API, allowedChatModels, defaultChatModel, normalizeChatModel, chatDraftStoragePrefix, messageRenderLimit, ui }) {
  const ALLOWED_CHAT_MODELS = allowedChatModels;
  const DEFAULT_CHAT_MODEL = defaultChatModel;
  const CHAT_DRAFT_STORAGE_PREFIX = chatDraftStoragePrefix;
  const MESSAGE_RENDER_LIMIT = messageRenderLimit;
  const { appConfirm, appPrompt, closeSidebarOnMobile, toast } = ui;

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
  
      await consumeChatStream(res, {
        signal: controller.signal,
        isCurrent: () => state.activeRequestId === requestId,
        onEvent(parsed) {
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
          }
        },
      });
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

  return { abortActiveRequest, batchDeleteSelected, copyMessageContent, enterBatchMode, exitBatchMode, loadChats, loadMessages, loadModels, newChat, openChat, renderChatList, renameChat, resizeComposer, restoreInputDraft, runMessageAction, saveInputDraft, scrollToBottom, sendMessage, setWebSearchEnabled, showEmptyState, syncScrollToBottomButton, updateSendButton };
}
