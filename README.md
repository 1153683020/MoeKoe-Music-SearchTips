# MoeKoe-Music搜索建议插件 (MoeKoe-Music-SearchTips) Powered by Deepseek

## 📖 简介
一个为 MoeKoe Music 设计的搜索框实时建议插件。当您在搜索框中输入关键词时，插件会自动调用后端接口，展示相关搜索建议和热度，帮助您快速定位目标内容。

## ✨ 特性
- **实时建议**：输入即显示，智能匹配热门搜索词。
- **热度标识**：建议词附带热度指数，热门内容一目了然。
- **键盘导航**：支持方向键上下选择，回车确认，操作流畅。
- **点击即搜**：点击建议词即可自动填入搜索框并触发搜索。
- **固定数量**：当前版本稳定显示 **10 条** 建议，兼顾信息量与界面整洁。

## 🚀 使用方式
1. 安装插件后，在 MoeKoe Music 搜索框中输入关键词。
2. 建议列表将自动弹出，显示匹配的热门搜索词。
3. 使用 ↑/↓ 键高亮选择，按 Enter 键或直接点击建议词即可搜索。

## ⚙️ 技术说明
- 基于 Chrome Extension Manifest V3 开发。
- 采用纯前端 `fetch` 方式调用搜索建议接口。
- 目前为稳定过渡版本，建议数量固定为 10 条，后续可根据环境支持开放自定义。

## 📦 安装
将插件文件夹放入 MoeKoe Music 的 `plugins/extensions` 目录，或在插件管理页通过“安装插件”选择 ZIP 包安装。

## 👤 作者
AZLight

## 📄 版本
1.0.0

## 📝 备注
由于宿主环境限制，配置实时同步功能暂未启用，因此目前固定为 10 条建议。若您需要调整数量，可联系作者或等待后续更新。

---

**Enjoy your searching!** 🔍



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
