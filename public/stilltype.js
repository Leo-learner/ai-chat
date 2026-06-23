(function () {
  'use strict';

  const DEFAULT_TEXT = `The final sentence is never loud. It waits at the edge of the room, asking only for your attention.

Type slowly enough to hear the shape of each word, then quickly enough to keep the rhythm alive.

Mistakes are part of the weather. Notice them, correct them, and keep moving.`;

  const LINE_MIN = 56;
  const LINE_MAX = 64;
  const AUTO_ADVANCE_DELAY = 360;
  const ERROR_HOLD_DELAY = 170;
  const LINE_TRANSITION_DURATION = 380;
  const REWIND_MAX_DURATION = 900;

  let root = null;
  let initialized = false;

  const elements = {};
  const state = {
    rawText: '',
    lines: [],
    currentLineIndex: 0,
    currentInputIndex: 0,
    charStates: [],
    mistakeMarkers: [],
    isResettingLine: false,
    isTransitioningLine: false,
    lineAttempts: 0,
    startedAt: 0,
    finishedAt: 0,
    timerId: null,
    advanceTimerId: null,
    toastTimerId: null,
    lineHintTimerId: null,
    resetSequence: 0,
    totalMistakes: 0,
    correctKeypresses: 0,
    totalKeypresses: 0,
    acceptedChars: 0,
    lastText: DEFAULT_TEXT,
    active: false,
  };

  function byId(id) {
    return root?.querySelector(`#${id}`) || null;
  }

  function collectElements() {
    Object.assign(elements, {
      setupScreen: byId('stilltypeSetupScreen'),
      typingScreen: byId('stilltypeTypingScreen'),
      resultScreen: byId('stilltypeResultScreen'),
      sourceText: byId('stilltypeSourceText'),
      startButton: byId('stilltypeStartButton'),
      sampleButton: byId('stilltypeSampleButton'),
      clearButton: byId('stilltypeClearButton'),
      backButton: byId('stilltypeBackButton'),
      restartButton: byId('stilltypeRestartButton'),
      changeTextButton: byId('stilltypeChangeTextButton'),
      keyboardInput: byId('stilltypeKeyboardInput'),
      typingLine: byId('stilltypeTypingLine'),
      typingStage: byId('stilltypeTypingStage'),
      mistakeToast: byId('stilltypeMistakeToast'),
      lineTransitionHint: byId('stilltypeLineTransitionHint'),
      lineProgress: byId('stilltypeLineProgress'),
      accuracyStat: byId('stilltypeAccuracyStat'),
      timeStat: byId('stilltypeTimeStat'),
      speedStat: byId('stilltypeSpeedStat'),
      resultTime: byId('stilltypeResultTime'),
      resultAccuracy: byId('stilltypeResultAccuracy'),
      resultWpm: byId('stilltypeResultWpm'),
      resultErrors: byId('stilltypeResultErrors'),
      resultChars: byId('stilltypeResultChars'),
      resultMistakeList: byId('stilltypeResultMistakeList'),
    });
  }

  function parseText(rawText) {
    return rawText
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => splitLongLine(line));
  }

  function startGame() {
    const rawText = elements.sourceText.value.trim();
    const lines = parseText(rawText || DEFAULT_TEXT);

    if (!lines.length) {
      elements.sourceText.value = DEFAULT_TEXT;
      return;
    }

    clearInterval(state.timerId);
    clearTimeout(state.advanceTimerId);
    clearTimeout(state.toastTimerId);
    clearTimeout(state.lineHintTimerId);

    state.rawText = rawText || DEFAULT_TEXT;
    state.lastText = state.rawText;
    state.lines = lines;
    state.currentLineIndex = 0;
    state.currentInputIndex = 0;
    state.charStates = createCharStates(lines[0]);
    state.mistakeMarkers = createMistakeMarkers(lines);
    state.isResettingLine = false;
    state.isTransitioningLine = false;
    state.lineAttempts = 0;
    state.startedAt = Date.now();
    state.finishedAt = 0;
    state.resetSequence += 1;
    state.totalMistakes = 0;
    state.correctKeypresses = 0;
    state.totalKeypresses = 0;
    state.acceptedChars = 0;
    elements.typingLine.classList.remove('error-shake', 'line-exit', 'line-enter', 'line-active');
    elements.typingStage.classList.remove('has-error');
    elements.mistakeToast.classList.remove('is-visible');
    hideLineHint();

    showScreen('typing');
    renderLine(true);
    updateStats();
    focusKeyboard();
    state.timerId = setInterval(updateStats, 500);
  }

  function renderLine(isEntering = false) {
    const line = getCurrentLine();
    const chars = Array.from(line);
    const fragment = document.createDocumentFragment();

    elements.typingLine.classList.remove('line-exit', 'line-enter');

    chars.forEach((char, index) => {
      const span = document.createElement('span');
      const status = state.charStates[index] || 'pending';

      span.className = `char ${status}`;
      span.dataset.index = String(index);
      span.textContent = char === ' ' ? '\u00a0' : char;

      if (char === ' ') {
        span.classList.add('space');
        span.setAttribute('aria-label', 'space');
      }

      if (index === state.currentInputIndex && state.currentInputIndex < chars.length) {
        span.classList.add('current');
      }

      if (hasMistakeMarker(state.currentLineIndex, index)) {
        span.classList.add('marked-error');
      }

      fragment.appendChild(span);
    });

    elements.typingLine.replaceChildren(fragment);

    if (isEntering) {
      elements.typingLine.classList.remove('line-active');
      elements.typingLine.classList.add('line-enter');
      void elements.typingLine.offsetWidth;
      requestAnimationFrame(() => {
        elements.typingLine.classList.remove('line-enter');
        elements.typingLine.classList.add('line-active');
      });
    } else {
      elements.typingLine.classList.add('line-active');
    }
  }

  function handleInput(char) {
    if (state.isResettingLine || state.isTransitioningLine) return;

    const chars = getCurrentChars();
    if (!chars.length || state.currentInputIndex >= chars.length) return;

    clearTimeout(state.advanceTimerId);

    const index = state.currentInputIndex;
    const isCorrect = char === chars[index];

    state.totalKeypresses += 1;

    if (isCorrect) {
      state.correctKeypresses += 1;
      state.charStates[index] = 'correct';
      state.currentInputIndex += 1;
      playFeedback('correct');
      renderLine();
      updateStats();

      if (state.currentInputIndex === chars.length) {
        state.advanceTimerId = setTimeout(moveToNextLine, AUTO_ADVANCE_DELAY);
      }
    } else {
      state.charStates[index] = 'wrong';
      recordMistakeMarker(state.currentLineIndex, index);
      state.totalMistakes += 1;
      playFeedback('wrong');
      renderLine();
      bumpCharacter(index);
      updateStats();
      triggerLineErrorReset();
    }
  }

  function handleBackspace() {
    if (state.isResettingLine || state.isTransitioningLine || !state.currentInputIndex) return;

    clearTimeout(state.advanceTimerId);

    const removedIndex = state.currentInputIndex - 1;
    state.currentInputIndex -= 1;
    state.charStates[removedIndex] = 'pending';
    renderLine();
    updateStats();
  }

  function moveToNextLine() {
    if (state.isResettingLine || state.isTransitioningLine) return;

    clearTimeout(state.advanceTimerId);

    const lineLength = getCurrentChars().length;
    if (state.currentInputIndex < lineLength) return;

    state.acceptedChars += lineLength;
    state.currentInputIndex = 0;

    if (state.currentLineIndex >= state.lines.length - 1) {
      finishGame();
      return;
    }

    const nextLineNumber = state.currentLineIndex + 2;
    state.isTransitioningLine = true;
    elements.keyboardInput.value = '';
    showLineHint(`line ${nextLineNumber} / ${state.lines.length}`);
    elements.typingLine.classList.remove('line-active', 'line-enter');
    elements.typingLine.classList.add('line-exit');

    setTimeout(() => {
      state.currentLineIndex += 1;
      state.lineAttempts = 0;
      resetCurrentLineState({ isEntering: true });
      state.isTransitioningLine = false;
    }, LINE_TRANSITION_DURATION);
  }

  function updateStats() {
    const elapsedMs = getElapsedMs();
    const accuracy = getAccuracy();
    const minutes = Math.max(elapsedMs / 60000, 1 / 60);
    const productiveChars = getProductiveChars();
    const wpm = Math.round(productiveChars / 5 / minutes);
    const cpm = Math.round(productiveChars / minutes);

    elements.lineProgress.textContent = `第 ${Math.min(state.currentLineIndex + 1, state.lines.length)} / ${state.lines.length} 行`;
    elements.accuracyStat.textContent = `准确率 ${accuracy}%`;
    elements.timeStat.textContent = formatTime(elapsedMs);
    elements.speedStat.textContent = `WPM ${wpm} · CPM ${cpm}`;
  }

  function finishGame() {
    clearInterval(state.timerId);
    clearTimeout(state.advanceTimerId);

    state.finishedAt = Date.now();

    const elapsedMs = getElapsedMs();
    const minutes = Math.max(elapsedMs / 60000, 1 / 60);
    const wpm = Math.round(state.acceptedChars / 5 / minutes);

    elements.resultTime.textContent = formatTime(elapsedMs);
    elements.resultAccuracy.textContent = `${getAccuracy()}%`;
    elements.resultWpm.textContent = String(wpm);
    elements.resultErrors.textContent = String(state.totalMistakes);
    elements.resultChars.textContent = String(state.acceptedChars);
    renderMistakeSummary();

    showScreen('result');
  }

  function resetGame() {
    elements.sourceText.value = state.lastText || DEFAULT_TEXT;
    startGame();
  }

  function splitLongLine(line) {
    if (line.length <= LINE_MAX) return [line];

    const chunks = [];
    let remaining = line;

    while (remaining.length > LINE_MAX) {
      const windowText = remaining.slice(0, LINE_MAX + 1);
      let cut = findPreferredCut(windowText);

      if (cut < LINE_MIN || cut > LINE_MAX) {
        cut = LINE_MAX;
      }

      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }

    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function findPreferredCut(text) {
    const punctuationPattern = /[.!?;:,，。！？；：、]\s?/g;
    let match;
    let cut = -1;

    while ((match = punctuationPattern.exec(text)) !== null) {
      if (match.index + match[0].length >= LINE_MIN) {
        cut = match.index + match[0].length;
      }
    }

    if (cut >= LINE_MIN) return cut;

    const spaceCut = text.lastIndexOf(' ', LINE_MAX);
    if (spaceCut >= LINE_MIN) return spaceCut;

    const earlySpaceCut = text.lastIndexOf(' ');
    if (earlySpaceCut > 0) return earlySpaceCut;

    return Math.min(text.length, LINE_MAX);
  }

  function createCharStates(line) {
    return Array.from({ length: Array.from(line).length }, () => 'pending');
  }

  function createMistakeMarkers(lines) {
    return lines.map(() => []);
  }

  function recordMistakeMarker(lineIndex, charIndex) {
    const markers = state.mistakeMarkers[lineIndex];
    if (!markers || markers.includes(charIndex)) return;
    markers.push(charIndex);
    markers.sort((a, b) => a - b);
  }

  function hasMistakeMarker(lineIndex, charIndex) {
    return Boolean(state.mistakeMarkers[lineIndex]?.includes(charIndex));
  }

  function getCurrentLine() {
    return state.lines[state.currentLineIndex] || '';
  }

  function getCurrentChars() {
    return Array.from(getCurrentLine());
  }

  function getProductiveChars() {
    return state.acceptedChars + state.currentInputIndex;
  }

  function getElapsedMs() {
    if (!state.startedAt) return 0;
    return (state.finishedAt || Date.now()) - state.startedAt;
  }

  function getAccuracy() {
    if (!state.totalKeypresses) return 100;
    return Math.max(0, Math.round((state.correctKeypresses / state.totalKeypresses) * 100));
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function bumpCharacter(index) {
    const node = elements.typingLine.querySelector(`[data-index="${index}"]`);
    if (!node) return;
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  function showScreen(name) {
    elements.setupScreen.classList.toggle('is-active', name === 'setup');
    elements.typingScreen.classList.toggle('is-active', name === 'typing');
    elements.resultScreen.classList.toggle('is-active', name === 'result');
  }

  function renderMistakeSummary() {
    const rows = state.mistakeMarkers
      .map((indexes, lineIndex) => ({ indexes, lineIndex }))
      .filter(({ indexes }) => indexes.length > 0);

    if (!rows.length) {
      elements.resultMistakeList.textContent = '没有错误标记';
      return;
    }

    const fragment = document.createDocumentFragment();

    rows.forEach(({ indexes, lineIndex }) => {
      const item = document.createElement('p');
      const positions = indexes.map((index) => index + 1).join(', ');
      item.textContent = `第 ${lineIndex + 1} 行 · 字符 ${positions}`;
      fragment.appendChild(item);
    });

    elements.resultMistakeList.replaceChildren(fragment);
  }

  function focusKeyboard() {
    if (!state.active || !elements.typingScreen.classList.contains('is-active')) return;
    setTimeout(() => {
      if (!state.active) return;
      elements.keyboardInput.value = '';
      elements.keyboardInput.focus({ preventScroll: true });
    }, 0);
  }

  function requestReturnToSetup() {
    const shouldReturn = window.confirm('确定返回文本输入界面吗？当前进度不会保存。');

    if (shouldReturn) {
      clearInterval(state.timerId);
      clearTimeout(state.advanceTimerId);
      clearTimeout(state.toastTimerId);
      clearTimeout(state.lineHintTimerId);
      state.resetSequence += 1;
      state.isResettingLine = false;
      state.isTransitioningLine = false;
      elements.typingLine.classList.remove('error-shake', 'line-exit', 'line-enter', 'line-active');
      elements.typingStage.classList.remove('has-error');
      elements.mistakeToast.classList.remove('is-visible');
      hideLineHint();
      elements.sourceText.value = state.lastText || state.rawText || DEFAULT_TEXT;
      showScreen('setup');
      elements.sourceText.focus();
    }
  }

  function playFeedback(type) {
    void type;
  }

  function handleKeydown(event) {
    if (!state.active) return;

    const isTypingScreen = elements.typingScreen.classList.contains('is-active');

    if (event.key === 'Tab' && isTypingScreen) {
      event.preventDefault();
      focusKeyboard();
      return;
    }

    if (!isTypingScreen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      requestReturnToSetup();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (state.currentInputIndex === getCurrentChars().length) {
        moveToNextLine();
      }
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      handleBackspace();
      return;
    }

    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      handleInput(event.key);
    }
  }

  function handleCapturedInput() {
    const value = elements.keyboardInput.value;

    if (
      !state.active ||
      !value ||
      state.isResettingLine ||
      state.isTransitioningLine ||
      !elements.typingScreen.classList.contains('is-active')
    ) {
      elements.keyboardInput.value = '';
      return;
    }

    for (const char of Array.from(value)) {
      if (state.isResettingLine) break;
      handleInput(char);
    }

    elements.keyboardInput.value = '';
  }

  async function triggerLineErrorReset() {
    const sequence = state.resetSequence + 1;
    state.resetSequence = sequence;
    state.lineAttempts += 1;

    lockInput();
    hideLineHint();
    showMistakeToast('line reset');
    elements.typingStage.classList.add('has-error');
    elements.typingLine.classList.remove('error-shake');
    void elements.typingLine.offsetWidth;
    elements.typingLine.classList.add('error-shake');

    await wait(ERROR_HOLD_DELAY);
    if (!isActiveReset(sequence)) return;

    await animateLineRewind(sequence);
    if (!isActiveReset(sequence)) return;

    resetCurrentLineState();
    unlockInput();
  }

  async function animateLineRewind(sequence) {
    const wrongIndex = state.currentInputIndex;
    const indexes = [];

    if (state.charStates[wrongIndex] === 'wrong') {
      indexes.push(wrongIndex);
    }

    for (let index = wrongIndex - 1; index >= 0; index -= 1) {
      indexes.push(index);
    }

    const delay = getRewindDelay(indexes.length);

    for (const index of indexes) {
      if (!isActiveReset(sequence)) return;

      state.currentInputIndex = Math.max(0, index);
      state.charStates[index] = 'rewinding';
      renderLine();
      updateStats();
      await wait(delay);
      state.charStates[index] = 'pending';
      renderLine();
    }
  }

  function resetCurrentLineState(options = {}) {
    const { isEntering = false } = options;

    state.currentInputIndex = 0;
    state.charStates = createCharStates(getCurrentLine());
    elements.typingLine.classList.remove('error-shake');
    elements.typingStage.classList.remove('has-error');
    renderLine(isEntering);
    updateStats();
    focusKeyboard();
  }

  function lockInput() {
    state.isResettingLine = true;
    elements.keyboardInput.value = '';
    elements.keyboardInput.setAttribute('aria-disabled', 'true');
  }

  function unlockInput() {
    state.isResettingLine = false;
    elements.keyboardInput.removeAttribute('aria-disabled');
    elements.keyboardInput.value = '';
    focusKeyboard();
  }

  function showMistakeToast(message) {
    clearTimeout(state.toastTimerId);
    elements.mistakeToast.textContent = message;
    elements.mistakeToast.classList.add('is-visible');
    state.toastTimerId = setTimeout(() => {
      elements.mistakeToast.classList.remove('is-visible');
    }, 1000);
  }

  function showLineHint(message, duration = 850) {
    clearTimeout(state.lineHintTimerId);
    elements.lineTransitionHint.textContent = message;
    elements.lineTransitionHint.classList.add('visible');
    state.lineHintTimerId = setTimeout(hideLineHint, duration);
  }

  function hideLineHint() {
    clearTimeout(state.lineHintTimerId);
    elements.lineTransitionHint.classList.remove('visible');
  }

  function getRewindDelay(count) {
    if (!count) return 0;

    const rhythmicDelay = 24;
    if (count * rhythmicDelay <= REWIND_MAX_DURATION) return rhythmicDelay;
    return Math.max(10, Math.floor(REWIND_MAX_DURATION / count));
  }

  function isActiveReset(sequence) {
    return (
      state.active &&
      state.resetSequence === sequence &&
      state.isResettingLine &&
      elements.typingScreen.classList.contains('is-active')
    );
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function bindEvents() {
    elements.startButton.addEventListener('click', startGame);
    elements.sampleButton.addEventListener('click', () => {
      elements.sourceText.value = DEFAULT_TEXT;
      elements.sourceText.focus();
    });
    elements.clearButton.addEventListener('click', () => {
      elements.sourceText.value = '';
      elements.sourceText.focus();
    });
    elements.backButton.addEventListener('click', requestReturnToSetup);
    elements.restartButton.addEventListener('click', resetGame);
    elements.changeTextButton.addEventListener('click', () => {
      state.resetSequence += 1;
      state.isResettingLine = false;
      state.isTransitioningLine = false;
      clearTimeout(state.lineHintTimerId);
      hideLineHint();
      elements.sourceText.value = state.lastText || state.rawText || DEFAULT_TEXT;
      showScreen('setup');
      elements.sourceText.focus();
    });
    elements.keyboardInput.addEventListener('input', handleCapturedInput);
    elements.typingScreen.addEventListener('pointerdown', focusKeyboard);
    document.addEventListener('keydown', handleKeydown);
  }

  function init(rootEl = document.getElementById('tabStilltype')) {
    if (initialized || !rootEl) return false;
    root = rootEl;
    collectElements();
    if (!elements.sourceText || !elements.typingScreen) return false;

    elements.sourceText.value = DEFAULT_TEXT;
    bindEvents();
    showScreen('setup');
    initialized = true;
    return true;
  }

  function activate() {
    if (!initialized) init();
    if (!initialized) return;
    state.active = true;
    root?.classList.add('stilltype-active');
    if (elements.typingScreen.classList.contains('is-active')) {
      focusKeyboard();
    }
  }

  function deactivate() {
    state.active = false;
    root?.classList.remove('stilltype-active');
    elements.keyboardInput?.blur?.();
  }

  window.StilltypePage = {
    init,
    activate,
    deactivate,
    isActive: () => state.active,
  };

  init();
}());
