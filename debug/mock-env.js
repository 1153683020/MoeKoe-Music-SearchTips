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

  // ===== 模拟搜索建议数据与 kugouapi（MoeKoe 1.7.2+） =====
  var MOCK_SUGGEST = [];
  for (var mi = 0; mi < 20; mi++) {
    MOCK_SUGGEST.push({ HintInfo: 'Mock歌曲' + (mi + 1) + ' - Mock歌手' + ((mi % 5) + 1), Hot: 1000 - mi * 30 });
  }

  // 模拟 MoeKoe 1.7.2 注入页面主世界 / 插件页面的 kugouapi 全局对象
  // role 标注请求来源（page=content 直连 / relay=中继代理），写入内核日志供测试断言
  function makeKugouapi(role) {
    return {
      request: function(path, payload) {
        var hasAuth = !!(payload && payload.headers && payload.headers.Authorization);
        kernel.log('[kugouapi:' + role + '] request ' + path + (hasAuth ? '（含登录态）' : ''));
        return Promise.resolve({
          status: 200,
          body: { data: [{ RecordDatas: MOCK_SUGGEST.slice() }] },
          cookie: [],
          headers: {}
        });
      },
      getDevice: function() { return { mocked: true }; },
      generateNewDevice: function() { return { mocked: true }; }
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
    // 模拟 MoeKoe 环境：默认 chrome.storage 可用（开发者环境）；
    // storage=off 时不提供 chrome.storage（模拟实测受限环境，走中继模式）
    var storageOff = /[?&]storage=off/.test(location.search);
    window.chrome = {
      runtime: Object.assign(makeLastErrorGetter(), {
        getURL: function(p) { return 'relay-sim.html?role=relay'; }
      })
    };
    if (!storageOff) {
      window.chrome.storage = makeStorage();
    }
    kernel.registerPageWindow(window);
    kernel.log('[page] chrome.storage ' + (storageOff ? '不可用（中继模式）' : '可用（直连模式）'));
    // 模拟 MoeKoe 1.7.2 主世界 kugouapi 注入：
    //   默认注入（与 content 同 realm 可见，走直连）
    //   ?kugouapi=off 不注入（走 relay 代理）
    //   ?mwapi=1 注入主世界专用实例（page-sim 在 main-world.js 捕获后移除共享引用，
    //            模拟"主世界可见、隔离世界不可见"的双世界形态，走主世界桥接）
    if (/[?&]mwapi=1/.test(location.search)) {
      window.kugouapi = makeKugouapi('main');
    } else if (!/[?&]kugouapi=off/.test(location.search)) {
      window.kugouapi = makeKugouapi('page');
    }
    kernel.log('[page] kugouapi ' + (window.kugouapi ? '已注入' : '不可见（走 relay 代理）'));
  } else if (role === 'relay') {
    // 模拟扩展页面上下文：chrome.storage / onChanged 完整可用；kugouapi 同样可用（插件页面）
    window.chrome = {
      runtime: Object.assign(makeLastErrorGetter(), {}),
      storage: makeStorage()
    };
    window.kugouapi = makeKugouapi('relay');
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
