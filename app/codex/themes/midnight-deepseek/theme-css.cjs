'use strict';
module.exports=({poster})=>`
#deepseek-wallpaper-video {position:fixed;inset:0;z-index:0;pointer-events:none;width:100%;height:100%;object-fit:cover;filter:saturate(.72) brightness(.78);background:#111923 url("${poster}") center/cover no-repeat;}
#deepseek-veil {position:fixed;inset:0;z-index:0;pointer-events:none;background:rgba(8,14,23,.25);}
html[data-deepseek-wallpaper="on"] #root {position:relative!important;z-index:1!important;}
html[data-deepseek-wallpaper="on"] [class*="WorkspaceContent"]::before {display:none!important;}
html[data-deepseek-wallpaper="on"] [class*="MainContentSurface"] {background:rgba(13,20,30,.55)!important;background-image:none!important;backdrop-filter:blur(7px)!important;}
html[data-deepseek-wallpaper="on"] [class*="WorkspaceContent"] {background:transparent!important;}
html[data-deepseek-wallpaper="on"] aside {background:rgba(12,19,29,.55)!important;backdrop-filter:blur(10px);}
html[data-deepseek-wallpaper="on"] [class*="MainContentLeftBorder"] {border-left-color:rgba(170,197,222,.16)!important;}
html[data-ds-appearance="light"] #deepseek-veil {background:rgba(234,240,245,.38);}
html[data-ds-appearance="light"] [class*="MainContentSurface"] {background:rgba(246,248,251,.87)!important;}
html[data-ds-appearance="light"] aside {background:rgba(242,246,250,.88)!important;}
#deepseek-hud {position:fixed;top:7px;left:50%;transform:translateX(-50%);z-index:2;pointer-events:none;display:flex;align-items:center;gap:12px;height:24px;max-width:280px;padding:0 12px;border-radius:8px;background:rgba(10,18,28,.55);color:#edf2f7;white-space:nowrap;font-family:system-ui,sans-serif;}
#deepseek-hud[hidden] {display:none!important;}
#deepseek-clock {font-size:16px;font-weight:550;line-height:1;letter-spacing:.03em;font-variant-numeric:tabular-nums;color:#f3f7fb;}
#deepseek-date {font-size:11px;line-height:1.2;color:#d2deeb;}
#deepseek-greeting,#deepseek-weather {display:none;}
#deepseek-clock .ds-colon {animation:none;}
@media(max-width:999px){#deepseek-hud{display:none!important;}}
@media(prefers-reduced-motion:reduce){#deepseek-hud{animation:none!important;}}
`;
