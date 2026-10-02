// content.js - 多层配置同步（中继 iframe + 消息推送 + URL hash）+ 搜索建议
(function() {
  'use strict';

  class SearchSuggest {
    constructor() {
      this.container = null;
      this.visible = false;
      this.highlightedIndex = -1;
      this.items = [];
      this.input = null;
      this.config = {
        maxResults: 10,
        hotThreshold: 100,
        enableHistory: true,
        autoSearch: true
      };
      this.loadConfig();
      this.listenForConfigUpdates();
      // 通道 0：若 content 环境允许 chrome.storage，直接监听（最优通道）
      this.tryDirectStorage();
      // 通道 1：中继 iframe（扩展上下文 + postMessage，绕开受限的扩展消息 API）
      this.injectRelay();
    }

    // 从页面 localStorage 读取配置，带延迟重试
    loadConfig() {
      const read = () => {
        try {
          const maxResults = parseInt(localStorage.getItem('search_maxResults'));
          const hotThreshold = parseInt(localStorage.getItem('search_hotThreshold'));
          if (!isNaN(maxResults) && maxResults > 0) this.config.maxResults = maxResults;
          if (!isNaN(hotThreshold) && hotThreshold > 0) this.config.hotThreshold = hotThreshold;
          if (localStorage.getItem('search_enableHistory') !== null) {
            this.config.enableHistory = localStorage.getItem('search_enableHistory') === 'true';
          }
          if (localStorage.getItem('search_autoSearch') !== null) {
            this.config.autoSearch = localStorage.getItem('search_autoSearch') !== 'false';
          }
          console.log('[搜索建议] 配置加载完成:', this.config);
        } catch (e) {
          console.warn('[搜索建议] loadConfig 异常:', e);
        }
      };
      read();
      setTimeout(read, 200);
    }

    // 统一应用配置：更新内存 + 写回页面 localStorage（保证重启后保留）
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
        this.writePageStorage();
        console.log('[搜索建议] 配置已更新:', this.config);
      }
    }

    writePageStorage() {
      try {
        localStorage.setItem('search_maxResults', String(this.config.maxResults));
        localStorage.setItem('search_hotThreshold', String(this.config.hotThreshold));
        localStorage.setItem('search_enableHistory', this.config.enableHistory ? 'true' : 'false');
        localStorage.setItem('search_autoSearch', this.config.autoSearch ? 'true' : 'false');
      } catch (e) {
        console.warn('[搜索建议] 写入 localStorage 失败:', e);
      }
    }

    // 监听各类配置更新事件（多层同步通道）
    listenForConfigUpdates() {
      const self = this;

      // 通道 A：Background 转发的消息（popup 保存后触发）
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CONFIG_UPDATED') {
          console.log('[搜索建议] 收到推送配置:', message.value);
          self.applyConfig(message.value);
          sendResponse({ success: true });
          return true;
        }
      });

      // 通道 B：URL hash 变化（popup 通过 tabs.update 携带配置，终极兜底）
      window.addEventListener('hashchange', () => {
        try {
          if (location.hash.indexOf('__moekoe_cfg=') === -1) return;
          const params = new URLSearchParams(location.hash.slice(1));
          const raw = params.get('__moekoe_cfg');
          if (!raw) return;
          console.log('[搜索建议] 检测到 hash 配置');
          self.applyConfig(JSON.parse(raw));
        } catch (e) {
          console.warn('[搜索建议] hash 配置解析失败:', e);
        }
      });

      // 通道 C：页面自定义事件（可由页面环境或调试工具触发）
      window.addEventListener('config-updated', () => {
        console.log('[搜索建议] 检测到页面事件，重新加载配置');
        self.loadConfig();
      });

      // 通道 D：relay iframe 的 postMessage 配置推送
      self.listenForRelayMessages();
    }

    // 尝试在 content 环境直接使用 chrome.storage（特性检测，失败则静默降级）
    tryDirectStorage() {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
        const self = this;
        chrome.storage.local.get(['maxResults', 'hotThreshold', 'enableHistory', 'autoSearch'], (res) => {
          if (chrome.runtime.lastError) return;
          if (res) self.applyConfig(res);
        });
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace !== 'local') return;
          const patch = {};
          for (const k in changes) patch[k] = changes[k].newValue;
          self.applyConfig(patch);
        });
        console.log('[搜索建议] chrome.storage 直连通道已启用');
      } catch (e) {
        console.warn('[搜索建议] chrome.storage 不可用，降级到其他通道:', e.message);
      }
    }

    // 注入中继 iframe：扩展页面上下文（chrome.storage 可用）+ postMessage（DOM 机制必通）
    injectRelay() {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime ||
            typeof chrome.runtime.getURL !== 'function') return;
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

    // 监听中继 iframe 的 postMessage 配置推送
    listenForRelayMessages() {
      const self = this;
      window.addEventListener('message', (e) => {
        if (!self.relayFrame || e.source !== self.relayFrame.contentWindow) return;
        if (e.data && e.data.type === 'MOEKOE_SEARCH_CONFIG') {
          console.log('[搜索建议] 收到 relay 配置:', e.data.value);
          self.applyConfig(e.data.value);
        }
      });
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
          if (self.input && self.items[idx]) {
            self.input.value = self.items[idx].name;
            self.input.dispatchEvent(new Event('input', { bubbles: true }));
            self.hide();
          }
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
    selectHighlighted() {
      if (this.highlightedIndex >= 0 && this.input && this.items[this.highlightedIndex]) {
        this.input.value = this.items[this.highlightedIndex].name;
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
        this.hide();
      }
    }
  }

  // ========== 初始化 ==========
  const suggest = new SearchSuggest();
  let debounceTimer = null;

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

  async function fetchSuggestions(keyword) {
    try {
      const response = await fetch(
        `http://127.0.0.1:6521/search/suggest?keywords=${encodeURIComponent(keyword)}`,
        {
          headers: {
            'Authorization': getAuthHeader(),
            'Content-Type': 'application/json'
          }
        }
      );
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data?.data && Array.isArray(data.data)) {
        return data.data.flatMap(group =>
          (group.RecordDatas || []).map(item => ({
            name: item.HintInfo || '',
            hot: parseInt(item.Hot) || 0
          }))
        ).sort((a, b) => b.hot - a.hot);
      }
      return [];
    } catch (e) {
      console.warn('[搜索建议] fetch 失败:', e.message);
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
      const keyword = e.target.value.trim();
      clearTimeout(debounceTimer);
      if (keyword.length < 1) {
        suggest.hide();
        return;
      }
      debounceTimer = setTimeout(async () => {
        // 搜索前从 localStorage 重载配置（兜底）
        suggest.loadConfig();

        const raw = await fetchSuggestions(keyword);
        const filtered = raw
          .filter(item => (item.hot || 0) >= suggest.config.hotThreshold)
          .slice(0, suggest.config.maxResults);

        console.log('[搜索建议] 最终显示 maxResults:', suggest.config.maxResults, '实际条数:', filtered.length);
        suggest.update(filtered);
        if (filtered.length) suggest.show();
        else suggest.hide();
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
      if (suggest.relayFrame && !document.contains(suggest.relayFrame)) suggest.injectRelay();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
