// background.js
console.log('[Background] 已启动');

const DEFAULTS = {
  maxResults: 10,
  hotThreshold: 100,
  enableHistory: true,
  autoSearch: true
};

// 内存缓存配置：GET_CONFIG 需同步响应以兼容 Electron 不完整的异步消息实现
let cachedConfig = null;
let cacheReady = false;

function updateCache(changes) {
  if (!cachedConfig) cachedConfig = { ...DEFAULTS };
  for (const key in changes) {
    if (key in DEFAULTS && changes[key].newValue !== undefined) {
      cachedConfig[key] = changes[key].newValue;
    }
  }
}

// 启动时从 storage 加载缓存
chrome.storage.local.get(Object.keys(DEFAULTS), (result) => {
  cachedConfig = { ...DEFAULTS, ...result };
  cacheReady = true;
  console.log('[Background] 配置缓存加载完成:', cachedConfig);
});

// 监听 storage 变化（popup 直接写入时同步刷新缓存）
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    updateCache(changes);
    console.log('[Background] 检测到 storage 变化，缓存已刷新:', cachedConfig);
  }
});

// 向当前活动标签页的 content script 推送配置
function pushToActiveTab(value) {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      try {
        // 统一使用回调风格：Electron 的 tabs.sendMessage 可能不返回 Promise，
        // 对其调用 .catch 会在不支持 Promise 的环境下抛出 TypeError，导致中转中断
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'CONFIG_UPDATED',
          value: value
        }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        console.warn('[Background] 推送配置失败:', e);
      }
    });
  } catch (e) {
    console.warn('[Background] tabs API 不可用:', e);
  }
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SAVE_CONFIG') {
    // 直接刷新内存缓存：宿主环境的 storage.onChanged 可能不触发，不能依赖它保持缓存新鲜
    if (!cachedConfig) cachedConfig = { ...DEFAULTS };
    for (const key in message.value) {
      if (key in DEFAULTS && message.value[key] !== undefined) {
        cachedConfig[key] = message.value[key];
      }
    }
    chrome.storage.local.set(message.value, () => {
      // 中转推送到 content script（降级路径，popup 侧也会直接推送）
      pushToActiveTab(message.value);
      sendResponse({ success: true });
    });
    return true; // 异步响应
  }

  if (message.type === 'GET_CONFIG') {
    // 同步响应（缓存），content script 拉取用
    sendResponse({ ready: cacheReady, value: cachedConfig });
  }
});
