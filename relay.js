// relay.js - 配置中继页（扩展页面上下文，chrome.storage 完整可用）
// 由 content.js 在 chrome.storage 不可用的环境下以隐藏 iframe 形式嵌入宿主页面：
//  1. 配置下发：读取/监听 chrome.storage → postMessage 通知 content script（含旧配置迁移）
//  2. 计数上传：接收 content script 的计数请求 → 写入 chrome.storage
(function() {
  'use strict';

  var STORAGE_KEY = 'search-suggest-config';
  var LEGACY_KEYS = ['search_maxResults', 'search_hotThreshold', 'search_enableHistory', 'search_autoSearch'];
  var COUNT_KEYS = ['searchCount', 'searchCountDate'];
  var DEFAULTS = { maxResults: 10, hotThreshold: 100, enableHistory: true, autoSearch: true };
  var lastSent = '';

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function send(value) {
    try {
      var s = JSON.stringify(value);
      if (s === lastSent) return; // 内容未变化不重复推送
      lastSent = s;
      window.parent.postMessage({ type: 'MOEKOE_SEARCH_CONFIG', value: value }, '*');
    } catch (e) {}
  }

  // 读取配置（单对象键 + 旧版多键迁移，与 popup/content 的 readConfig 逻辑一致）
  function pull() {
    try {
      chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS], function(res) {
        if (chrome.runtime.lastError) return;
        var config = res[STORAGE_KEY];
        if (!config) {
          var legacy = {};
          if (typeof res.search_maxResults === 'number') legacy.maxResults = res.search_maxResults;
          if (typeof res.search_hotThreshold === 'number') legacy.hotThreshold = res.search_hotThreshold;
          if (typeof res.search_enableHistory === 'boolean') legacy.enableHistory = res.search_enableHistory;
          if (typeof res.search_autoSearch === 'boolean') legacy.autoSearch = res.search_autoSearch;
          config = { ...DEFAULTS, ...legacy };
          chrome.storage.local.set({ [STORAGE_KEY]: config }, function() {
            if (Object.keys(legacy).length) {
              chrome.storage.local.remove(LEGACY_KEYS, function() {});
              console.log('[搜索建议 relay] 旧版多键配置已迁移');
            }
          });
        } else {
          config = { ...DEFAULTS, ...config };
        }
        send(config);
      });
    } catch (e) {}
  }

  // 计数累计（跨天自动归零）
  function bumpCount() {
    try {
      var today = todayStr();
      chrome.storage.local.get(COUNT_KEYS, function(res) {
        if (chrome.runtime.lastError) return;
        var count = (res.searchCountDate === today ? (res.searchCount || 0) : 0) + 1;
        chrome.storage.local.set({ searchCount: count, searchCountDate: today }, function() {
          if (!chrome.runtime.lastError) {
            console.log('[搜索建议 relay] 计数已写入:', count);
          }
        });
      });
    } catch (e) {}
  }

  // 接收 content script 的计数请求
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (e.data && e.data.type === 'MOEKOE_SEARCH_COUNT_BUMP') {
      bumpCount();
    }
  });

  // 初始同步：iframe 加载即推送当前配置
  pull();

  // 监听变化：popup 保存后立即触发
  try {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace !== 'local') return;
      if (changes[STORAGE_KEY]) {
        var stored = changes[STORAGE_KEY].newValue || {};
        send({ ...DEFAULTS, ...stored });
      }
    });
  } catch (e) {}

  // 定时拉取兜底（1 秒）：即使 onChanged 在宿主环境失效也能同步
  setInterval(pull, 1000);
})();
