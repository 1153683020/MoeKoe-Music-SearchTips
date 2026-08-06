// background.js
console.log('[Background] 已启动');

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_CONFIG') {
    // 保存配置到 chrome.storage（供 popup 自身使用）
    chrome.storage.local.set(message.value, () => {
      // 向当前活动标签页的 content script 发送配置
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'CONFIG_UPDATED',
            value: message.value
          }).catch(() => {
            // 若 content 未就绪，忽略错误
          });
        }
      });
      sendResponse({ success: true });
    });
    return true; // 异步响应
  }
});