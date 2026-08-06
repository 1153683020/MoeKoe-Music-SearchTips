// content.js - 通过 localStorage + 自定义事件实现配置实时同步
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
        maxResults: 5,
        hotThreshold: 100,
        enableHistory: true,
        autoSearch: true
      };
      // 加载配置（立即 + 延迟重试）
      this.loadConfig();
      // 监听自定义事件（由 popup 注入脚本触发）
      this.listenForCustomEvent();
    }

    // 从 localStorage 读取配置，带延迟重试
    loadConfig() {
      const read = () => {
        try {
          const maxResults = parseInt(localStorage.getItem('search_maxResults'));
          const hotThreshold = parseInt(localStorage.getItem('search_hotThreshold'));
          const enableHistory = localStorage.getItem('search_enableHistory') === 'true';
          const autoSearch = localStorage.getItem('search_autoSearch') !== 'false';
          if (!isNaN(maxResults)) this.config.maxResults = maxResults;
          if (!isNaN(hotThreshold)) this.config.hotThreshold = hotThreshold;
          if (enableHistory !== undefined) this.config.enableHistory = enableHistory;
          if (autoSearch !== undefined) this.config.autoSearch = autoSearch;
          console.log('[搜索建议] 配置加载完成:', this.config);
        } catch (e) {
          console.warn('[搜索建议] loadConfig 异常:', e);
        }
      };
      // 立即读取一次
      read();
      // 延迟 200ms 再读一次，应对页面启动时 localStorage 未就绪
      setTimeout(read, 200);
    }

    // 监听页面自定义事件（由 popup 保存后触发）
    listenForCustomEvent() {
      // 监听页面自定义事件（由注入脚本触发）
      window.addEventListener('config-updated', () => {
        console.log('[搜索建议] 检测到页面事件，重新加载配置');
        this.reloadConfig();
      });
    
      // 监听来自 popup 的消息（降级方案）
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CONFIG_UPDATED') {
          console.log('[搜索建议] 收到 Background 转发的配置:', message.value);
          // 写入页面 localStorage
          localStorage.setItem('search_maxResults', String(message.value.maxResults));
          localStorage.setItem('search_hotThreshold', String(message.value.hotThreshold));
          localStorage.setItem('search_enableHistory', JSON.stringify(message.value.enableHistory));
          localStorage.setItem('search_autoSearch', JSON.stringify(message.value.autoSearch));
          this.reloadConfig(); // 更新内存配置
          sendResponse({ success: true });
          return true;
        }
      });
    }

    // 重新加载配置（供事件调用）
    reloadConfig() {
      try {
        const maxResults = parseInt(localStorage.getItem('search_maxResults'));
        const hotThreshold = parseInt(localStorage.getItem('search_hotThreshold'));
        const enableHistory = localStorage.getItem('search_enableHistory') === 'true';
        const autoSearch = localStorage.getItem('search_autoSearch') !== 'false';
        if (!isNaN(maxResults)) this.config.maxResults = maxResults;
        if (!isNaN(hotThreshold)) this.config.hotThreshold = hotThreshold;
        if (enableHistory !== undefined) this.config.enableHistory = enableHistory;
        if (autoSearch !== undefined) this.config.autoSearch = autoSearch;
        console.log('[搜索建议] 重新加载配置:', this.config);
        return Promise.resolve();
      } catch (e) {
        return Promise.resolve();
      }
    }

    // ---------- UI 相关方法（保持不变） ----------
    mount(container) { this.container = container; }
    setInput(input) { this.input = input; }

    createPanel() {
      const panel = document.createElement('div');
      panel.className = 'moekoe-search-suggest-panel';
      panel.style.cssText = `
        position: absolute;
        z-index: 99999;
        top: 100%;
        left: 0;
        right: 0;
        background: #fff;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
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
        this.container.innerHTML = '<div style="padding:16px;text-align:center;color:#999;">暂无建议</div>';
        return;
      }

      const html = suggestions.map((item, i) => {
        const hotText = item.hot ? '🔥 ' + this.formatHot(item.hot) : '';
        return `<div class="moekoe-suggest-item" data-index="${i}" style="padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f5f5f5;">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${item.name || ''}</span>
          ${hotText ? `<span style="font-size:12px;color:#1db954;margin-left:12px;">${hotText}</span>` : ''}
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
      if (hot >= 10000) return (hot/10000).toFixed(1) + '万';
      if (hot >= 1000) return (hot/1000).toFixed(1) + 'k';
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
        el.style.background = i === this.highlightedIndex ? '#f0f9f4' : '';
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
        // 每次搜索前重新加载配置（但配置已在事件中更新，此调用仅用于保险）
        await suggest.reloadConfig();

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

  const style = document.createElement('style');
  style.textContent = `
    .moekoe-search-suggest-panel { margin-top:4px; animation:slideDown 0.2s ease; }
    @keyframes slideDown { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
    .moekoe-suggest-item:hover { background:#f0f9f4 !important; }
  `;
  document.head.appendChild(style);

  function init() {
    attachSearchListener();
    const observer = new MutationObserver(() => {
      const input = findSearchInput();
      if (input && !input.hasAttribute('data-suggest-bound')) attachSearchListener();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();