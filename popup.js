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

    const maxResultsSlider = document.getElementById('maxResultsSlider');
    const maxResultsValue = document.getElementById('maxResultsValue');
    const hotThresholdSlider = document.getElementById('hotThresholdSlider');
    const hotThresholdValue = document.getElementById('hotThresholdValue');
    const enableHistory = document.getElementById('enableHistory');
    const autoSearch = document.getElementById('autoSearch');
    const saveBtn = document.getElementById('saveBtn');

    const defaults = {
      maxResults: 5,
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

    // 保存按钮
    // popup.js 保存按钮部分（替换原有）
  saveBtn.addEventListener('click', function() {
    const newConfig = {
      maxResults: parseInt(maxResultsSlider.value),
      hotThreshold: parseInt(hotThresholdSlider.value),
      enableHistory: enableHistory.checked,
      autoSearch: autoSearch.checked
    };

    console.log('[Popup] 保存设置:', newConfig);

    // 发送消息给 Background
    chrome.runtime.sendMessage({
      type: 'SAVE_CONFIG',
      value: newConfig
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.warn('[Popup] 通知失败，请手动刷新:', chrome.runtime.lastError);
        showToast('✅ 配置已保存，请按 F5 刷新页面');
      } else {
        showToast('✅ 配置已生效');
      }
    });

    // 更新当前 UI 状态（即使消息未送达，本地 UI 仍更新）
    currentConfig = { ...currentConfig, ...newConfig };
    updateStatusUI();
    syncSettingsToUI();
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