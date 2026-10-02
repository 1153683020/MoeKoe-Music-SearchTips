# MoeKoe-Music搜索建议插件 (MoeKoe-Music-SearchTips) Powered by Deepseek && Repaired by GLM-5.3Flash

## 📖 简介

一个为 MoeKoe Music 设计的搜索框实时建议插件。当您在搜索框中输入关键词时，插件会自动调用后端接口，展示相关搜索建议和热度，帮助您快速定位目标内容。

## ✨ 特性

- **实时建议**：输入即显示，智能匹配热门搜索词。
- **热度标识**：建议词附带热度指数，热门内容一目了然。计数单位采用 `K`/`M`/`B`（1K=1000、1M=100万、1B=10亿），保留一位小数并省略末尾 `.0`（如 `1K`、`99.5K`、`999.9M`）；不足 1000 直接显示原始数值，不足1000000显示为999.9K，不会出现 `0.9M` 这类换算。
- **键盘导航**：支持方向键上下选择，回车确认，操作流畅。
- **点击即搜**：点击建议词即可自动填入搜索框并触发搜索。
- **自定义数量**：支持在弹窗中自定义建议条数（3-20 条），保存后自动实时同步，无需手动刷新。
- **暗色模式**：建议面板自动适配 MoeKoe Music 的暗色主题。

## 🚀 使用方式

1. 安装插件后，在 MoeKoe Music 搜索框中输入关键词。
2. 建议列表将自动弹出，显示匹配的热门搜索词。
3. 使用 ↑/↓ 键高亮选择，按 Enter 键或直接点击建议词即可搜索。
4. 在插件弹窗中调整设置并保存，配置会自动同步到页面（若个别环境未生效，可点击弹窗中的"刷新页面"按钮或按 F5）。

## ⚙️ 技术说明

- 基于 Chrome Extension Manifest V3 开发。
- 采用纯前端 `fetch` 方式调用搜索建议接口。
- 配置同步采用多层机制（按可靠性排序）：
  1. **中继 iframe**（主通道）：content script 注入插件自身的隐藏 iframe（扩展页面上下文，`chrome.storage` 完整可用），通过 `chrome.storage` 轮询/监听 + `postMessage`（纯 DOM 机制）实时同步配置，完全绕开受限的扩展消息 API；
  2. **chrome.storage 直连**：若 content 环境未禁用 `chrome.storage` 则特性检测自动启用；
  3. `chrome.tabs.sendMessage` 直接推送 + Background 中转；
  4. URL hash 兜底 + 页面 `localStorage` 持久化。
- 所有 `chrome.tabs.sendMessage` / `chrome.runtime.sendMessage` 调用统一使用回调风格，避免在 Electron 环境下因 Promise 支持不完整导致中断。
- v1.2.1 起 content script 不再向 Background 轮询拉取配置：真实环境实测发现 MoeKoe 的 Background 中 `storage.onChanged` 不触发，内存缓存会停留在启动时的旧值，轮询会与中继通道互相覆盖造成配置振荡，故移除该通道。

## 📦 安装

将插件文件夹放入 MoeKoe Music 的 `plugins/extensions` 目录，或在插件管理页通过"安装插件"选择 ZIP 包安装。

## 🧪 调试台

`debug/` 目录内置无依赖调试台，可在浏览器中端到端验证插件逻辑（模拟 MoeKoe 受限扩展环境 + chrome API mock）：

```
cd debug
node server.js
# 浏览器打开 http://127.0.0.1:8931/debug/index.html（?auto=1 自动运行全部测试）
```

## 👤 作者

AZLight

## 📄 版本

1.2.1

## 📝 备注

v1.2.1 修复配置振荡问题：真实环境实测发现 MoeKoe 的 Background service worker 中 `storage.onChanged` 不触发，`GET_CONFIG` 轮询会拿到停留在启动时旧值的内存缓存，与中继通道的新鲜配置互相覆盖（表现为配置在两个值之间每秒振荡）。已移除 content 侧轮询，并让 Background 在 `SAVE_CONFIG` 时直接刷新内存缓存。

