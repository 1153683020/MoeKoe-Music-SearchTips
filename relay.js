// relay.js - 配置中继页（扩展页面上下文，chrome.storage 完整可用）
// 由 content.js 以隐藏 iframe 形式嵌入宿主页面，
// 通过 postMessage（纯 DOM 机制，不受扩展消息 API 限制）将配置实时同步给 content script。
(function() {
  'use strict';

  var KEYS = ['maxResults', 'hotThreshold', 'enableHistory', 'autoSearch'];

  function send(value) {
    try {
      window.parent.postMessage({ type: 'MOEKOE_SEARCH_CONFIG', value: value }, '*');
    } catch (e) {}
  }

  function pull() {
    try {
      chrome.storage.local.get(KEYS, function(res) {
        if (chrome.runtime.lastError) return;
        send(res || {});
      });
    } catch (e) {}
  }

  // 初始同步：iframe 加载即推送当前配置
  pull();

  // 监听变化：popup 保存后立即触发
  try {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace !== 'local') return;
      var patch = {};
      for (var k in changes) {
        if (KEYS.indexOf(k) !== -1) patch[k] = changes[k].newValue;
      }
      if (Object.keys(patch).length) send(patch);
    });
  } catch (e) {}

  // 定时拉取兜底（1 秒）：即使 onChanged 在宿主环境失效也能同步
  setInterval(pull, 1000);
})();
