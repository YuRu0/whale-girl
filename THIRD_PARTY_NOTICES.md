# 第三方组件与素材声明 / Third-Party Notices

本仓库由**作者原创代码**、**第三方开源组件**与**美术 / 音视频素材**三部分组成。
三者的授权主体不同，请分别遵守。

---

## 一、第三方开源组件（代码）

### dsh-pet

- 项目：<https://github.com/PC2005-cloud/dsh-pet>
- 许可：MIT
- 版权：Copyright (c) 2026 PC2005-cloud
- 位置：`app/vendor/dsh-pet/`
- 许可证全文：`app/vendor/dsh-pet/LICENSE`

### Electron

- 项目：<https://www.electronjs.org/>
- 许可：MIT
- 版本：43.3.0（打包运行时）

### Node.js 内置模块

仅使用 Node 标准库，无额外授权义务。

---

## 二、美术与音视频素材 ⚠️

> **本仓库中的素材不受 MIT 许可授权。**

| 素材 | 位置 | 说明 |
| --- | --- | --- |
| 守岸人立绘 / 背景 / 头像 | `app/codex/themes/shorekeeper/assets/` | 角色形象权利归原权利人（库洛游戏《鸣潮》）所有，本仓库仅作技术演示 |
| 启动动画 | `app/codex/intros/default-shorekeeper.mp4` | 同上，演示用途 |
| 雨夜壁纸视频 / 封面 | `app/codex/themes/midnight-deepseek/assets/` | 请确认来源与再分发权限后再分发 |
| 桌宠动画资源 | `app/vendor/dsh-pet/assets/` | 随 dsh-pet（MIT）分发，但美术资源授权以 dsh-pet 仓库为准 |
| 点击音效 | `app/vendor/dsh-pet/assets/sfx/click-pop.wav` | 本仓库新增，可自由使用 |

### 建议

如果你要：

- **二次分发**（Fork、镜像、打包含素材的安装包）→ 请先删除或替换上述素材
- **商用** → 必须替换为自有或已获授权素材
- **只是自己用** → 无需处理

**删除素材后主题依然可用**，只是对应主题的背景区域会变成纯色/空背景，
再把自己的图片/视频放回同名路径即可恢复。

---

## 三、外部服务

### Open-Meteo（天气）

- 站点：<https://open-meteo.com/>
- 用途：获取 HUD 上的实时气温与天气码
- 请求内容：仅经纬度（默认兰州），**不含任何设备或用户标识**
- 授权：免费用于非商业用途，详见其官网条款
- **可关闭**：托盘「天气」开关关掉后不再发起任何请求

---

## 四、与 Codex 的关系

- 本项目**不是** OpenAI 官方项目，与 OpenAI 无任何隶属或背书关系
- Codex 为 OpenAI 的产品，其商标与代码权利归 OpenAI 所有
- 本项目通过 Codex 自带的 Chromium 调试端口（`--remote-debugging-port=9227`）
  在本地注入样式，**不修改、不分发、不逆向 Codex 的任何文件**
- 主题可能随 Codex 版本更新而失效，本项目不保证对特定 Codex 版本的兼容性

---

## 五、许可摘要

```
鲸鱼娘 / WhaleGirl
├─ 原创代码（app/ 下除 vendor/ 外）      → MIT  © 2026 YuRu0
├─ vendor/dsh-pet/ 代码                   → MIT  © 2026 PC2005-cloud
├─ 美术 / 音视频素材                       → 权利归各自权利人，不在 MIT 范围内
└─ Electron 运行时                        → MIT
```

完整许可文本见 [LICENSE](./LICENSE)。
