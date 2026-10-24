'use strict';
// Codex × 守岸人 启动动画：独立进程（保留 GPU 解码）。
// 动画窗口贴在 Codex 窗口内容区上，代替 Codex 自己的加载图标；Codex 窗口移动/缩放时跟随。
//
// 与主进程的协议：
//   stdout  INTRO:prepared / INTRO:playing / INTRO:hold / INTRO:reveal / INTRO:done / INTRO:error / INTRO:release-ack
//   HTTP    轮询 --intro-ready-url，主进程把 codexReady 置 true 后才放行（stdin 在 Electron 主进程不可靠，仅作备用）
//
// 两道防线解决首次启动黑屏：
//   1. 窗口在视频首帧可上屏（intro:prepared）之前绝不 show，且 show 时从透明淡入；
//   2. 片子在终幕溶解前定帧等待主进程放行，动画时长自动 >= Codex 冷启动时长。
const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const muted = process.argv.includes('--intro-muted');
const TITLEBAR = 36;   // Codex 自绘标题栏高度（DIP），动画只盖住下面的内容区
// 等待 Codex 窗口的宽限期。超过就先以居中窗口开播，等 Codex 窗口出现再贴合。
// 默认给短（1.2s）：等太久用户会先看到 Codex 自己的黑色空窗，观感就是"先出来一个大黑框"。
const FALLBACK_WAIT = Math.max(400, Number(process.env.WHALE_INTRO_FALLBACK_MS || 1200));
const say = (s) => { try { process.stdout.write(`${s}\n`); } catch {} };

// 可换片：主进程用 --intro-file=intros/xxx.mp4 指定片子（相对 codex 目录）；
// 没给、或给的文件不存在时，渲染进程直接用 intro.html 里的内置默认片。
const INTRO_FILE = (() => {
  const raw = (process.argv.find((a) => a.startsWith('--intro-file=')) || '').slice('--intro-file='.length);
  if (!raw) return '';
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith('intros/') || decoded.includes('..')) return '';
    return require('node:fs').existsSync(require('node:path').join(__dirname, decoded)) ? decoded : '';
  } catch { return ''; }
})();

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const userData = process.argv.find((a) => a.startsWith('--intro-user-data='));
if (userData) app.setPath('userData', userData.slice('--intro-user-data='.length));

let win = null;
let prepared = false;     // 渲染进程首帧已上屏
let released = false;     // 主进程已放行
let armed = false;        // 已找到 Codex 窗口位置，随时可以开播
let playing = false;      // 已 show 并下发 intro:start
let revealed = false;
let closing = false;
let trackTimer = null;
let fadeTimer = null;
let holdCap = null;
let doneSaid = false;
let lastCdpAt = 0;
let lastBounds = '';
let bounds = null;

