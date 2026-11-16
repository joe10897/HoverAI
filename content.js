(function() {
  'use strict';

  if (window.innerWidth < 300 || window.innerHeight < 200) return;

  const MC_OPTION_REGEX = /([A-Da-d][\.\、\)\s]|[\(（][A-Da-d][\)）])/;
  const SOLVE_CARD_REGEX = /(?:^|\s)(?:que|question-card|question-item|quiz-item|problem-statement|problem-content|problem-description)(?:\s|$)/i;
  const SKIP_PARENT_TAGS = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);
  const SOLVE_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Microsoft JhengHei", monospace';

  let lastMousePos = { x: 0, y: 0 };
  let currentOpacity = '0.28';
  let currentFontSize = '9';
  let currentDefaultMode = 'mc';
  let isErrorState = false;
  let activeRequestId = 0;
  let lastAnswerText = '';
  let copyResetTimer = null;

  chrome.storage.local.get(['opacity', 'fontSize', 'mode'], (res) => {
    if (res.opacity) currentOpacity = res.opacity;
    if (res.fontSize) currentFontSize = res.fontSize;
    if (res.mode === 'solve' || res.mode === 'mc') currentDefaultMode = res.mode;
  });

  chrome.storage.onChanged.addListener((changes) => {
    const box = document.getElementById('gemini-stealth-box');
    if (changes.opacity) {
      currentOpacity = changes.opacity.newValue;
      if (box && !isErrorState) {
        box.style.color = `rgba(128, 128, 128, ${currentOpacity})`;
      }
    }
    if (changes.fontSize) {
      currentFontSize = changes.fontSize.newValue;
      if (box) box.style.fontSize = `${currentFontSize}px`;
    }
    if (changes.mode) {
      currentDefaultMode = changes.mode.newValue === 'solve' ? 'solve' : 'mc';
    }
  });

  document.addEventListener('mousemove', (e) => {
    lastMousePos = { x: e.clientX, y: e.clientY };
  }, { passive: true, capture: true });

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // 降級改用暫存 textarea 複製
      }
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) return false;

    mountTarget.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  function createBox() {
    let box = document.getElementById('gemini-stealth-box');
    if (box && box._contentEl) return box;
    if (box) box.remove();

    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) return null;

    box = document.createElement('div');
    box.id = 'gemini-stealth-box';
    box.style.cssText = `
      position: fixed;
      bottom: 6px;
      right: 8px;
      max-width: 240px;
      max-height: 80px;
      overflow: hidden;
      background: transparent;
      color: rgba(128, 128, 128, ${currentOpacity});
      border: none;
      margin: 0;
      padding: 2px 4px;
      box-sizing: border-box;
      font-family: sans-serif;
      font-size: ${currentFontSize}px;
      font-weight: normal;
      line-height: 1.2;
      letter-spacing: normal;
      text-align: left;
      z-index: 2147483647;
      display: none;
      pointer-events: none;
      user-select: none;
    `;

    const headerEl = document.createElement('div');
    headerEl.id = 'gemini-stealth-header';
    headerEl.style.cssText = `
      display: none;
      justify-content: flex-end;
      align-items: center;
      margin: 0 0 2px 0;
      padding: 0;
      flex: 0 0 auto;
      user-select: none;
    `;

    const copyBtn = document.createElement('span');
    copyBtn.id = 'gemini-stealth-copy';
    copyBtn.textContent = '複製';
    copyBtn.style.cssText = `
      cursor: pointer;
      padding: 1px 4px;
      margin: 0;
      border: 1px solid currentColor;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font-family: sans-serif;
      font-size: inherit;
      line-height: 1.1;
      user-select: none;
    `;

    copyBtn.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
    });

    copyBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!lastAnswerText) return;
      const ok = await copyToClipboard(lastAnswerText);
      if (ok) {
        copyBtn.textContent = '已複製';
        if (copyResetTimer) clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
          copyBtn.textContent = '複製';
        }, 1500);
      }
    });

    const contentEl = document.createElement('div');
    contentEl.id = 'gemini-stealth-content';
    contentEl.style.cssText = `
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: visible;
      scrollbar-width: thin;
      scrollbar-color: rgba(128, 128, 128, 0.28) transparent;
    `;

    headerEl.appendChild(copyBtn);
    box.appendChild(headerEl);
    box.appendChild(contentEl);
    mountTarget.appendChild(box);

    box._headerEl = headerEl;
    box._copyBtn = copyBtn;
    box._contentEl = contentEl;
    return box;
  }

  function isBoxVisible(box) {
    return Boolean(box && box.style.display && box.style.display !== 'none');
  }

  function applyBoxLayout(box, mode, interactive) {
    if (mode === 'solve' && interactive) {
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.maxWidth = 'min(460px, calc(100vw - 20px))';
      box.style.maxHeight = 'min(280px, calc(100vh - 24px))';
      box.style.overflow = 'hidden';
      box.style.pointerEvents = 'auto';
      box.style.userSelect = 'text';
      box.style.fontFamily = SOLVE_FONT_FAMILY;
      box.style.lineHeight = '1.35';
      box._headerEl.style.display = 'flex';
      box._contentEl.style.overflowY = 'auto';
      box._contentEl.style.overflowX = 'auto';
      box._contentEl.style.flex = '1 1 auto';
      box._contentEl.style.minHeight = '0';
      return;
    }

    box.style.display = 'block';
    box.style.flexDirection = '';
    box.style.maxWidth = '240px';
    box.style.maxHeight = '80px';
    box.style.overflow = 'hidden';
    box.style.pointerEvents = 'none';
    box.style.userSelect = 'none';
    box.style.fontFamily = 'sans-serif';
    box.style.lineHeight = '1.2';
    box._headerEl.style.display = 'none';
    box._contentEl.style.overflowY = 'visible';
    box._contentEl.style.overflowX = 'visible';
    box._contentEl.style.flex = '';
    box._contentEl.style.minHeight = '';
  }

  function hideBox(box) {
    activeRequestId++;
    isErrorState = false;
    lastAnswerText = '';
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
    if (box) {
      box.style.display = 'none';
      box._headerEl.style.display = 'none';
      box._copyBtn.textContent = '複製';
    }
  }

  function showStealthText(box, mode, text, interactive, answerForCopy) {
    isErrorState = false;
    lastAnswerText = answerForCopy || '';
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }
    applyBoxLayout(box, mode, interactive);
    box.style.color = `rgba(128, 128, 128, ${currentOpacity})`;
    box.style.background = 'transparent';
    box._copyBtn.textContent = '複製';
    box._contentEl.textContent = text;
    if (interactive) {
      box._contentEl.scrollTop = 0;
    }
  }

  function showErrorText(box, errorText) {
    isErrorState = true;
    lastAnswerText = '';
    applyBoxLayout(box, 'mc', false);
    box.style.color = '#d93025';
    box.style.background = 'rgba(255,255,255,0.9)';
    box._contentEl.textContent = errorText;
  }

  function getSelectedText(mode) {
    const manualSel = window.getSelection().toString().trim();
    if (manualSel) {
      window.getSelection().removeAllRanges();
      return mode === 'solve' && manualSel.length > 8000
        ? manualSel.slice(0, 8000)
        : manualSel;
    }

    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'TEXTAREA' ||
        (activeEl.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((activeEl.type || 'text').toLowerCase())))
    ) {
      const start = activeEl.selectionStart;
      const end = activeEl.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        const selected = activeEl.value.slice(start, end).trim();
        if (selected) {
          return mode === 'solve' && selected.length > 8000
            ? selected.slice(0, 8000)
            : selected;
        }
      }
    }

    return '';
  }

  function getNodeText(node) {
    if (!node) return '';
    if (node.tagName === 'TEXTAREA') {
      return (node.value || '').trim();
    }
    if (node.tagName === 'INPUT') {
      const type = (node.type || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type) ? (node.value || '').trim() : '';
    }
    return (node.innerText || '').trim();
  }

  function getHoveredElement() {
    const stack = document.elementsFromPoint(lastMousePos.x, lastMousePos.y);
    for (const el of stack) {
      if (el.id === 'gemini-stealth-box' || el.closest('#gemini-stealth-box')) {
        continue;
      }
      return el;
    }
    return null;
  }

  function isSolveContainerBoundary(node, text) {
    if (text.length < 40) return false;
    if (node.tagName === 'ARTICLE') return true;
    if (node.getAttribute && node.getAttribute('role') === 'listitem') return true;
    const idAndClass = `${node.id || ''} ${typeof node.className === 'string' ? node.className : ''}`;
    return text.length >= 60 && SOLVE_CARD_REGEX.test(idAndClass);
  }

  function getHoveredQuestionText(mode) {
    const selected = getSelectedText(mode);
    if (selected) return selected;

    const el = getHoveredElement();
    if (!el || el === document.body || el === document.documentElement) {
      return '';
    }

    const maxLen = mode === 'solve' ? 4500 : 1200;
    if (mode === 'solve' && el.tagName === 'TEXTAREA') {
      const taText = getNodeText(el);
      if (taText.length >= 15) {
        return taText.slice(0, maxLen);
      }
    }

    const elInEditor = Boolean(el.closest && el.closest('.monaco-editor, .CodeMirror'));
    let bestText = '';
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current !== el && SKIP_PARENT_TAGS.has(current.tagName)) {
        break;
      }
      if (
        mode === 'solve' &&
        bestText.length >= 60 &&
        !elInEditor &&
        current.querySelector &&
        current.querySelector('.monaco-editor, .CodeMirror')
      ) {
        break;
      }

      const text = getNodeText(current);
      if (text.length >= 15 && text.length <= maxLen) {
        bestText = text;
        if (mode === 'mc') {
          if (MC_OPTION_REGEX.test(text) && text.includes('\n')) {
            break;
          }
        } else if (isSolveContainerBoundary(current, text)) {
          break;
        }
      } else if (text.length > maxLen) {
        break;
      }
      current = current.parentElement;
    }

    if (bestText) return bestText;
    const leafText = getNodeText(el);
    return leafText.length <= maxLen ? leafText : '';
  }

  window.addEventListener('keydown', async function(e) {
    const box = createBox();
    if (!box) return;

    if (e.key === 'Escape' && isBoxVisible(box)) {
      hideBox(box);
      return;
    }

    const isXKey = (e.key && e.key.toLowerCase() === 'x') || e.code === 'KeyX';
    const isMcTrigger = e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && isXKey;
    const isSolveTrigger = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && isXKey;

    if (!isMcTrigger && !isSolveTrigger) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    const triggerMode = isSolveTrigger ? 'solve' : currentDefaultMode;
    const questionText = getHoveredQuestionText(triggerMode);
    if (!questionText) {
      if (isBoxVisible(box)) hideBox(box);
      return;
    }

    const myRequestId = ++activeRequestId;
    const { licenseKey, deviceId, isActivated } = await chrome.storage.local.get([
      'licenseKey', 'deviceId', 'isActivated'
    ]);

    if (myRequestId !== activeRequestId) return;

    if (!licenseKey || !deviceId || !isActivated) {
      showStealthText(box, 'mc', '未啟用', false, '');
      return;
    }

    showStealthText(box, triggerMode, '.', false, '');

    // 透過 background.js 發送請求，避免網頁 CSP 阻擋
    chrome.runtime.sendMessage(
      {
        type: 'ASK_AI',
        licenseKey: licenseKey,
        deviceId: deviceId,
        question: questionText,
        mode: triggerMode
      },
      (response) => {
        if (myRequestId !== activeRequestId) return;

        if (chrome.runtime.lastError) {
          showErrorText(box, `擴充錯誤: ${chrome.runtime.lastError.message}`);
          return;
        }

        if (response && response.success) {
          showStealthText(box, triggerMode, response.answer, triggerMode === 'solve', response.answer);
        } else {
          // 發生錯誤時暫時顯示紅字白底以便除錯
          showErrorText(box, response?.error || '未知錯誤');
        }
      }
    );
  }, true);
})();