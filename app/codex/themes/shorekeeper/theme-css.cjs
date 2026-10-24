'use strict';
// 守岸人主题 v4：夜海玻璃 + 淡金细线。只改颜色/背景/描边，不改 Codex 的布局。
module.exports = function themeCss({ logo, background, portrait }) {
  return `
:root[data-theme="dark"] {
  --color-surface-primary: #08131f;
  --color-surface-secondary: #050c15;
  --color-surface-tertiary: #0c1c2c;
  --color-token-main-surface-primary: rgba(7, 18, 31, .78);
  --color-token-input-background: rgba(9, 24, 40, .72);
  --color-token-editor-background: rgba(6, 16, 28, .82);
  --color-token-menu-background: rgba(8, 20, 34, .96);
  --color-token-dropdown-background: rgba(8, 20, 34, .96);
  --sk-gold: #e8d5a0;
  --sk-ice: #9fe3ff;
  --sk-line: rgba(232, 213, 160, .16);
  --sk-line-strong: rgba(232, 213, 160, .34);
}

html[data-whale-theme="on"] body {
  background:
    radial-gradient(ellipse 70% 55% at 78% 8%, rgba(159, 227, 255, .10), transparent 60%),
    radial-gradient(ellipse 60% 50% at 10% 100%, rgba(232, 213, 160, .07), transparent 60%),
    linear-gradient(160deg, #081422 0%, #050b14 55%, #03070d 100%) !important;
}
html[data-whale-theme="on"] #root { position: relative !important; z-index: 1 !important; }

/* 主内容区与侧栏：半透明玻璃，让底下的星空和立绘透出来 */
html[data-whale-theme="on"] main[class*="_MainContentSurface_"] {
  background: linear-gradient(180deg, rgba(8, 20, 34, .62), rgba(5, 13, 23, .74)) !important;
  border-left: 1px solid var(--sk-line) !important;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, .03) !important;
}
html[data-whale-theme="on"] aside, html[data-whale-theme="on"] nav { background-color: transparent !important; }
html[data-whale-theme="on"] [class*="bg-token-bg-elevated-secondary"], html[data-whale-theme="on"] [class*="bg-token-main-surface"] {
  background-color: rgba(10, 26, 42, .55) !important;
}

/* 输入框：深色玻璃 + 淡金描边，聚焦时冰蓝光晕 */
html[data-whale-theme="on"] div:has(> .ProseMirror) {
  background: linear-gradient(180deg, rgba(14, 34, 52, .80), rgba(7, 19, 32, .90)) !important;
  border: 1px solid var(--sk-line) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .04), 0 12px 36px rgba(0, 0, 0, .28) !important;
  transition: border-color .25s ease, box-shadow .25s ease;
}
html[data-whale-theme="on"] div:has(> .ProseMirror):focus-within {
  border-color: var(--sk-line-strong) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05), 0 0 0 3px rgba(159, 227, 255, .07), 0 14px 40px rgba(0, 0, 0, .32) !important;
}
html[data-whale-theme="on"] [class*="bg-background-composer-action-bar"] { background-color: rgba(8, 22, 36, .90) !important; }

/* 选中文字、滚动条、焦点环 */
html[data-whale-theme="on"] ::selection { background: rgba(159, 227, 255, .26); color: #fff; }
html[data-whale-theme="on"] ::-webkit-scrollbar { width: 9px; height: 9px; }
html[data-whale-theme="on"] ::-webkit-scrollbar-thumb { background: rgba(232, 213, 160, .16); border-radius: 9px; border: 2px solid transparent; background-clip: padding-box; }
html[data-whale-theme="on"] ::-webkit-scrollbar-thumb:hover { background-color: rgba(232, 213, 160, .30); }
html[data-whale-theme="on"] ::-webkit-scrollbar-track { background: transparent; }
html[data-whale-theme="on"] :focus-visible { outline-color: rgba(159, 227, 255, .55) !important; }
html[data-whale-theme="on"] a { color: #a9e6ff; }
html[data-whale-theme="on"] code:not(pre code) { background: rgba(159, 227, 255, .08) !important; border: 1px solid rgba(159, 227, 255, .10); }
html[data-whale-theme="on"] pre { background: rgba(4, 12, 21, .82) !important; border: 1px solid var(--sk-line) !important; }

/* 背景：黑海岸星空，压暗、慢呼吸 */
#shorekeeper-theme-background {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(4, 10, 18, .55), rgba(4, 10, 18, .88) 70%),
    url("${background}") center 30% / cover no-repeat;
  opacity: .7; filter: saturate(.95) brightness(.9);
  animation: sk-breathe 18s ease-in-out infinite alternate;
}
/* 立绘：右下角，向左向上渐隐，不挡正文 */
#shorekeeper-theme-character {
  position: fixed; right: -2vw; bottom: -4vh; z-index: 0; pointer-events: none;
  width: min(34vw, 560px); height: 96vh;
  background: url("${portrait}") right bottom / contain no-repeat;
  opacity: .34;
  -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 38%), linear-gradient(0deg, #000 70%, transparent 100%);
  -webkit-mask-composite: source-in; mask-composite: intersect;
  filter: saturate(.85) brightness(1.08) drop-shadow(0 0 30px rgba(159, 227, 255, .12));
}

/* 装饰层：星点、海面微光、右下角徽记 */
#whale-theme-overlay { position: fixed; inset: 0; z-index: 2; pointer-events: none; overflow: hidden; }
#whale-theme-overlay::before {
  content: ""; position: absolute; inset: -20%;
  background:
    radial-gradient(1px 1px at 12% 22%, rgba(220, 240, 255, .55), transparent 60%),
    radial-gradient(1px 1px at 34% 68%, rgba(232, 213, 160, .45), transparent 60%),
    radial-gradient(1.3px 1.3px at 68% 18%, rgba(220, 240, 255, .5), transparent 60%),
    radial-gradient(1px 1px at 86% 54%, rgba(220, 240, 255, .4), transparent 60%),
    radial-gradient(1px 1px at 52% 86%, rgba(232, 213, 160, .35), transparent 60%);
  background-size: 640px 640px; opacity: .55;
  animation: sk-drift 120s linear infinite;
}
#whale-theme-overlay::after {
  content: ""; position: absolute; right: 22px; bottom: 16px; width: 56px; height: 56px;
  background: url("${logo}") center / cover no-repeat; border-radius: 50%;
  border: 1px solid var(--sk-line-strong); opacity: .22;
  box-shadow: 0 0 18px rgba(159, 227, 255, .18);
}
#whale-theme-overlay .whale-scan {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22vh;
  background: linear-gradient(0deg, rgba(159, 227, 255, .045), transparent);
  -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 2px, transparent 2px 6px);
  opacity: .7; animation: sk-tide 9s ease-in-out infinite alternate;
}
@keyframes sk-breathe { to { opacity: .8; transform: scale(1.03); } }
@keyframes sk-drift { to { transform: translate(-640px, -320px); } }
@keyframes sk-tide { to { opacity: .35; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) {
  #shorekeeper-theme-background, #whale-theme-overlay::before, #whale-theme-overlay .whale-scan { animation: none; }
}
`;
};
