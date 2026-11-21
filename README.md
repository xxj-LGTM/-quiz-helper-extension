# 题目助手 · 网页识题解题插件

一个 Chrome / Edge 浏览器扩展（Manifest V3）：识别网页上的题目——文字题、选择题、判断题、图片题——调用**免费大模型接口**给出答案与解析。

**装好即可用**：默认走公共免 Key 接口，不需要注册账号、不需要填 API Key。

## 特性

- **四种识题方式**：选中文字解题、点选页面元素、自动抓题、截图框选（图片题 / Canvas / PDF）
- **默认免 Key**：内置公共免费接口，开箱即用
- **可换自己的免费 Key**：内置智谱 GLM、硅基流动、魔搭、Gemini、OpenRouter 五个预设，选完粘 Key 即可
- **三种回答风格**：只要答案 / 简要解析 / 详细解答
- **流式输出**：答案逐字出现，可随时停止
- **纯前端无后端**：API Key 只存浏览器本地 `chrome.storage.sync`，不经过任何中间服务器
- **不污染页面样式**：UI 注入 Shadow DOM，不受目标网站 CSS 影响

## 安装

### 方式一：手动加载（通用）

1. 下载本仓库，或用 `git clone`
2. 浏览器地址栏打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
3. 打开右上角 **开发人员模式**
4. 点 **加载解压缩的扩展**，选择 `quiz-helper-extension` 目录

### 方式二：Windows 一键脚本

双击 `install-to-browser.cmd`，脚本会把插件复制到 `C:\Users\Public\QuizHelper\extension` 并在桌面创建「题目助手 Edge」快捷方式。

> 注意：Edge 已运行时命令行加载参数不生效，脚本会提示你先完全退出 Edge。

## 配置免费 API（可选）

默认免 Key 接口有两个限制：**同一 IP 约 45 秒 1 次**、**不能读图**。
要解除限制，点面板右下角「设置」，选一个预设、粘贴 Key、点「测试连接」：

| 服务商 | 免费情况 | 推荐模型 | 读图 |
|---|---|---|---|
| **智谱 GLM**（首选） | `glm-4v-flash` 免费 | `glm-4v-flash` | ✅ |
| 硅基流动 | 有免费模型，视觉按量计费极便宜 | `Qwen/Qwen2.5-VL-7B-Instruct` | ✅ |
| 魔搭 ModelScope | 每日免费额度 | `Qwen/Qwen2.5-VL-72B-Instruct` | ✅ |
| Google Gemini | 有免费额度（需能访问 Google） | `gemini-2.5-flash` | ✅ |
| OpenRouter | 模型名带 `:free` 即免费 | `google/gemini-2.5-flash:free` | ✅ |

接口地址填到 `/v1` 这一层即可，插件自己拼 `/chat/completions`。免费额度与模型名会变动，以各家官网为准。

## 用法

| 方式 | 操作 | 适合 |
|---|---|---|
| 选中解题 | 划选题目 → 点浮出的「解题」气泡，或按 `Alt+Q` | 普通题库、网页文章 |
| 点选取题 | 面板点「点选取题」→ 鼠标移到题目块 → 点一下 | 结构化题库逐条刷 |
| 自动抓题 | 面板点「自动抓题」 | 排版规范的页面 |
| 截图识题 | 面板点「截图识题」→ 拖动框选 | 图片题、Canvas、PDF |

快捷键可在 `edge://extensions/shortcuts` 修改。详细说明与故障排查见 [`quiz-helper-extension/README.md`](quiz-helper-extension/README.md)。

## 项目结构

```
quiz-helper-extension/
├── manifest.json     # MV3 清单：权限、注入规则、快捷键
├── background.js     # Service Worker：配置、调用 API（流式 SSE）、截图、跨 frame 转发
├── content.js        # 页面内 UI：悬浮面板、选中气泡、点选/自动抓题、截图框选、Markdown 渲染
├── popup.html/js     # 工具栏弹窗：状态总览
├── options.html/js   # 设置页：服务商预设、Key、模型、回答风格、测试连接
└── icons/            # 图标
```

## 已知限制

- 浏览器内置页（`edge://`、`chrome://`）、扩展商店页、新标签页 不允许注入脚本
- 免 Key 模式不能读图，且约 45 秒 1 次
- 部分模型对单次输出有硬上限（如 `glm-4v-flash` 为 1024 tokens），插件会自动按上限发送并在必要时重试
- 截图识题需要浏览器窗口在前台，窗口被遮挡时截图会失败

## 免责声明

本工具用于自查作业、练习与知识点理解。请遵守所在考试 / 测评平台的规则，不要用于作弊。

## License

[MIT](LICENSE)
