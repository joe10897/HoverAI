// Copyright (c) 2026 Simon C.-Y. Wong. All rights reserved.
// 【請替換為你的 Cloudflare Worker 網址】
const API_URL = 'https://ai-reader-api.842679135jjj.workers.dev';

document.addEventListener('DOMContentLoaded', async () => {
  const licenseInput = document.getElementById('licenseKey');
  const verifyBtn = document.getElementById('verifyBtn');
  const statusDiv = document.getElementById('status');
  const authBadge = document.getElementById('authBadge');
  const opacitySlider = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacityVal');
  const fontSizeSlider = document.getElementById('fontSize');
  const fontSizeVal = document.getElementById('fontSizeVal');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const modeDesc = document.getElementById('modeDesc');

  const MODE_DESCRIPTIONS = {
    mc: '選擇題 / 是非題 / 填充題（極簡小框）',
    solve: '文字題 / 程式題（可捲動與複製解答）'
  };

  function renderModeUI(activeMode) {
    const normalized = activeMode === 'solve' ? 'solve' : 'mc';
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === normalized);
    });
    modeDesc.textContent = MODE_DESCRIPTIONS[normalized];
  }

  // 讀取或首次產生該瀏覽器專屬的裝置識別碼 (Device ID)
  let { deviceId, licenseKey, isActivated, opacity, fontSize, mode } = await chrome.storage.local.get([
    'deviceId', 'licenseKey', 'isActivated', 'opacity', 'fontSize', 'mode'
  ]);

  if (!deviceId) {
    deviceId = 'DEV-' + crypto.randomUUID();
    await chrome.storage.local.set({ deviceId });
  }

  // 初始化介面數值
  renderModeUI(mode);
  if (licenseKey) licenseInput.value = licenseKey;
  if (isActivated) {
    authBadge.textContent = '已啟用';
    authBadge.classList.add('active');
  }
  if (opacity) {
    opacitySlider.value = opacity;
    opacityVal.textContent = opacity;
  }
  if (fontSize) {
    fontSizeSlider.value = fontSize;
    fontSizeVal.textContent = fontSize + 'px';
  }

  // 切換 Ctrl + X 預設模式
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextMode = btn.dataset.mode === 'solve' ? 'solve' : 'mc';
      renderModeUI(nextMode);
      chrome.storage.local.set({ mode: nextMode });
    });
  });

  // 即時儲存透明度調整
  opacitySlider.addEventListener('input', () => {
    const val = opacitySlider.value;
    opacityVal.textContent = val;
    chrome.storage.local.set({ opacity: val });
  });

  // 即時儲存字體大小調整
  fontSizeSlider.addEventListener('input', () => {
    const val = fontSizeSlider.value;
    fontSizeVal.textContent = val + 'px';
    chrome.storage.local.set({ fontSize: val });
  });

  // 驗證並綁定序號按鈕
  verifyBtn.addEventListener('click', async () => {
    const key = licenseInput.value.trim();
    if (!key) {
      statusDiv.style.color = '#d93025';
      statusDiv.textContent = '請輸入授權序號';
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = '驗證連線中...';
    statusDiv.textContent = '';

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          licenseKey: key,
          deviceId: deviceId
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        await chrome.storage.local.set({
          licenseKey: key,
          isActivated: true
        });
        authBadge.textContent = '已啟用';
        authBadge.classList.add('active');
        statusDiv.style.color = '#137333';
        const expDate = data.expiresAt ? data.expiresAt.split('T')[0] : '永久';
        statusDiv.textContent = `綁定成功！有效期限至：${expDate}`;
      } else {
        await chrome.storage.local.set({ isActivated: false });
        authBadge.textContent = '未啟用';
        authBadge.classList.remove('active');
        statusDiv.style.color = '#d93025';
        statusDiv.textContent = data.error || '驗證失敗';
      }
    } catch (err) {
      statusDiv.style.color = '#d93025';
      statusDiv.textContent = '無法連線至驗證伺服器';
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = '啟用並綁定此電腦';
    }
  });
});