// ───── window-tracker.ps1 持续报告 Codex 主窗口位置（物理像素，转成 DIP） ─────
let tracked = null;   // { x, y, width, height } | 'MIN' | null
let tracker = null;
function startTracker() {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    tracker = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'window-tracker.ps1'), '-Restore'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; }
  let buf = '';
  tracker.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const l of lines) {
      const m = /^R (-?\d+) (-?\d+) (\d+) (\d+)/.exec(l);
      if (m) {
        const raw = { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
        if (!(raw.width > 200 && raw.height > 150)) { tracked = 'MIN'; continue; }
        try { tracked = screen.screenToDipRect(null, raw); } catch { tracked = raw; }
      } else if (l.startsWith('MIN')) tracked = 'MIN';
      else if (l.startsWith('NONE')) tracked = null;
    }
  });
  tracker.on('error', () => {});
}
function codexRect() {
  if (tracked === 'MIN') return { hidden: true };
  if (!tracked) return null;
  return {
    x: Math.round(tracked.x), y: Math.round(tracked.y + TITLEBAR),
    width: Math.round(tracked.width), height: Math.max(160, Math.round(tracked.height - TITLEBAR))
  };
}
function fallbackRect() {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.round(wa.width * 0.72), height = Math.round(width * 0.625);
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}
function place(b) {
  if (!win || win.isDestroyed() || !b) return;
  const key = `${b.x},${b.y},${b.width},${b.height}`;
  // 置顶等级用 screen-saver（TOPMOST 带内更高一层），防止 Codex 被激活后盖到动画上面
  try { if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  if (key !== lastBounds) {
    lastBounds = key;
    win.setBounds(b);
    if (process.env.WHALE_INTRO_DEBUG) say('INTRO:bounds ' + key + ' got ' + JSON.stringify(win.getBounds()));
  }
}

function reveal(reason) {
  if (revealed) return;
  revealed = true;
  say(`INTRO:reveal ${reason}`);
}

// ───── 显示：先透明铺到位，再淡入，绝不让未解码的黑窗露脸 ─────
function showAndPlay() {
  if (playing || closing || !win || win.isDestroyed()) return;
  if (!armed || !prepared) return;
  playing = true;
  place(bounds || fallbackRect());
  try { win.setOpacity(0); } catch {}
  win.show();
  win.focus();
  win.moveTop();
  const t0 = Date.now();
  clearInterval(fadeTimer);
  fadeTimer = setInterval(() => {
    if (!win || win.isDestroyed() || closing) { clearInterval(fadeTimer); return; }
    const u = Math.min(1, (Date.now() - t0) / 220);
    try { win.setOpacity(u); } catch {}
    if (u >= 1) clearInterval(fadeTimer);
  }, 16);
  win.webContents.send('intro:start');
  startReadyPoll();   // 播放期间持续问主进程：就绪了吗 + Codex 窗口在哪
  say('INTRO:playing');
}

function sayDone() {
  if (doneSaid) return;
  doneSaid = true;
  say('INTRO:done');
}

function finish(fadeMs = 420) {
  if (closing) return;
  closing = true;
  reveal('finish');
  clearInterval(fadeTimer);
  clearTimeout(holdCap);
  clearInterval(pollTimer);
  const w = win;
  const t0 = Date.now();
  const base = (() => { try { return w && !w.isDestroyed() ? w.getOpacity() : 1; } catch { return 1; } })();
  const tick = setInterval(() => {
    const u = Math.min(1, (Date.now() - t0) / Math.max(60, fadeMs));
    if (w && !w.isDestroyed()) { try { w.setOpacity(base * (1 - u)); } catch {} }
    if (u >= 1) {
      clearInterval(tick);
      clearInterval(trackTimer);
      try { globalShortcut.unregisterAll(); } catch {}
      try { tracker && tracker.kill(); } catch {}
      sayDone();
      if (w && !w.isDestroyed()) w.destroy();
      app.exit(0);
    }
  }, 16);
}

// ───── 主进程放行通道 ─────
// 主通道是 HTTP 轮询（Electron 主进程的 process.stdin 在 Windows 上收不到管道数据，不能依赖）；
// stdin 只作为顺带的快速通道保留。
const readyUrl = (process.argv.find((a) => a.startsWith('--intro-ready-url=')) || '').slice('--intro-ready-url='.length);
function applyRect(rect, why) {
  if (!rect || closing) return;
  const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
  const changed = key !== lastBounds;
  bounds = rect;
  if (!armed) {
    armed = true;
    lastBounds = '';
    place(rect);
    if (process.env.WHALE_INTRO_DEBUG) say(`INTRO:cdp-rect ${key} ${why} (arm)`);
    showAndPlay();
  } else if (playing) {
    place(rect);
    if (changed && process.env.WHALE_INTRO_DEBUG) say(`INTRO:cdp-rect ${key} ${why}`);
    if (win && !win.isDestroyed()) { try { win.moveTop(); } catch {} }
  }
}

function toContentRect(b) {
  return {
    x: Math.round(b.x), y: Math.round(b.y + TITLEBAR),
    width: Math.round(b.width), height: Math.max(160, Math.round(b.height - TITLEBAR))
  };
}

let pollTimer = null;
let everNormal = false;   // Codex 窗口是否至少正常显示过一次（防冷启动期间误判最小化）
function startReadyPoll() {
  if (!readyUrl || pollTimer) return;
  pollTimer = setInterval(async () => {
    if (closing) { clearInterval(pollTimer); pollTimer = null; return; }
    try {
      const res = await fetch(readyUrl, { cache: 'no-store' });
      const data = await res.json();
      const b = data && data.bounds;
      if (b && b.width > 50) {
        if (b.state === 'minimized') {
          // 只有窗口曾经正常显示过，之后被最小化才算"用户主动收起"；冷启动早期的 hidden 不算
          if (playing && everNormal) finish(250);
        } else {
          everNormal = true;
          lastCdpAt = Date.now();
          applyRect(toContentRect(b), 'cdp');
        }
      }
      if (data && data.ready === true) requestRelease('http-poll');
    } catch {}
  }, 400);
}

function requestRelease(why) {
  if (released) return;
  released = true;
  clearInterval(pollTimer); pollTimer = null;
  say(`INTRO:release-ack ${why}`);
  if (prepared && win && !win.isDestroyed()) { try { win.webContents.send('intro:release'); } catch {} }
}
try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    const s = String(d);
    if (/\bRELEASE\b/.test(s)) requestRelease('stdin');
    if (/\bSKIP\b/.test(s)) finish(300);
  });
  process.stdin.on('error', () => {});
  process.stdin.resume();
} catch {}

