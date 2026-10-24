'use strict';
// 时间点与动画工程 comp/seek.js 一致：片尾有一段"溶进夜色"的收束（DIS → DURATION）。
// 定帧保持点取 DIS 之前，按片长比例算，这样重渲染后（12.4s / 18s）都不用改代码。
//   HOLD_RATIO = 0.914 → 12.4s 片 = 11.33s（DIS 11.32）；18.0s 片 = 16.45s（DIS 16.50）
// 片子在 HOLD_AT 定帧等待，直到主进程确认 Codex 界面已经画出来才放行，
// 因此动画时长永远 >= Codex 冷启动时长，也永远不会停在画面转黑的那一段。
const HOLD_RATIO = 0.914;

const v = document.getElementById('v');
const hint = document.getElementById('hint');
const qs = new URLSearchParams(location.search);
const muted = qs.get('muted') === '1';

// 可换片：主进程把选中的动画以 ?file= 传进来（相对 codex 目录的路径）。
// 定帧点 HOLD_RATIO 是按片长比例算的，所以换成任意时长的片子都不用改这里的逻辑。
const customSrc = qs.get('file');
if (customSrc) {
  try {
    const decoded = decodeURIComponent(customSrc);
    // 只允许 intros/ 下的文件，避免被塞进任意本地路径
    if (decoded.startsWith('intros/') && !decoded.includes('..')) v.src = decoded;
  } catch {}
}

let prepared = false;   // 首帧是否已可上屏
let released = false;   // 主进程是否已放行
let holding = false;    // 是否正在定帧等待
let revealed = false;   // 是否已通知 Codex 接管
let finishing = false;
let timer = null;
let HOLD_AT = null;

v.muted = muted;
v.volume = 0.8;

function holdAt() {
  if (HOLD_AT != null) return HOLD_AT;
  const forced = parseFloat(qs.get('hold'));
  if (Number.isFinite(forced) && forced > 0) { HOLD_AT = forced; return HOLD_AT; }
  const d = Number.isFinite(v.duration) && v.duration > 1 ? v.duration : 12.4;
  HOLD_AT = Math.max(1, d * HOLD_RATIO);
  return HOLD_AT;
}

// ───── 首帧握手 ─────
// 注意：窗口在这之前是 show:false，隐藏窗口里 requestAnimationFrame 不跑，
// 所以这里一律用 setTimeout，绝不能用 rAF 等"上屏"。
// 另外片头 0~0.5s 本身就是近乎全黑的星海，直接从 0 播会让窗口"先黑一下"，
// 所以先把进度 seek 到 0.55s（顶栏已亮起），窗口露出来的第一眼就是有内容的画面。
const START_AT = 0.55;
function markPrepared() {
  if (prepared) return;
  prepared = true;
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    setTimeout(() => { try { window.intro.prepared(); } catch {} }, 0);
  };
  if (Number.isFinite(v.duration) && Math.abs(v.currentTime - START_AT) > 0.05) {
    v.addEventListener('seeked', send, { once: true });
    try { v.currentTime = START_AT; } catch { send(); }
    setTimeout(send, 2500);   // seek 卡住的兜底
  } else send();
}
function whenFirstFrame(cb) {
  let done = false;
  const fire = () => { if (done) return; done = true; cb(); };
  if (v.readyState >= 3) fire();                                   // HAVE_FUTURE_DATA
  v.addEventListener('canplay', fire, { once: true });
  v.addEventListener('loadeddata', () => { if (v.readyState >= 2) setTimeout(fire, 120); }, { once: true });
  setTimeout(fire, 6000);                                          // 兜底
}
whenFirstFrame(markPrepared);

// ───── 播放与保持 ─────
function enterDissolve() {
  if (revealed || finishing) return;
  revealed = true;
  document.body.classList.remove('holding');
  try { window.intro.reveal('dissolve'); } catch {}
  play();
}

function enterHold() {
  if (holding || revealed || finishing) return;
  if (released) { enterDissolve(); return; }
  holding = true;
  clearTimeout(timer);
  try { v.pause(); } catch {}
  document.body.classList.add('holding');
  hint.classList.remove('on');
  try { window.intro.hold(v.currentTime.toFixed(2)); } catch {}
}

function watch() {
  if (holding || revealed || finishing) return;
  if (v.currentTime >= holdAt()) { enterHold(); return; }
  timer = setTimeout(watch, 33);
}

function play() {
  const started = () => { if (!holding) watch(); };
  v.play().then(started).catch(() => {
    // 有声自动播放被拒时退回静音
    v.muted = true;
    v.play().then(started).catch((e2) => {
      try { window.intro.error(e2 && e2.message ? e2.message : String(e2)); } catch {}
    });
  });
}

try {
  window.intro.onRelease(() => {
    released = true;
    if (holding) { holding = false; enterDissolve(); }
  });
} catch {}

v.addEventListener('ended', () => {
  clearingTimers();
  if (!revealed) { revealed = true; try { window.intro.reveal('ended'); } catch {} }
  try { window.intro.end(); } catch {}
});
v.addEventListener('error', () => {
  try { window.intro.error(v.error ? `media ${v.error.code}` : 'media error'); } catch {}
});
v.addEventListener('playing', () => setTimeout(() => { if (!holding) hint.classList.add('on'); }, 900), { once: true });
v.addEventListener('timeupdate', () => { if (HOLD_AT != null && v.currentTime > HOLD_AT - 1.4) hint.classList.remove('on'); });

document.addEventListener('mousedown', () => { clearingTimers(); try { window.intro.skip(); } catch {} });

function clearingTimers() { clearTimeout(timer); finishing = true; }

// 等主进程把窗口贴到 Codex 上之后再开播；信号若早到，preload 会补发
try { window.intro.onStart(play); } catch { play(); }
