// 【請替換為你的 Cloudflare Worker 網址】
const API_URL = 'https://ai-reader-api.842679135jjj.workers.dev';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ASK_AI') {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licenseKey: request.licenseKey,
        deviceId: request.deviceId,
        question: request.question,
        mode: request.mode === 'solve' ? 'solve' : 'mc'
      })
    })
      .then(async (res) => {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (res.ok && data.answer) {
            sendResponse({ success: true, answer: data.answer });
          } else {
            sendResponse({
              success: false,
              error: `[HTTP ${res.status}] ${data.error || text}`
            });
          }
        } catch (e) {
          sendResponse({
            success: false,
            error: `[解析失敗 ${res.status}] ${text.slice(0, 60)}`
          });
        }
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: `[網路錯誤] ${err.message}`
        });
      });

    return true; // 保持非同步通道開啟
  }
});