app.whenReady().then(() => {
  startTracker();
  win = new BrowserWindow({
    ...fallbackRect(),
    frame: false, show: false, resizable: false, movable: false, skipTaskbar: true, roundedCorners: true,
    alwaysOnTop: true, backgroundColor: '#05090f', hasShadow: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'intro-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenu(null);
  try { win.setOpacity(0); } catch {}
  win.loadFile(path.join(__dirname, 'intro.html'), {
    query: INTRO_FILE ? { muted: muted ? '1' : '0', file: encodeURIComponent(INTRO_FILE) } : { muted: muted ? '1' : '0' }
  });
  if (INTRO_FILE) say(`INTRO:file ${INTRO_FILE}`);

  // 等 Codex 窗口出现（冷启动可能要十几秒），找到就贴上去开播；找不到才居中播放。
  // 首选来源是 CDP 轮询（startReadyPoll），这里的 PowerShell 跟踪器只作兜底。
  const waitStart = Date.now();
  trackTimer = setInterval(() => {
    if (closing || !win || win.isDestroyed()) return;
    const r = codexRect();
    if (r && !r.hidden) {
      if (Date.now() - lastCdpAt < 2000) return;   // CDP 两秒内有新鲜坐标，以它为准
      applyRect(r, 'ps');
    } else if (r && r.hidden && playing && everNormal && Date.now() - lastCdpAt > 2000) {
      finish(250);   // 播放中 Codex 被最小化：直接结束
    } else if (!armed && Date.now() - waitStart > FALLBACK_WAIT) {
      armed = true;
      bounds = fallbackRect();
      place(bounds);
      showAndPlay();
    }
  }, 33);

  // 跳过：Esc / 空格 / 回车（全局注册，Codex 抢到焦点后按键依然有效）
  for (const key of ['Escape', 'Space', 'Enter']) {
    try { globalShortcut.register(key, () => finish(300)); } catch {}
  }

  ipcMain.on('intro:prepared', () => {
    if (prepared) return;
    prepared = true;
    say('INTRO:prepared');
    startReadyPoll();   // 尽早开始拿 Codex 窗口位置，armed 也能靠它
    if (released) { try { win.webContents.send('intro:release'); } catch {} }
    showAndPlay();
  });
  ipcMain.on('intro:hold', (_e, at) => {
    say(`INTRO:hold ${at || ''}`.trim());
    startReadyPoll();   // 开始问主进程"Codex 画好了没"
    // 兜底：即使主进程一直不给就绪信号，定帧最多等 45 秒
    clearTimeout(holdCap);
    holdCap = setTimeout(() => { say('INTRO:hold-timeout'); requestRelease('hold-timeout'); }, 45000);
  });
  ipcMain.on('intro:reveal', (_e, reason) => reveal(String(reason || 'timeline')));
  ipcMain.on('intro:end', () => finish(650));
  ipcMain.on('intro:skip', () => finish(300));
  ipcMain.on('intro:error', (_e, msg) => { say(`INTRO:error ${String(msg).slice(0, 200)}`); finish(200); });

  // 首帧迟迟没上屏：不再干等，直接收场，让 Codex 露出来而不是留一个黑窗
  setTimeout(() => { if (!closing && !prepared) { say('INTRO:error prepare-timeout'); finish(150); } }, 15000);
  // 兜底：等窗口 + 播放 + 定帧等待，任何情况下 150 秒内退出
  setTimeout(() => finish(400), 150000);
});
app.on('will-quit', () => {
  clearInterval(fadeTimer);
  try { tracker && tracker.kill(); } catch {}
});
app.on('window-all-closed', () => { sayDone(); app.exit(0); });
