// main-world.js - 主世界桥接脚本（manifest 中以 "world": "MAIN" 注入）
// 客户端 1.7.2+ 通过 preload 把 kugouapi 注入页面主世界，而 content script（隔离世界）
// 与扩展子框架页面均访问不到；本脚本与 kugouapi 同处主世界，代为发起请求，
// 经 window.postMessage（DOM 机制，跨世界必通）与隔离世界的 content.js 通信。
(function() {
  'use strict';

  // 主世界 kugouapi 引用（加载时捕获；缺失时在请求阶段重试探测）
  var MW_API = (function() {
    try {
      if (typeof kugouapi !== 'undefined' && kugouapi && typeof kugouapi.request === 'function') {
        return kugouapi;
      }
    } catch (e) {}
    return null;
  })();

  function getApi() {
    if (MW_API) return MW_API;
    try {
      if (typeof kugouapi !== 'undefined' && kugouapi && typeof kugouapi.request === 'function') {
        MW_API = kugouapi;
        return MW_API;
      }
    } catch (e) {}
    return null;
  }

  // 向隔离世界广播可用性：kugouapi 存在 → READY，否则 → UNAVAILABLE
  function announce() {
    try {
      window.postMessage({
        type: getApi() ? 'MOEKOE_SEARCH_SUGGEST_MW_READY' : 'MOEKOE_SEARCH_SUGGEST_MW_UNAVAILABLE'
      }, '*');
    } catch (e) {}
  }

  function fetchSuggest(keyword, auth) {
    var api = getApi();
    if (!api) {
      return Promise.resolve({ ok: false, error: 'kugouapi 在主世界不可用' });
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

  window.addEventListener('message', function(e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'MOEKOE_SEARCH_SUGGEST_MW_PING') {
      announce();
    } else if (d.type === 'MOEKOE_SEARCH_SUGGEST_MW' && typeof d.id === 'number') {
      console.log('[搜索建议 主世界桥接] 代理请求:', d.keyword);
      fetchSuggest(d.keyword, d.auth).then(function(res) {
        try {
          window.postMessage({
            type: 'MOEKOE_SEARCH_SUGGEST_MW_RESULT',
            id: d.id,
            ok: res.ok,
            body: res.body || null,
            error: res.error || ''
          }, '*');
        } catch (err) {}
      });
    }
  });

  announce();
})();
