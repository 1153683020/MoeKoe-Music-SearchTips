// popup.js
console.log('[Popup] popup.js 文件已加载');

(function() {
  'use strict';

  try {
    const STORAGE_KEY = 'search-suggest-config';
    const LEGACY_KEYS = ['search_maxResults', 'search_hotThreshold', 'search_enableHistory', 'search_autoSearch'];
    const defaults = {
      maxResults: 10,
      hotThreshold: 100,
      enableHistory: true,
      autoSearch: true
    };

    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');
    const toast = document.getElementById('toast');

    const suggestCountEl = document.getElementById('suggestCount');
    const hotThresholdDisplayEl = document.getElementById('hotThresholdDisplay');
    const historyStateEl = document.getElementById('historyState');
    const searchCountDisplayEl = document.getElementById('searchCountDisplay');
    const resetBtn = document.getElementById('resetBtn');
    const refreshBtn = document.getElementById('refreshBtn');

    const maxResultsSlider = document.getElementById('maxResultsSlider');
    const maxResultsValue = document.getElementById('maxResultsValue');
    const hotThresholdSlider = document.getElementById('hotThresholdSlider');
    const hotThresholdValue = document.getElementById('hotThresholdValue');
    const enableHistory = document.getElementById('enableHistory');
    const autoSearch = document.getElementById('autoSearch');
    const saveBtn = document.getElementById('saveBtn');

    let currentConfig = { ...defaults, searchCount: 0 };

    function showToast(message, duration = 2000) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }

    // 读取配置（与 content.js 相同的单对象键 + 旧版多键迁移）
    function readConfig(callback) {
      chrome.storage.local.get([STORAGE_KEY, 'searchCount', ...LEGACY_KEYS], function(res) {
        if (chrome.runtime.lastError) {
          console.warn('[Popup] 读取配置失败:', chrome.runtime.lastError.message);
          callback({ ...defaults, searchCount: 0 });
          return;
        }
        let cfg = res[STORAGE_KEY];
        if (!cfg) {
          cfg = { ...defaults };
          let hasLegacy = false;
          if (typeof res.search_maxResults === 'number') { cfg.maxResults = res.search_maxResults; hasLegacy = true; }
          if (typeof res.search_hotThreshold === 'number') { cfg.hotThreshold = res.search_hotThreshold; hasLegacy = true; }
          if (typeof res.search_enableHistory === 'boolean') { cfg.enableHistory = res.search_enableHistory; hasLegacy = true; }
          if (typeof res.search_autoSearch === 'boolean') { cfg.autoSearch = res.search_autoSearch; hasLegacy = true; }
          chrome.storage.local.set({ [STORAGE_KEY]: cfg }, function() {
            if (hasLegacy) {
              chrome.storage.local.remove(LEGACY_KEYS, function() {});
              console.log('[Popup] 旧版多键配置已迁移');
            }
          });
        } else {
          cfg = { ...defaults, ...cfg };
        }
        callback({ ...cfg, searchCount: res.searchCount || 0 });
      });
    }

    // 标签切换
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = btn.dataset.tab;
        panels.forEach(panel => {
          panel.classList.remove('active');
          if (panel.id === targetTab + 'Panel') {
            panel.classList.add('active');
          }
        });
        if (targetTab === 'status' || targetTab === 'settings') {
          loadConfig();
        }
      });
    });

    function loadConfig() {
      readConfig(function(config) {
        console.log('[Popup] 加载配置:', config);
        currentConfig = config;
        updateStatusUI();
        syncSettingsToUI();
      });
    }

    function updateStatusUI() {
      suggestCountEl.textContent = currentConfig.maxResults;
      hotThresholdDisplayEl.textContent = currentConfig.hotThreshold;
      historyStateEl.textContent = currentConfig.enableHistory ? '开启' : '关闭';
      historyStateEl.className = 'info-val ' + (currentConfig.enableHistory ? 'on' : 'off');
      searchCountDisplayEl.textContent = `今日已触发 ${currentConfig.searchCount || 0} 次建议`;
    }

    function syncSettingsToUI() {
      console.log('[Popup] 同步设置UI:', currentConfig);
      maxResultsSlider.value = currentConfig.maxResults;
      maxResultsValue.textContent = `${currentConfig.maxResults} 条`;
      hotThresholdSlider.value = currentConfig.hotThreshold;
      hotThresholdValue.textContent = currentConfig.hotThreshold;
      enableHistory.checked = currentConfig.enableHistory;
      autoSearch.checked = currentConfig.autoSearch;
    }

    maxResultsSlider.addEventListener('input', function() {
      maxResultsValue.textContent = `${this.value} 条`;
    });

    hotThresholdSlider.addEventListener('input', function() {
      hotThresholdValue.textContent = this.value;
    });

    // 保存按钮：写入 chrome.storage，content script 通过 onChanged 实时应用
    saveBtn.addEventListener('click', function() {
      const newConfig = {
        maxResults: parseInt(maxResultsSlider.value),
        hotThreshold: parseInt(hotThresholdSlider.value),
        enableHistory: enableHistory.checked,
        autoSearch: autoSearch.checked
      };

      console.log('[Popup] 保存设置:', newConfig);

      chrome.storage.local.set({ [STORAGE_KEY]: newConfig }, function() {
        console.log('[Popup] 配置已写入 chrome.storage，页面将实时应用');
      });

      currentConfig = { ...currentConfig, ...newConfig };
      updateStatusUI();
      syncSettingsToUI();
      showToast('✅ 已保存，实时生效');
    });

    // 刷新页面按钮：手动兜底操作
    refreshBtn.addEventListener('click', function() {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (!tabs || !tabs[0]) {
            showToast('⚠️ 未找到活动页面，请手动按 F5');
            return;
          }
          try {
            chrome.tabs.reload(tabs[0].id, function() {
              if (chrome.runtime.lastError) {
                // reload 不可用时退回 update 强制导航
                try {
                  chrome.tabs.update(tabs[0].id, { url: tabs[0].url }, function() {
                    void chrome.runtime.lastError;
                  });
                } catch (e) {
                  showToast('⚠️ 无法自动刷新，请手动按 F5');
                }
              }
            });
          } catch (e) {
            try {
              chrome.tabs.update(tabs[0].id, { url: tabs[0].url }, function() {
                void chrome.runtime.lastError;
              });
            } catch (e2) {
              showToast('⚠️ 无法自动刷新，请手动按 F5');
            }
          }
        });
      } catch (e) {
        showToast('⚠️ 无法自动刷新，请手动按 F5');
      }
    });

    // 重置统计
    resetBtn.addEventListener('click', function() {
      chrome.storage.local.set({ searchCount: 0 }, function() {
        currentConfig.searchCount = 0;
        updateStatusUI();
        showToast('🔄 统计已重置');
      });
    });

    // 监听存储变化（content 或其他来源修改时同步 popup UI）
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace !== 'local') return;
      if (changes[STORAGE_KEY]) {
        const stored = changes[STORAGE_KEY].newValue || {};
        currentConfig = { ...currentConfig, ...defaults, ...stored };
        updateStatusUI();
        syncSettingsToUI();
      }
      if (changes.searchCount) {
        currentConfig.searchCount = changes.searchCount.newValue;
        updateStatusUI();
      }
    });

    // 初始化
    document.addEventListener('DOMContentLoaded', function() {
      loadConfig();
    });

  } catch(err) {
    console.error('[Popup] 初始化错误:', err);
  }
})();