v1.2.0 在真实 MoeKoe Music 环境实测中发现：所有扩展消息通道（`tabs.sendMessage` 推送、`runtime.sendMessage` 拉取、hash 同步）均不可达，但 popup 的 `chrome.storage` 与 content 的 `localStorage` 读取可靠。据此新增**中继 iframe** 机制：content script 注入插件自身的隐藏 iframe（扩展上下文），通过 `chrome.storage` + `postMessage`（纯 DOM 机制）实时同步配置，保存后通常在 1 秒内自动生效，无需手动刷新。

---

## PS：搜索建议插件配置同步调试历程

### 1. 目标
实现 MoeKoe Music 插件中“搜索建议最大条数”配置的实时同步：用户在 popup 中修改设置后，页面搜索建议立即按新数量显示，且重启软件后保留。

---

### 2. 尝试过的方法与遇到的问题

| 方法 | 原理 | 结果 | 失败原因 |
|------|------|------|----------|
| **直接使用 `chrome.storage.local`** | popup 写入，content script 读取 | ❌ content 中 `chrome.storage` 不可用 | MoeKoe 的 content script 环境禁用了 `chrome.storage` API |
| **使用 `localStorage`（共享存储）** | popup 写入，content 读取 | ❌ 读取不到 | popup 和 content script 属于不同源（扩展源 vs 页面源），`localStorage` 不共享 |
| **通过 `chrome.runtime.sendMessage` 直接通信** | popup 发消息给 content | ❌ content 收不到 | 消息被环境拦截或 content 监听未生效 |
| **通过 `chrome.scripting.executeScript` 注入** | popup 向页面注入脚本写 localStorage | ❌ 注入失败 | 权限不足或 CSP 限制，`executeScript` 被拒绝 |
| **Background Service Worker 中转** | popup→background→content | ❌ 偶尔成功，但极不稳定 | Background 可能未启动，或消息在 MoeKoe 中被过滤 |
| **保存后提示手动刷新** | 放弃自动同步，依赖用户操作 | ✅ 稳定生效 | 无环境依赖，最可靠 |

---

### 3. 已解决的问题

- ✅ **启动软件时读取配置**：通过 `content.js` 在页面加载时从 `localStorage` 读取 `search_maxResults`，已成功保留上次设置（如 10 条）。
- ✅ **搜索建议功能本身**：搜索请求、结果展示、键盘导航均正常工作。

---

### 4. 未解决的问题

- ❌ **保存后自动同步**：由于 MoeKoe Music 对扩展 API 的严格限制，任何自动同步方式（消息、注入、存储共享）均不可靠或完全失效。必须由用户手动刷新页面（F5）才能让配置生效。

---

### 5. 最终推荐方案（已实施）

- **保存逻辑**：popup 保存配置到 `chrome.storage`（自身 UI 用），并显示 Toast 提示：“配置已保存，请按 F5 刷新页面生效”。
- **刷新提示**：已移除无效的“刷新页面”按钮，避免用户误操作。
- **启动加载**：content script 在页面加载时从 `localStorage` 读取配置（若之前刷新过，则值已写入）。
- **用户操作流程**：修改设置 → 保存 → 按 F5 刷新 → 建议数量变更。

---

### 6. 为什么只能这样？

MoeKoe Music 基于 Electron，其扩展机制对 Manifest V3 的实现不完整，且对 `chrome.scripting`、`chrome.runtime` 等 API 做了限制。在 content script 中，`chrome.storage` 被禁用；`localStorage` 隔离；消息传递常被拦截。这些限制使得实时同步成为不可能，只能依靠用户手动刷新。

---

### 7. 未来可能的优化

- 若 MoeKoe Music 更新，开放了 `chrome.storage` 或 `chrome.runtime.sendMessage` 在 content 中的使用，则可恢复自动同步。
- 或者利用 Electron 的 `ipcRenderer` 实现更底层通信，但需要修改主程序，超出插件能力。

