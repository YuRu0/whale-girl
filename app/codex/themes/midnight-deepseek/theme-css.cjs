'use strict';
// 深夜大肥鱼主题 v6：只铺壁纸 + 挂 HUD，不碰 Codex 的界面配色（回到"打包前那个正常版本"的做法）。
// 关键：Codex 工作区容器（[class*="_WorkspaceContent_"]）自带一个近黑底 ::before（#0d1117），
// 会整块盖住壁纸——必须透明化。此前几轮调"玻璃层"参数全都压在这张黑底之下，所以怎么调都没变化。
module.exports = function deepseekThemeCss({ video, poster, clockSize }) {
  const cs = Number(clockSize) || 92;
  return `
/* 壁纸视频：铺满全屏，不施加任何压暗/滤镜 */
#deepseek-wallpaper-video {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  width: 100%; height: 100%; object-fit: cover;
  background: #060c16 url("${poster}") center / cover no-repeat;
}
/* 界面始终盖在壁纸之上 */
html[data-deepseek-wallpaper="on"] #root { position: relative !important; z-index: 1 !important; }

/* ── 关键修复：Codex 工作区自带的近黑底（::before #0d1117）会整块涂黑主内容区 ── */
[class*="_WorkspaceContent_"]::before { background: transparent !important; display: none !important; }
/* 侧栏保持透明，让壁纸完整透出 */
html[data-deepseek-wallpaper="on"] aside, html[data-deepseek-wallpaper="on"] nav { background-color: transparent !important; }

/* HUD：时钟 / 日期 / 氛围文案 / 天气 */
#deepseek-hud {
  position: fixed; left: 76px; top: 64px; z-index: 2; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
  animation: ds-fade-in 1.1s ease-out both;
}
#deepseek-clock {
  font-size: ${cs}px; font-weight: 200; line-height: 1;
  letter-spacing: .04em; font-variant-numeric: tabular-nums;
  color: #eef7ff;
  text-shadow: 0 2px 26px rgba(90, 170, 255, .35), 0 2px 10px rgba(0, 0, 0, .65);
}
#deepseek-clock .ds-colon { display: inline-block; animation: ds-blink 2s step-end infinite; }
#deepseek-date {
  font-size: 25px; font-weight: 400; letter-spacing: .08em;
  color: rgba(238, 247, 255, .92);
  text-shadow: 0 1px 12px rgba(0, 0, 0, .6);
}
#deepseek-greeting {
  font-size: 17px; font-weight: 400; letter-spacing: .12em;
  color: #9fe3ff; opacity: .82;
  text-shadow: 0 1px 10px rgba(0, 0, 0, .55);
}
#deepseek-weather {
  font-size: 21px; font-weight: 400; letter-spacing: .06em;
  color: rgba(238, 247, 255, .88);
  text-shadow: 0 1px 12px rgba(0, 0, 0, .6);
  transition: opacity .8s ease;
}
#deepseek-weather[data-hidden="1"] { opacity: 0; }

@keyframes ds-fade-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ds-blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) {
  #deepseek-hud { animation: none; }
  #deepseek-clock .ds-colon { animation: none; }
}
`;
};
