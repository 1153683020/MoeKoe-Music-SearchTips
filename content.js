// content.js - chrome.storage 直连（get + onChanged 实时同步）+ 搜索建议
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
      this.config = { ...DEFAULTS };
      this.initConfig();
    }

    initConfig() {
      const self = this;
      // 启动时读取一次
      readConfig((config) => self.applyConfig(config));
      // 监听变化：popup 保存后实时生效
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[STORAGE_KEY]) {
            const stored = changes[STORAGE_KEY].newValue || {};
            console.log('[搜索建议] 检测到配置变化');
            self.applyConfig({ ...DEFAULTS, ...stored });
          }
        });
      } catch (e) {
        console.warn('[搜索建议] chrome.storage 不可用:', e.message);
      }
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
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