---

### 8. 结论

当前插件功能完整，唯一不便之处是需要用户手动刷新。在现有环境下，这是最高效、最稳定的方式。建议在插件描述或设置页面中明确提示，降低用户困惑。

---

### 9. v1.1.0 修复：实时同步已恢复（2026-10）

重新审查代码与 MoeKoe Music 宿主实现（`electron/extensions/extensionIPC.js` 等）后，定位到问题并已修复：

#### 找到的根因

| 问题 | 说明 |
|------|------|
| **`tabs.sendMessage(...).catch()` 抛 TypeError** | 旧版 background.js 对 `chrome.tabs.sendMessage` 的返回值直接调用 `.catch()`。当宿主的 `tabs.sendMessage` 不返回 Promise 时（Electron 对 MV3 Promise 化支持不完整），`.catch` 访问 `undefined` 抛出 TypeError，**中断中转链路**，导致 `sendResponse` 永远不会被调用——这正是"偶尔成功，但极不稳定"的表现：消息本身可能已送达 content，但 popup 侧收到 `lastError` 报错 |
| **popup 直连测试方法有误** | 此前用 `chrome.runtime.sendMessage` 从 popup 直发 content，但该 API 在 MV3 语义下只能到达 Background/扩展页面，永远到不了 content script，测试结论因此失真 |
| **仅依赖单一通道** | 只靠 Background 推送这一条链路，任何一环失效即整体失效 |

#### 已实施的修复（多层同步）

1. **统一回调风格**：所有 `tabs.sendMessage` / `runtime.sendMessage` 调用改为回调 + `try/catch`，不再依赖 Promise 返回值。
2. **popup 直接推送**：保存后 popup 通过 `chrome.tabs.sendMessage` 直接推送到活动标签页（少一跳，不依赖 Background 生命周期）。
3. **Background 中转保留**：作为降级路径；并增加内存缓存，`GET_CONFIG` 同步响应，规避 Electron 异步 `sendResponse` 的兼容问题。
4. **content script 定时拉取**：新增 `GET_CONFIG` 轮询（默认 1 秒，连续失败 3 次后退避到 5 秒），即使推送链路完全失效，配置也能在 1 秒内自动同步；搜索框聚焦时额外拉取一次。
5. **URL hash 兜底**：popup 保存后通过 `chrome.tabs.update` 将配置合并进页面 URL hash（`#__moekoe_cfg=...`，保留原有 hash 参数），content script 监听 `hashchange` 应用配置——即使所有扩展消息通道失效也能同步。
6. **localStorage 持久化保留**：content script 收到配置后写回页面 `localStorage`，重启后保留。
7. **修复"刷新页面"按钮**：popup 中的按钮此前无事件处理，现已接入 `chrome.tabs.reload`（失败时退回 `tabs.update` 强制导航），作为最终兜底操作。

#### 同步通道优先级

```
保存配置
  ├─ ① chrome.storage.local.set（持久化，Background 经 onChanged 刷新缓存）
  ├─ ② popup → tabs.sendMessage 直推 content（最快，立即生效）
  ├─ ③ popup → runtime.sendMessage → Background → tabs.sendMessage 中转（降级）
  ├─ ④ content 定时轮询 GET_CONFIG（1s 内自动同步，任何推送失效时兜底）
  ├─ ⑤ tabs.update 携带 hash → content hashchange（所有消息通道失效时兜底）
  └─ ⑥ 页面 localStorage（重启后保留 + 搜索前重载兜底）
```

#### 用户操作流程（新版）

修改设置 → 保存 → 配置自动生效（通常 1 秒内）。个别环境下可点击"刷新页面"按钮或按 F5。

---

### 10. v1.2.0 修复：中继 iframe 通道（真实环境实测补充）

