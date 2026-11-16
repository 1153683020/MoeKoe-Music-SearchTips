// content.js - 配置同步（chrome.storage 直连 / 中继 iframe 自适应）+ 搜索建议
(function() {
  'use strict';

  const STORAGE_KEY = 'search-suggest-config';
  const LEGACY_KEYS = ['search_maxResults', 'search_hotThreshold', 'search_enableHistory', 'search_autoSearch'];
  const DEFAULTS = {
    maxResults: 10,
    hotThreshold: 100,
    enableHistory: true,
    autoSearch: true
  };

  // 环境探测：content script 中 chrome.storage 是否可用（不同 MoeKoe 版本表现不一致）
  const HAS_DIRECT_STORAGE = (function() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local &&
             typeof chrome.storage.local.get === 'function';
    } catch (e) {
      return false;
    }
  })();

  // 读取配置（单对象键，缺失字段用默认值补齐；兼容迁移旧版多键格式）
  function readConfig(callback) {
    try {
      chrome.storage.local.get([STORAGE_KEY, ...LEGACY_KEYS], (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[搜索建议] 读取配置失败:', chrome.runtime.lastError.message);
          callback({ ...DEFAULTS });
          return;
        }
        let config = res[STORAGE_KEY];
        if (!config) {
          const legacy = {};
          if (typeof res.search_maxResults === 'number') legacy.maxResults = res.search_maxResults;
          if (typeof res.search_hotThreshold === 'number') legacy.hotThreshold = res.search_hotThreshold;
          if (typeof res.search_enableHistory === 'boolean') legacy.enableHistory = res.search_enableHistory;
          if (typeof res.search_autoSearch === 'boolean') legacy.autoSearch = res.search_autoSearch;
          config = { ...DEFAULTS, ...legacy };
          chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
            if (Object.keys(legacy).length) {
              chrome.storage.local.remove(LEGACY_KEYS, () => {});
              console.log('[搜索建议] 旧版多键配置已迁移');
            }
          });
        } else {
          config = { ...DEFAULTS, ...config };
        }
        callback(config);
      });
    } catch (e) {
      console.warn('[搜索建议] 读取配置异常:', e);
      callback({ ...DEFAULTS });
    }
  }

  class SearchSuggest {
    constructor() {
      this.container = null;
      this.visible = false;
      this.highlightedIndex = -1;
      this.items = [];
      this.input = null;
      this.suppressNext = false;
      this.config = { ...DEFAULTS };
      this.initConfig();
    }

    initConfig() {
      const self = this;
      console.log('[搜索建议] chrome.storage', HAS_DIRECT_STORAGE ? '可用（直连模式）' : '不可用（中继模式）');
      if (HAS_DIRECT_STORAGE) {
        // 直连模式：启动读取 + onChanged 监听
        readConfig((config) => self.applyConfig(config));
        try {
          chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[STORAGE_KEY]) {
              const stored = changes[STORAGE_KEY].newValue || {};
              console.log('[搜索建议] 检测到配置变化');
              self.applyConfig({ ...DEFAULTS, ...stored });
            }
          });
        } catch (e) {
          console.warn('[搜索建议] onChanged 监听失败:', e.message);
        }
      } else {
        // 中继模式：注入扩展上下文的隐藏 iframe，经 postMessage 同步
        this.listenForRelayMessages();
      }
      // 中继 iframe 始终注入：除配置同步外，还承担 kugouapi 不可用环境下的接口代理
      this.listenForSuggestResults();
      // 主世界桥接：注册监听并提前握手探测 kugouapi（桥接脚本就绪后回报 READY）
      listenForMainWorldBridge();
      pingMainWorld();
      this.injectRelay();
    }

    // 注入中继 iframe（扩展页面上下文：chrome.storage 可用）
    injectRelay() {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime ||
            typeof chrome.runtime.getURL !== 'function') {
          console.warn('[搜索建议] runtime.getURL 不可用，中继无法注入');
          return;
        }
        if (this.relayFrame && document.contains(this.relayFrame)) return;
        const url = chrome.runtime.getURL('relay.html');
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.style.cssText = 'display:none;width:0;height:0;border:0;';
        const self = this;
        frame.addEventListener('load', () => {
          self.relayReady = true;
          console.log('[搜索建议] relay 中继已就绪');
        });
        (document.body || document.documentElement).appendChild(frame);
        this.relayFrame = frame;
        console.log('[搜索建议] relay 中继已注入');
      } catch (e) {
        console.warn('[搜索建议] relay 注入失败:', e);
      }
    }

    // 监听中继 iframe 的 postMessage（配置下发）
    listenForRelayMessages() {
      const self = this;
      window.addEventListener('message', (e) => {
        if (!self.relayFrame || e.source !== self.relayFrame.contentWindow) return;
        if (e.data && e.data.type === 'MOEKOE_SEARCH_CONFIG') {
          console.log('[搜索建议] 收到 relay 配置');
          self.applyConfig({ ...DEFAULTS, ...(e.data.value || {}) });
        }
      });
    }

    // 监听中继 iframe 的 kugouapi 代理响应（建议结果）
    listenForSuggestResults() {
      const self = this;
      window.addEventListener('message', (e) => {
        if (!self.relayFrame || e.source !== self.relayFrame.contentWindow) return;
        // 结果由 fetchSuggestions 的 requestId 匹配处理，这里仅保留调试信息
        if (e.data && e.data.type === 'MOEKOE_SEARCH_SUGGEST_RESULT') {
          console.log('[搜索建议] 收到 relay 代理响应 id=' + e.data.id);
        }
      });
    }

    applyConfig(value) {
      if (!value || typeof value !== 'object') return;
      let changed = false;
      if (typeof value.maxResults === 'number' && value.maxResults > 0 && value.maxResults !== this.config.maxResults) {
        this.config.maxResults = value.maxResults;
        changed = true;
      }
      if (typeof value.hotThreshold === 'number' && value.hotThreshold > 0 && value.hotThreshold !== this.config.hotThreshold) {
        this.config.hotThreshold = value.hotThreshold;
        changed = true;
      }
      if (typeof value.enableHistory === 'boolean' && value.enableHistory !== this.config.enableHistory) {
        this.config.enableHistory = value.enableHistory;
        changed = true;
      }
      if (typeof value.autoSearch === 'boolean' && value.autoSearch !== this.config.autoSearch) {
        this.config.autoSearch = value.autoSearch;
        changed = true;
      }
      if (changed) {
        console.log('[搜索建议] 配置已更新:', this.config);
      }
    }

    // ---------- UI 相关方法 ----------
    mount(container) { this.container = container; }
    setInput(input) { this.input = input; }

    createPanel() {
      const panel = document.createElement('div');
      panel.className = 'moekoe-search-suggest-panel';
      // 仅保留结构性内联样式，外观（含暗色模式）由 search-suggest.css 控制
      panel.style.cssText = `
        position: absolute;
        z-index: 99999;
        top: 100%;
        left: 0;
        right: 0;
        max-height: 400px;
        overflow-y: auto;
        display: none;
        font-size: 14px;
      `;
      return panel;
    }

    update(suggestions) {
      this.items = suggestions;
      this.highlightedIndex = -1;
      if (!this.container) return;
      if (!suggestions || suggestions.length === 0) {
        this.container.innerHTML = '<div class="moekoe-suggest-empty">暂无建议</div>';
        return;
      }

      const html = suggestions.map((item, i) => {
        const hotText = item.hot ? '🔥 ' + this.formatHot(item.hot) : '';
        return `<div class="moekoe-suggest-item" data-index="${i}">
          <span class="moekoe-suggest-name">${item.name || ''}</span>
          ${hotText ? `<span class="moekoe-suggest-hot">${hotText}</span>` : ''}
        </div>`;
      }).join('');

      this.container.innerHTML = html;
      const self = this;
      this.container.querySelectorAll('.moekoe-suggest-item').forEach(el => {
        el.addEventListener('click', function() {
          const idx = parseInt(this.dataset.index);
          self.selectItem(self.items[idx]);
        });
      });
    }

    formatHot(hot) {
      if (!hot) return '';
      const fmt = (tenths) => {
        const s = (tenths / 10).toFixed(1);
        return s.endsWith('.0') ? s.slice(0, -2) : s;
      };
      if (hot >= 1000000000) return fmt(Math.floor(hot / 100000000)) + 'B';
      if (hot >= 1000000) return fmt(Math.floor(hot / 100000)) + 'M';
      if (hot >= 1000) return fmt(Math.floor(hot / 100)) + 'K';
      return String(hot);
    }

    show() {
      this.visible = true;
      if (this.container) this.container.style.display = 'block';
    }
    hide() {
      this.visible = false;
      if (this.container) this.container.style.display = 'none';
    }
    highlightNext() {
      this.highlightedIndex = Math.min(this.highlightedIndex + 1, this.items.length - 1);
      this.updateHighlight();
    }
    highlightPrev() {
      this.highlightedIndex = Math.max(this.highlightedIndex - 1, -1);
      this.updateHighlight();
    }
    updateHighlight() {
      const items = this.container?.querySelectorAll('.moekoe-suggest-item');
      if (!items) return;
      items.forEach((el, i) => {
        el.classList.toggle('moekoe-suggest-active', i === this.highlightedIndex);
      });
    }
    // 选中建议：填充输入框；autoSearch 开启时合成 Enter 触发萌音的 @keydown.enter="getSearch"
    selectItem(item) {
      if (!item) return;
      if (this.input) {
        this.suppressNext = true;
        this.input.value = item.name;
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      this.hide();
      if (this.config.autoSearch && this.input) {
        this.input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        }));
      }
    }

    selectHighlighted() {
      if (this.highlightedIndex >= 0 && this.items[this.highlightedIndex]) {
        this.selectItem(this.items[this.highlightedIndex]);
      }
    }
  }

  // ========== 初始化 ==========
  const suggest = new SearchSuggest();
  let debounceTimer = null;

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 搜索计数：今日触发建议次数（跨天自动归零）
  // 直连模式直接写 chrome.storage；中继模式经 postMessage 由 relay（扩展上下文）写入
  function bumpSearchCount() {
    try {
      if (HAS_DIRECT_STORAGE) {
        const today = todayStr();
        chrome.storage.local.get(['searchCount', 'searchCountDate'], (res) => {
          if (chrome.runtime.lastError) {
            console.warn('[搜索建议] 读取计数失败:', chrome.runtime.lastError.message);
            return;
          }
          const count = (res.searchCountDate === today ? (res.searchCount || 0) : 0) + 1;
          chrome.storage.local.set({ searchCount: count, searchCountDate: today }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[搜索建议] 写入计数失败:', chrome.runtime.lastError.message);
            } else {
              console.log('[搜索建议] 搜索计数已更新:', count);
            }
          });
        });
      } else if (suggest.relayReady && suggest.relayFrame) {
        suggest.relayFrame.contentWindow.postMessage({ type: 'MOEKOE_SEARCH_COUNT_BUMP' }, '*');
        console.log('[搜索建议] 计数请求已发往 relay');
      } else {
        console.warn('[搜索建议] relay 未就绪，本次计数跳过');
      }
    } catch (e) {
      console.warn('[搜索建议] 计数异常:', e);
    }
  }

  function findSearchInput() {
    return document.querySelector('input[type="text"]') ||
           document.querySelector('.search-bar input') ||
           document.querySelector('.side-search input') ||
           document.querySelector('input[type="search"]');
  }

  function getAuthHeader() {
    try {
      const raw = localStorage.getItem('MoeData');
      if (!raw) return 'token=;userid=0;dfid=';
      const data = JSON.parse(raw);
      const token = data?.UserInfo?.token || '';
      const userid = data?.UserInfo?.userid || 0;
      const dfid = data?.Device?.dfid || '';
      return `token=${token};userid=${userid};dfid=${dfid}`;
    } catch (e) {
      return 'token=;userid=0;dfid=';
    }
  }

  // ---------- 搜索建议请求（MoeKoe 1.7.2+ 迁移） ----------
  // 客户端 1.7.2 起默认不再开放本地 6521 Web API 端口，改用客户端注入主世界的
  // kugouapi.request()（不经过网络端口、无需用户开启 API 模式，也无需声明额外权限）。
  // 隔离世界的 content script 与 relay 子框架均访问不到 kugouapi（Electron preload
  // 不注入子框架），故按环境三级降级：
  //   ① 主世界直接调用（部分版本 content 与 kugouapi 同处主世界）；
  //   ② 主世界桥接：main-world.js（"world": "MAIN"）与 kugouapi 同处主世界，
  //      经 window.postMessage 握手并代理请求（跨世界必通的 DOM 机制）；
  //   ③ relay（插件页面上下文）postMessage 代理兜底。
  let suggestSeq = 0;

  function kugouapiAvailable() {
    try {
      return typeof window.kugouapi === 'object' && window.kugouapi !== null &&
             typeof window.kugouapi.request === 'function';
    } catch (e) {
      return false;
    }
  }

  function parseSuggestBody(body) {
    if (body?.data && Array.isArray(body.data)) {
      return body.data.flatMap(group =>
        (group.RecordDatas || []).map(item => ({
          name: item.HintInfo || '',
          hot: parseInt(item.Hot) || 0
        }))
      ).sort((a, b) => b.hot - a.hot);
    }
    return [];
  }

  async function requestSuggestDirect(keyword) {
    // kugouapi.request 返回的是已解析的结果对象 { status, body, ... }，不要调用 .json()
    const result = await window.kugouapi.request(
      `/search/suggest?keywords=${encodeURIComponent(keyword)}`,
      { headers: { Authorization: getAuthHeader() } }
    );
    if (!result || result.status !== 200) {
      throw new Error(result?.body?.error_msg || '请求失败(' + (result?.status ?? '无响应') + ')');
    }
    return parseSuggestBody(result.body);
  }

  function requestSuggestViaRelay(keyword) {
    return new Promise((resolve, reject) => {
      if (!suggest.relayReady || !suggest.relayFrame) {
        reject(new Error('relay 未就绪'));
        return;
      }
      const id = ++suggestSeq;
      const frame = suggest.relayFrame;
      const onMessage = (e) => {
        if (e.source !== frame.contentWindow) return;
        if (e.data && e.data.type === 'MOEKOE_SEARCH_SUGGEST_RESULT' && e.data.id === id) {
          window.removeEventListener('message', onMessage);
          clearTimeout(timer);
          if (e.data.ok) {
            resolve(parseSuggestBody(e.data.body));
          } else {
            reject(new Error(e.data.error || 'relay 代理请求失败'));
          }
        }
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('relay 代理请求超时'));
      }, 8000);
      window.addEventListener('message', onMessage);
      frame.contentWindow.postMessage({
        type: 'MOEKOE_SEARCH_SUGGEST',
        id: id,
        keyword: keyword,
        auth: getAuthHeader()
      }, '*');
    });
  }

  // ---------- 主世界桥接（MoeKoe 1.7.2+） ----------
  // 真实环境实测：content script（隔离世界）与 relay 子框架均访问不到 kugouapi
  // （Electron preload 不注入子框架）。由 manifest 以 "world": "MAIN" 注入的
  // main-world.js 与 kugouapi 同处主世界，经 window.postMessage 代为请求。
  let mwReady = false;
  let mwBridgeAbsent = false;
  const mwPending = new Map();

  function listenForMainWorldBridge() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'MOEKOE_SEARCH_SUGGEST_MW_READY') {
        if (!mwReady) console.log('[搜索建议] 主世界桥接已就绪（kugouapi 可用）');
        mwReady = true;
      } else if (d.type === 'MOEKOE_SEARCH_SUGGEST_MW_UNAVAILABLE') {
        if (!mwBridgeAbsent) console.log('[搜索建议] 主世界无 kugouapi，桥接不可用');
        mwBridgeAbsent = true;
      } else if (d.type === 'MOEKOE_SEARCH_SUGGEST_MW_RESULT') {
        const pending = mwPending.get(d.id);
        if (!pending) return;
        mwPending.delete(d.id);
        clearTimeout(pending.timer);
        if (d.ok) {
          pending.resolve(parseSuggestBody(d.body));
        } else {
          pending.reject(new Error(d.error || '主世界桥接请求失败'));
        }
      }
    });
  }

  function pingMainWorld() {
    try {
      window.postMessage({ type: 'MOEKOE_SEARCH_SUGGEST_MW_PING' }, '*');
    } catch (e) {}
  }

  function waitForMwReady(timeoutMs) {
    if (mwReady) return Promise.resolve(true);
    if (mwBridgeAbsent) return Promise.resolve(false);
    return new Promise((resolve) => {
      const start = Date.now();
      pingMainWorld();
      const iv = setInterval(() => {
        if (mwReady) {
          clearInterval(iv);
          resolve(true);
        } else if (mwBridgeAbsent || Date.now() - start >= timeoutMs) {
          clearInterval(iv);
          mwBridgeAbsent = true;
          resolve(false);
        } else {
          pingMainWorld();
        }
      }, 250);
    });
  }

  function requestSuggestViaMainWorld(keyword) {
    return new Promise((resolve, reject) => {
      const id = ++suggestSeq;
      const timer = setTimeout(() => {
        mwPending.delete(id);
        reject(new Error('主世界桥接请求超时'));
      }, 8000);
      mwPending.set(id, { resolve, reject, timer });
      window.postMessage({
        type: 'MOEKOE_SEARCH_SUGGEST_MW',
        id: id,
        keyword: keyword,
        auth: getAuthHeader()
      }, '*');
    });
  }

  async function fetchSuggestions(keyword) {
    try {
      if (kugouapiAvailable()) {
        return await requestSuggestDirect(keyword);
      }
      if (mwReady || (!mwBridgeAbsent && await waitForMwReady(1500))) {
        return await requestSuggestViaMainWorld(keyword);
      }
      return await requestSuggestViaRelay(keyword);
    } catch (e) {
      console.warn('[搜索建议] 请求失败:', e.message);
      return [];
    }
  }

  function attachSearchListener() {
    const input = findSearchInput();
    if (!input || input.hasAttribute('data-suggest-bound')) return;
    input.setAttribute('data-suggest-bound', 'true');

    suggest.setInput(input);
    const panel = suggest.createPanel();
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(panel);
    suggest.mount(panel);

    input.addEventListener('input', function(e) {
      // 选中的建议自动填充不重复触发建议面板
      if (suggest.suppressNext) {
        suggest.suppressNext = false;
        clearTimeout(debounceTimer);
        return;
      }
      const keyword = e.target.value.trim();
      clearTimeout(debounceTimer);
      if (keyword.length < 1) {
        suggest.hide();
        return;
      }
      debounceTimer = setTimeout(async () => {
        const raw = await fetchSuggestions(keyword);
        const filtered = raw
          .filter(item => (item.hot || 0) >= suggest.config.hotThreshold)
          .slice(0, suggest.config.maxResults);

        console.log('[搜索建议] 最终显示 maxResults:', suggest.config.maxResults, '实际条数:', filtered.length);
        suggest.update(filtered);
        if (filtered.length) {
          suggest.show();
          bumpSearchCount();
        } else {
          suggest.hide();
        }
      }, 300);
    });

    input.addEventListener('keydown', function(e) {
      switch(e.key) {
        case 'ArrowDown': e.preventDefault(); suggest.highlightNext(); break;
        case 'ArrowUp': e.preventDefault(); suggest.highlightPrev(); break;
        case 'Enter':
          if (suggest.visible && suggest.highlightedIndex >= 0) {
            e.preventDefault();
            suggest.selectHighlighted();
          }
          break;
        case 'Escape': suggest.hide(); break;
      }
    });

    document.addEventListener('click', function(e) {
      if (suggest.visible && suggest.container &&
          !suggest.container.contains(e.target) && e.target !== input) {
        suggest.hide();
      }
    });
  }

  function init() {
    attachSearchListener();
    const observer = new MutationObserver(() => {
      const input = findSearchInput();
      if (input && !input.hasAttribute('data-suggest-bound')) attachSearchListener();
      if (suggest.relayFrame && !document.contains(suggest.relayFrame)) {
        suggest.injectRelay();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
