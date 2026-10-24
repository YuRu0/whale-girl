# 贡献指南 / Contributing

谢谢你愿意花时间改进鲸鱼娘 🐟

这是一个个人小项目，流程刻意保持简单，别被格式吓到 ——
**能跑起来、说清楚改了什么，就够了。**

---

## 开始前

1. Fork 本仓库，切一个分支：

   ```bash
   git checkout -b feat/你的功能名
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 确认能跑起来再动手改（`npm start`）。

### 环境要求

| 项目 | 版本 |
| --- | --- |
| 操作系统 | Windows 10/11 x64 |
| Node.js | ≥ 20 |
| Electron 运行时 | 43.3.0 |
| Codex 桌面端 | 需支持 `--remote-debugging-port` |

---

## 你可以贡献什么

| 类型 | 说明 |
| --- | --- |
| 🐛 修 Bug | 请先开 Issue 确认，避免重复劳动 |
| 🎨 **新主题** | 最欢迎！见下方「新增主题」 |
| 🎬 启动动画 | 提供原创素材（注意版权） |
| 📖 文档 | 修正错字、补充 FAQ |
| 🌐 翻译 | README / 界面文案 |

---

## 提交规范

提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(theme): 新增「晨雾」主题
fix(theme): 修复切换主题后背景残留
docs(readme): 补充打包步骤
chore(deps): 升级 electron-builder
```

常用前缀：`feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `chore`

---

## 代码风格

- 缩进 2 空格，语句结尾不加多余分号也可，但同文件保持一致
- 优先 `const`，需要重赋值再用 `let`，**不用 `var`**
- 注入到 Codex 页面的脚本是**字符串形式的 IIFE**，改动时记得：
  - 模板字符串里的正则要写成 `\\(`（转义一次）
  - 不要在里面用 ES2020+ 新语法，保持兼容性
- 主题相关改动**必须升 `DEEPSEEK_STYLE_VERSION`**，否则已注入的客户端不会重新拉取样式

---

## 新增主题

1. 在 `app/codex/themes/` 下建目录，例如 `themes/my-theme/`
2. 放 `theme-css.cjs`：导出 `(params) => cssString`
3. 放素材到 `themes/my-theme/assets/`
4. 在 `theme.cjs` 的 `THEME_IDS` 数组里加上 id
5. 在 `theme.cjs` 里加对应的 `xxxThemeExpression()`，并在 `themeExpression()` 里分发
6. 在 `integration.cjs` 的托盘「界面主题」子菜单里加一个 radio 项
7. 把清理逻辑同步补进 `removeTheme()` 的元素 id 列表

主题素材统一用 `this.themeAsset(themeId, 相对路径)` 读取，结果会缓存成 data URI。

> ⚠️ **请只提交你有权分发的素材**（原创 / 已授权 / 公共领域）。
> 不要提交游戏、动漫的官方美术资源。

---

## Pull Request 检查清单

- [ ] 在本机实际跑过，确认功能正常
- [ ] 没有把 `安装目录/data/` 里的个人数据、日志提交进来
- [ ] 没有硬编码密钥、Token、个人路径
- [ ] 改了主题 CSS → 已升 `styleVersion`
- [ ] 涉及 UI 变化 → 附了截图

---

## 行为准则

参与本项目即视为同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

---

有问题直接开 [Issue](../../issues) 问就行，不用客气。
