<div align="center">

# 鲸鱼娘 · WhaleGirl

**桌面上养一只鲸鱼娘，顺便把 Codex 的界面换成你喜欢的样子。**

一只会呼吸、会溜达、能拖拽抛掷的桌面宠物，
外加一套给 [Codex](https://github.com/openai/codex) 桌面端换肤的主题注入引擎。

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-blue.svg)](#环境要求)
[![Electron](https://img.shields.io/badge/Electron-43.3.0-47848f.svg)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[English](./README_EN.md) | 简体中文

</div>

---

## ✨ 它能做什么

### 🐟 桌面宠物

- 基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的透明置顶小窗，住在你的桌面上
- 待机呼吸、随机小动作、左右转身、屏幕漫游
- **点击**有 Q 弹反馈（还带一声"啵啾"），**拖拽甩出去**会弹回来
- 右键菜单可以点播任意动作
- 大小 / 位置 / 是否固定都能调

### 🎨 Codex 界面主题

- **守岸人 · 夜海** —— 半透明玻璃质感 + 立绘，冷色夜海
- **深夜大肥鱼 · 雨夜** —— 视频动态壁纸 + HUD（时钟 / 日期 / 氛围文案 / 实时天气），雨夜氛围

- 托盘一键切换，即时生效，不用重启 Codex

### 🎬 可更换启动动画

- 打开 Codex 时先播一段动画，窗口位置自动贴合
- 托盘「从文件导入…」丢个 mp4/webm/mov 就能换
- 播不出来自动回退到内置片

### 📊 用量面板

- `Ctrl + Alt + U` 呼出，读取 Codex 会话日志与 CC Switch 归档
- 今日 / 近 30 天趋势、按应用与模型拆分、上下文占用
- 可以语音播报今日用量

---

## 📦 安装

### 方式一：下载安装包（推荐）

到 [Releases](../../releases) 下载最新的 `WhaleGirl-<版本>-Setup.exe（中文名版：鲸鱼娘-<版本>-安装版.exe）`，双击安装。

- 安装向导为中文
- 默认装到 `D:\鲸鱼娘\whale-girl`（可改）
- 自动创建**桌面快捷方式**与开始菜单项
- 首次启动会引导登录，可选开机自启

> 安装包未签名，Windows SmartScreen 可能提示"未知发布者"，点「更多信息 → 仍要运行」即可。

### 方式二：从源码运行

```bash
git clone https://github.com/YuRu0/whale-girl.git
cd whale-girl
npm install

# 开发模式运行（需要本机已有 Electron 43.3.0 运行时）
npm start
```

---

## 🚀 使用

装好后鲸鱼娘住在**系统托盘**，右键托盘图标：

| 菜单项 | 说明 |
| --- | --- |
| 打开 Codex × 守岸人 | 启动 Codex 并应用当前主题 |
| 查看用量（`Ctrl+Alt+U`） | 呼出用量面板 |
| 播报今日用量 | 语音播报今天的消耗 |
| Codex 联动 ▸ 重播启动动画 | 再放一次开场动画 |
| Codex 联动 ▸ 启动动画 ▸ … | 切换 / 导入动画，或打开动画目录 |
| Codex 联动 ▸ 界面主题 | 在两套主题间切换 |

**桌宠交互**：左键点击（有音效）· 按住拖拽 · 甩出去会弹回 · 右键点播动作

**数据存放**：全部在你本机的 `安装目录\data\` 下（设置、日志、宠物配置），不上传任何东西。

---

## 🔧 工作原理

```
┌──────────────┐   CDP (127.0.0.1:9227)   ┌──────────────┐
│   鲸鱼娘      │ ───────────────────────► │  Codex 窗口  │
│  Electron    │   Runtime.evaluate       │  (Chromium)  │
└──────────────┘                          └──────────────┘
```

1. 启动时用 `--remote-debugging-port=9227` 拉起 Codex
2. 每 3.5 秒轮询一次 Codex 页面
3. **已注入时只发一条轻量 probe**，不重发几 MB 的 CSS / 图片 / 视频
4. 首次注入把素材编成 base64 data URI 一次性塞进去（约 7.7 MB）
5. 主题只改 CSS 变量、追加装饰层，**不接管 Codex 的业务逻辑与数据**

### 关于「黑色遮挡」

Codex 自己的工作区容器上有一层近黑底（`::before`，约 `#0d1117`），会整块盖住壁纸。
早期版本用写死的类名选择器去透明化它，但 Codex 的类名带**构建哈希**
（形如 `_WorkspaceContent_etoz9_2`），**换机器 / 换版本就失效**，黑底回归。

现在改为**运行时检测**，不依赖任何类名：

- 网格采样 16 个点 → `elementsFromPoint` 取每个点的完整绘制栈
- 对大面积元素（面积 ≥ 18% 视口）检查 `::before` / `::after` 与自身的
  `background-color`、渐变最暗色、`backdrop-filter: brightness(0.x)`
- 命中就打标记，由一条 CSS 统一透明化；每 4 秒复查一次
- 每约 48 秒补一次 DOM 扫描，专门抓 `pointer-events: none` 的遮罩
  （命中测试返回不到这类元素）

---

## 📁 目录结构

```
鲸鱼娘/
├─ app/                          # 应用源码（对应安装后的 resources/app）
│  ├─ main.cjs                   # 入口：托盘、启动编排、设置
│  ├─ preload.cjs / splash.*     # 启动闪屏
│  ├─ codex/
│  │  ├─ integration.cjs         # 集成层：托盘菜单、Codex 编排、主题切换、用量播报
│  │  ├─ theme.cjs               # 主题控制器：CDP 注入、多主题分发、运行时去黑
│  │  ├─ intro-main.cjs / intro.*# 启动动画（独立进程，保留 GPU 解码）
│  │  ├─ panel.* / usage-*.cjs   # 用量面板与统计读取
│  │  ├─ themes/
│  │  │  ├─ shorekeeper/         # 守岸人 · 夜海
│  │  │  └─ midnight-deepseek/   # 深夜大肥鱼 · 雨夜
│  │  └─ intros/                 # 启动动画，丢视频进来即可
│  └─ vendor/dsh-pet/             # 第三方桌宠内核（MIT）
├─ packaging/                    # electron-builder 打包配置与脚本
├─ docs/                          # 文档
├─ .github/                       # Issue / PR 模板
└─ LICENSE · README.md · CHANGELOG.md · SECURITY.md · CONTRIBUTING.md
```

---

## 🛠 打包自己的安装包

```bash
cd packaging
npm install
npm run build          # electron-builder --win --x64 --prepackaged ./WhaleGirl
```

产物在 `packaging/dist/WhaleGirl-<版本>-Setup.exe（中文名版：鲸鱼娘-<版本>-安装版.exe）`。

> `packaging/WhaleGirl/` 是 Electron 运行时工作副本（含二进制），
> 已加入 `.gitignore`，构建脚本会自动从源码同步 `app/` 进去。

---

## ❓ 常见问题

**Q：主题没生效？**
确认是从托盘「打开 Codex × 守岸人」启动的 Codex —— 只有带调试端口启动时才能注入。
若 Codex 已先手动打开，关掉重来一次。

**Q：壁纸位置不对 / 动画不贴合窗口？**
托盘「重播启动动画」会重新跟踪 Codex 窗口位置（`window-tracker.ps1`）。

**Q：桌宠能关掉吗？**
托盘图标右键 → 退出。桌宠、主题、动画、自启都可以单独开关。

**Q：会不会影响 Codex 的功能？**
不会。只注入 CSS 与独立的装饰层，不读改 Codex 的业务数据，
用量面板读取的是你本机 `.codex` 与 CC Switch 的已有文件（只读）。

**Q：视频壁纸有声音吗？**
没有。「深夜大肥鱼」主题的视频被强制静音，只有点击桌宠时才会有音效。

---

## 🔒 隐私

- 全部数据存于本机 `安装目录\data\`，**不联网上传**
- 天气为唯一外部请求：向 `api.open-meteo.com` 请求当前气温与天气码，
  **不含任何本机标识**，可用托盘开关关掉（关掉后 HUD 只显示时间日期）

---

## 🙏 致谢与声明

- 桌宠内核 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) · MIT · Copyright (c) 2026 PC2005-cloud
- 运行时 [Electron](https://www.electronjs.org/) · MIT
- 天气数据 [Open-Meteo](https://open-meteo.com/)（免费非商用）

**关于素材**：仓库内附带的美工与视频素材为演示用途，
其中涉及的角色形象（如守岸人）权利归原权利人所有，
**不在 MIT 许可范围内**。二次分发或商用前请替换为自有素材。
详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

---

## 📄 许可

代码部分采用 **MIT** 许可，详见 [LICENSE](./LICENSE)。

```
Copyright (c) 2026 YuRu0
```

---

<div align="center">

如果这个小东西让你写代码时心情好了一点，给个 ⭐ 吧。

</div>
