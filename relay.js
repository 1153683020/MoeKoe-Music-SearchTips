// relay.js - 配置中继页（扩展页面上下文，chrome.storage 完整可用）
// 由 content.js 以隐藏 iframe 形式嵌入宿主页面：
//  1. 配置下发：读取/监听 chrome.storage → postMessage 通知 content script（含旧配置迁移）
//  2. 计数上传：接收 content script 的计数请求 → 写入 chrome.storage
//  3. 接口代理（MoeKoe 1.7.2+）：content script（隔离世界）访问不到 kugouapi 时，
//     由本页调用 kugouapi.request() 代为请求搜索建议并回传结果
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

  // ---------- 搜索建议代理（MoeKoe 1.7.2+ 迁移） ----------
  // content script 若运行在隔离世界，访问不到客户端注入主世界的 kugouapi；
  // 由本页（插件页面上下文）调用 kugouapi.request() 代为请求并经 postMessage 回传结果。
  function getKugouapi() {
    try {
      if (typeof kugouapi !== 'undefined' && kugouapi && typeof kugouapi.request === 'function') {
        return kugouapi;
      }
    } catch (e) {}
    return null;
  }

  function fetchSuggest(keyword, auth) {
    var api = getKugouapi();
    if (!api) {
      return Promise.resolve({ ok: false, error: 'kugouapi 在 relay 上下文不可用' });
    }
    var payload = {};
    if (auth) payload.headers = { Authorization: auth };
    return api.request('/search/suggest?keywords=' + encodeURIComponent(keyword), payload)
      .then(function(result) {
        // kugouapi.request 出错时不抛异常，而是返回错误对象；先判断 status 再读 body
        if (!result || result.status !== 200) {
          return {
            ok: false,
            error: (result && result.body && result.body.error_msg) || ('请求失败(' + (result && result.status) + ')')
          };
        }
        return { ok: true, body: result.body || null };
      })
      .catch(function(e) {
        return { ok: false, error: (e && e.message) || '请求异常' };
      });
  }

  // 接收 content script 的计数请求与建议代理请求
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'MOEKOE_SEARCH_COUNT_BUMP') {
      bumpCount();
    } else if (e.data.type === 'MOEKOE_SEARCH_SUGGEST') {
      console.log('[搜索建议 relay] 代理请求:', e.data.keyword);
      fetchSuggest(e.data.keyword, e.data.auth).then(function(res) {
        try {
          window.parent.postMessage({
            type: 'MOEKOE_SEARCH_SUGGEST_RESULT',
            id: e.data.id,
            ok: res.ok,
            body: res.body || null,
            error: res.error || ''
          }, '*');
        } catch (err) {}
      });
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
