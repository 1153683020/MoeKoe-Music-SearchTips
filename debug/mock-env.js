// debug/mock-env.js - 模拟 chrome 扩展 API 的调试内核
// 通过 ?role=page|popup|background 区分上下文；顶层窗口创建共享内核。
// page 上下文故意不暴露 chrome.storage，模拟 MoeKoe 对 content script 的限制。
(function() {
  'use strict';

  var role = 'top';
  try {
    var m = location.search.match(/[?&]role=([^&]+)/);
    if (m) role = m[1];
  } catch (e) {}

  var top = window.top;
  var kernel = top.__moekoeKernel;

  if (!kernel) {
    kernel = top.__moekoeKernel = createKernel();
  }

  function createKernel() {
    var storageData = {};
    var storageListeners = [];
    var bgMessageHandlers = [];
    var pageMessageHandlers = [];
    var pageWindow = null;
    var tab = { id: 1, active: true, url: 'about:blank' };
    var lastError = null;
    var logs = [];

    function log(msg) { logs.push(msg); if (logs.length > 500) logs.shift(); }

    function fireStorageChanged(changes) {
      setTimeout(function() {
        for (var i = 0; i < storageListeners.length; i++) {
          try { storageListeners[i](changes, 'local'); } catch (e) {}
        }
      }, 0);
    }

    // chrome 风格的消息分发：支持同步 sendResponse 与 return true 异步响应
    function dispatch(handlers, msg, senderTab, cb, label) {
      lastError = null;
      var responded = false;
      var keepOpen = false;
      var sendResponse = function(resp) {
        if (responded) return;
        responded = true;
        if (cb) { lastError = null; cb(resp); }
      };
      var handled = false;
      for (var i = 0; i < handlers.length; i++) {
        var ret;
        try {
          ret = handlers[i](msg, { tab: senderTab }, sendResponse);
        } catch (e) {
          log('[' + label + '] handler 异常: ' + e.message);
          continue;
        }
        handled = true;
        if (ret === true) keepOpen = true;
      }
      if (!handled) {
        lastError = '接收方未注册监听';
        log('[' + label + '] 无监听方，回调 lastError');
        if (cb) cb(undefined);
        return;
      }
      if (!keepOpen && !responded) {
        if (cb) cb(undefined);
      }
    }

    return {
      logs: logs,
      log: log,
      getLastError: function() { return lastError; },
      storageData: storageData,

      storageGet: function(keys, cb) {
        setTimeout(function() {
          var result = {};
          if (Array.isArray(keys)) {
            keys.forEach(function(k) { if (k in storageData) result[k] = storageData[k]; });
          } else if (keys && typeof keys === 'object') {
            Object.keys(keys).forEach(function(k) { result[k] = (k in storageData) ? storageData[k] : keys[k]; });
          } else if (typeof keys === 'string') {
            if (keys in storageData) result[keys] = storageData[keys];
          }
          if (cb) cb(result);
        }, 0);
      },

      storageSet: function(obj, cb) {
        var changes = {};
        for (var k in obj) {
          changes[k] = { oldValue: storageData[k], newValue: obj[k] };
          storageData[k] = obj[k];
        }
        log('[storage] set ' + JSON.stringify(obj));
        fireStorageChanged(changes);
        if (cb) setTimeout(cb, 0);
      },

      storageRemove: function(keys, cb) {
        var changes = {};
        var list = Array.isArray(keys) ? keys : [keys];
        list.forEach(function(k) {
          if (k in storageData) {
            changes[k] = { oldValue: storageData[k], newValue: undefined };
            delete storageData[k];
          }
        });
        log('[storage] remove ' + JSON.stringify(list));
        fireStorageChanged(changes);
        if (cb) setTimeout(cb, 0);
      },

      resetStorage: function() {
        storageData = {};
        this.storageData = storageData;
        log('[storage] 已重置');
      },

      addStorageListener: function(fn) { storageListeners.push(fn); },
      addBgMessageHandler: function(fn) { bgMessageHandlers.push(fn); },
      addPageMessageHandler: function(fn) { pageMessageHandlers.push(fn); },
      clearBgHandlers: function() { bgMessageHandlers = []; log('[kernel] Background 监听已断开'); },
      counts: function() {
        return { bg: bgMessageHandlers.length, page: pageMessageHandlers.length, storage: storageListeners.length };
      },

      registerPageWindow: function(win) {
        pageWindow = win;
        pageMessageHandlers = [];
        try { tab.url = win.location.href.split('#')[0]; } catch (e) {}
        log('[page] 页面已注册: ' + tab.url);
      },

      dispatchToBackground: function(msg, cb) {
        dispatch(bgMessageHandlers, msg, tab, cb, 'bg');
      },

      tabsQuery: function(opts, cb) {
        setTimeout(function() { if (cb) cb([tab]); }, 0);
      },

      tabsSendMessage: function(tabId, msg, cb) {
        log('[tabs.sendMessage → page] ' + msg.type);
        dispatch(pageMessageHandlers, msg, tab, cb, 'page');
      },

      tabsUpdate: function(tabId, opts, cb) {
        if (opts && opts.url && pageWindow) {
          var oldUrl = tab.url;
          var newUrl = opts.url;
          var oldNoHash = oldUrl.split('#')[0];
          var newNoHash = newUrl.split('#')[0];
          if (oldNoHash === newNoHash && newUrl.indexOf('#') !== -1) {
            // 规范行为：仅 hash 变化不重新加载页面，触发 hashchange
            tab.url = newUrl;
            log('[tabs.update] hash 变化 → 触发页面 hashchange');
            setTimeout(function() {
              try { pageWindow.location.hash = newUrl.split('#').slice(1).join('#'); } catch (e) {}
            }, 0);
          } else if (oldUrl !== newUrl) {
            tab.url = newUrl;
            log('[tabs.update] 路径变化 → 页面导航');
            setTimeout(function() {
              try { pageWindow.location.href = newUrl; } catch (e) {}
            }, 0);
          }
        }
        setTimeout(function() { if (cb) cb(tab); }, 0);
      },

      tabsReload: function(tabId, cb) {
        log('[tabs.reload] 重载页面');
        setTimeout(function() {
          if (pageWindow) { try { pageWindow.location.reload(); } catch (e) {} }
          if (cb) cb();
        }, 0);
      }
    };
  }

  // ===== 按角色装配 window.chrome =====
  function makeLastErrorGetter() {
    return {
      get lastError() { return kernel.getLastError(); }
    };
  }

  function makeStorage() {
    return {
      local: {
        get: function(keys, cb) { kernel.storageGet(keys, cb); },
        set: function(obj, cb) { kernel.storageSet(obj, cb); },
        remove: function(keys, cb) { kernel.storageRemove(keys, cb); }
      },
      onChanged: {
        addListener: function(fn) { kernel.addStorageListener(fn); }
      }
    };
  }

  function makeTabs() {
    return {
      query: function(opts, cb) { kernel.tabsQuery(opts, cb); },
      sendMessage: function(tabId, msg, cb) { kernel.tabsSendMessage(tabId, msg, cb); },
      update: function(tabId, opts, cb) { kernel.tabsUpdate(tabId, opts, cb); },
      reload: function(tabId, cb) { kernel.tabsReload(tabId, cb); }
    };
  }

  if (role === 'page') {
    // 模拟 MoeKoe 环境：chrome.storage 可用（开发者确认），消息 API 不可用
    window.chrome = {
      storage: makeStorage(),
      runtime: Object.assign(makeLastErrorGetter(), {})
    };
    kernel.registerPageWindow(window);
  } else if (role === 'relay') {
    // 模拟扩展页面上下文：chrome.storage / onChanged 完整可用
    window.chrome = {
      runtime: Object.assign(makeLastErrorGetter(), {}),
      storage: makeStorage()
    };
  } else if (role === 'popup') {
    window.chrome = {
      runtime: Object.assign(makeLastErrorGetter(), {
        sendMessage: function(msg, cb) { kernel.log('[popup] runtime.sendMessage ' + (msg && msg.type)); kernel.dispatchToBackground(msg, cb); }
      }),
      storage: makeStorage(),
      tabs: makeTabs()
    };
  } else if (role === 'background') {
    window.chrome = {
      runtime: Object.assign(makeLastErrorGetter(), {
        onMessage: {
          addListener: function(fn) { kernel.addBgMessageHandler(fn); }
        }
      }),
      storage: makeStorage(),
      tabs: makeTabs()
    };
  }

  window.__mockRole = role;
})();
