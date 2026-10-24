# 鲸鱼娘 v1.3.3

> 下载：`鲸鱼娘-1.3.3-安装版.exe`（Windows x64）

## 🐛 本次修复

**解决了「深夜大肥鱼」主题在部分电脑上仍然出现黑色遮挡的问题。**

那块黑色不是主题画的，而是 **Codex 自己**在工作区容器上用 `::before` 铺的一层近黑底
（约 `#0d1117`），会整块盖住壁纸。

之前的修法是用写死的类名选择器去透明化它：

```css
[class*="_WorkspaceContent_"]::before { background: transparent !important; display: none !important; }
```

但 Codex 的 CSS-module 类名带**构建哈希**（我这边是 `_WorkspaceContent_etoz9_2`），
**别人的 Codex 版本不同 → 类名不同 → 选择器直接失效 → 黑底回归**。

所以上一版"在我电脑上好了"是巧合 —— 我电脑上恰好是这个哈希。

### 现在的做法：不认名字，只认特征

注入到 Codex 页面里的运行时检测：

- 采样 4×4 网格 → `elementsFromPoint` 取每个点的**完整绘制栈**
- 对大面积元素（面积 ≥ 18% 视口）检查 `::before` / `::after` 及自身的
  `background-color`、渐变最暗色、`backdrop-filter: brightness(0.x)`
- 判定为「不透明深色大被子」就打标记，一条 CSS 统一透明化
- 每 4 秒复查；约 16 秒清一次缓存，应对 Codex 晚渲染
- 约 48 秒补一次 DOM 扫描，抓 `pointer-events: none` 的遮罩

**不依赖任何类名、任何 Codex 版本号。**

## ✅ 验证

| 项目 | 结果 |
| --- | --- |
| 纯色近黑底 `::before` | 自动清除 |
| 深色渐变 `::before` | 自动清除 |
| 元素自身大面积黑底 | 自动清除 |
| `backdrop-filter` 压暗 | 自动清除 |
| `pointer-events: none` 遮罩 | 自动清除（靠 DOM 扫描） |
| 真实 Codex 界面误伤 | 0 |

截图主内容区平均亮度：修复前 **45.6**（采样几乎全是 16，即 `#0d1117`）→ 修复后 **136.8**。

## 📌 说明

- 安装包未签名，SmartScreen 会提示，选「更多信息 → 仍要运行」
- 若 Codex 是手动先打开的，主题不会注入 —— 请从托盘「打开 Codex × 守岸人」启动
