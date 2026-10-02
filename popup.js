// popup.js
console.log('[Popup] popup.js 文件已加载');

(function() {
  'use strict';

  try {
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

    const defaults = {
      maxResults: 10,
      hotThreshold: 100,
      enableHistory: true,
      autoSearch: true,
      searchCount: 0
    };

    let currentConfig = { ...defaults };

    function showToast(message, duration = 2000) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
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
      chrome.storage.local.get(Object.keys(defaults), function(result) {
        console.log('[Popup] 加载配置:', result);
        currentConfig = { ...defaults, ...result };
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

    // 直接推送配置到当前页面的 content script（不经过 Background，减少不稳定环节）
    function pushToActiveTab(config) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (!tabs || !tabs[0]) return;
          try {
            // 统一使用回调风格：Electron 的 tabs.sendMessage 可能不返回 Promise
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'CONFIG_UPDATED',
              value: config
            }, function() {
              void chrome.runtime.lastError;
            });
            console.log('[Popup] 已直接推送配置到页面');
          } catch (e) {
            console.warn('[Popup] 直接推送失败:', e);
          }
        });
      } catch (e) {
        console.warn('[Popup] tabs API 不可用:', e);
      }
    }

    // 通过 URL hash 携带配置（终极兜底：即使所有消息通道失效也能同步）
    function syncViaHash(config) {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (!tabs || !tabs[0] || !tabs[0].url) return;
          try {
            const url = new URL(tabs[0].url);
            const params = new URLSearchParams(url.hash ? url.hash.slice(1) : '');
            params.set('__moekoe_cfg', JSON.stringify(config));
            url.hash = params.toString();
            chrome.tabs.update(tabs[0].id, { url: url.toString() }, function() {
              void chrome.runtime.lastError;
            });
            console.log('[Popup] 已通过 URL hash 同步配置');
          } catch (e) {
            console.warn('[Popup] hash 同步失败:', e);
          }
        });
      } catch (e) {
        console.warn('[Popup] tabs API 不可用:', e);
      }
    }

    // 保存按钮：storage 持久化 + 直接推送 + Background 中转 + hash 兜底
    saveBtn.addEventListener('click', function() {
      const newConfig = {
        maxResults: parseInt(maxResultsSlider.value),
        hotThreshold: parseInt(hotThresholdSlider.value),
        enableHistory: enableHistory.checked,
        autoSearch: autoSearch.checked
      };

      console.log('[Popup] 保存设置:', newConfig);

      // 1. 持久化到扩展存储（Background 通过 onChanged 同步缓存）
      chrome.storage.local.set(newConfig, function() {
        console.log('[Popup] 配置已写入 chrome.storage');
      });

      // 2. 直接推送到页面 content script
      pushToActiveTab(newConfig);

      // 3. 通知 Background 刷新缓存并中转（降级路径）
      try {
        chrome.runtime.sendMessage({
          type: 'SAVE_CONFIG',
          value: newConfig
        }, function() {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        console.warn('[Popup] 通知 Background 失败:', e);
      }

      // 4. hash 同步兜底
      syncViaHash(newConfig);

      // 更新当前 UI 状态
      currentConfig = { ...currentConfig, ...newConfig };
      updateStatusUI();
      syncSettingsToUI();
      showToast('✅ 已保存，通常 1 秒内自动生效；如未生效请刷新页面');
    });

    // 刷新页面按钮：强制重载页面使配置生效（兜底操作）
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

    // 监听存储变化（外部修改）
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace === 'local') {
        let needUpdate = false;
        for (let key in changes) {
          if (key in defaults) {
            currentConfig[key] = changes[key].newValue;
            needUpdate = true;
          }
        }
        if (needUpdate) {
          updateStatusUI();
          syncSettingsToUI();
        }
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