v1.1.0 的修复在调试台（模拟环境）中全部通过，但在**真实 MoeKoe Music 环境实测**中仍发现同步失效：popup 设为 20 并保存后，页面刷新后仍显示旧值，且 content 控制台无任何推送/拉取/hash 日志。

#### 真实环境实测结论

| 通道 | 真实环境结果 |
|------|--------------|
| popup 的 `chrome.storage.local` | ✅ 可靠（保存后重启保留） |
| content 读页面 `localStorage` | ✅ 可靠 |
| popup/content ↔ Background 消息（含 `GET_CONFIG` 轮询） | ❌ 不可达 |
| Background → content `tabs.sendMessage` 推送 | ❌ 不可达 |
| popup `tabs.update` hash 同步 | ❌ 未触发 hashchange |
| content 直接使用 `chrome.storage` | ❌（与 README 记录一致） |

结论：**任何依赖扩展消息 API 的通道在 MoeKoe 中均不可靠**，必须寻找不经过 Background / 扩展消息的传输方式。

#### 中继 iframe 方案（已实施）

利用两个已被证明可靠的机制组合：

1. **content script 注入隐藏 iframe**，指向插件自身页面 `chrome-extension://<id>/relay.html`（通过 `chrome.runtime.getURL` 构造，已在 manifest 声明 `web_accessible_resources`）。该 iframe 运行在**扩展页面上下文**——与 popup 相同，`chrome.storage` 完整可用。
2. **relay.js 在扩展上下文中**监听 `chrome.storage.onChanged` + 每秒轮询 `chrome.storage.local.get`，拿到最新配置后通过 `window.parent.postMessage(...)` 发送给宿主页面。
3. **content script（隔离世界）通过 `window.addEventListener('message')` 接收**——postMessage 是纯 DOM 机制，跨 JS 世界必通，不受任何扩展 API 限制。

```
popup 保存
  └─ chrome.storage.local.set（✅ 可靠）
       └─ relay iframe（扩展上下文）: onChanged + 1s 轮询 storage.get（✅ 可靠）
            └─ window.parent.postMessage（✅ DOM 机制必通）
                 └─ content script applyConfig + 写 localStorage（✅ 可靠）
```

同时保留原有全部通道作为降级：`chrome.storage` 直连（特性检测）、消息推送/中转、`GET_CONFIG` 轮询、hash 兜底、localStorage 持久化。

#### 调试台验证（v1.2.0）

新增 Test F（relay 中继实时同步）、Test G（断开 Background 后 relay 仍同步）后，调试台 17 项端到端测试全部通过。

---

### 11. v1.2.1 修复：配置振荡（真实环境实测补充）

v1.2.0 在真实环境确认 relay 通道工作正常（配置送达并应用），但控制台日志暴露新问题——**配置在两个值之间每秒振荡**：

```
收到 relay 配置: {...maxResults: 10}   ← relay 每秒送达 chrome.storage 的新鲜值
配置已更新: {maxResults: 15...}        ← GET_CONFIG 轮询送达 Background 的陈旧缓存
```

#### 根因

- MoeKoe 的 Background service worker 中 `chrome.storage.onChanged` **不触发**，内存缓存停留在启动时读取的旧值（15）；
- content 侧 `GET_CONFIG` 轮询（1 秒）持续拿到该陈旧缓存并应用，与 relay 通道（1 秒，chrome.storage 新鲜值 10）互相覆盖，形成振荡；
- 搜索时使用哪个值取决于当时哪个通道刚应用，结果不可预测。

#### 修复

1. **移除 content 侧 `GET_CONFIG` 轮询**：relay 已被证明是真实环境中可靠的主通道，轮询反而引入陈旧数据源；
2. **Background 在 `SAVE_CONFIG` 时直接刷新内存缓存**：不再依赖 `storage.onChanged` 保持缓存新鲜，`GET_CONFIG` 端点保留供降级使用。

修复后所有通道均只传递新鲜配置，无振荡来源。

**Enjoy your searching!** 🔍


