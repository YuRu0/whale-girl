'use strict';
// 鲸鱼娘启动器里的 Codex × 守岸人 功能：启动动画、Codex 主题、CC Switch 用量面板与桌宠播报。
// 取代旧的 Codex Shorekeeper Suite 桥接器——全部跑在鲸鱼娘自己的进程里。
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { CodexThemeController } = require('./theme.cjs');
const { createUsageService } = require('./usage-service.cjs');

const CONTROL_PORT = 43901;   // 桌宠右键菜单调用的本地入口（只接受本机、只做 UI 动作）

function runPowerShell(command, timeoutMs = 8000) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n || 0)));

function setup(ctx) {
  const { log, api, settings, saveSettings, updateTray, dataDir } = ctx;
  const defaults = { codexIntro: true, codexIntroSound: true, codexTheme: true, codexThemeActive: 'midnight-deepseek', codexIntroFile: '', usageNotify: true };
  for (const [k, v] of Object.entries(defaults)) if (settings[k] === undefined) settings[k] = v;

  // ───── 启动动画管理 ─────
  // 片子统一放在 codex/intros/ 下；内置默认片 default-shorekeeper.mp4 永远兜底。
  const INTRO_DIR = path.join(__dirname, 'intros');
  const DEFAULT_INTRO = 'intros/default-shorekeeper.mp4';
  const INTRO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
  const INTRO_MAX_MB = 400;   // 超过就提示，避免塞进几个 G 的片子拖垮冷启动

  function ensureIntroDir() {
    try { fs.mkdirSync(INTRO_DIR, { recursive: true }); } catch {}
  }

  // 当前生效的动画（相对 codex 目录的路径），文件不在了自动回退内置默认片
  function currentIntroRel() {
    const rel = String(settings.codexIntroFile || '');
    if (!rel.startsWith('intros/')) return DEFAULT_INTRO;
    try { return fs.existsSync(path.join(__dirname, rel)) ? rel : DEFAULT_INTRO; } catch { return DEFAULT_INTRO; }
  }
  function currentIntroAbs() { return path.join(__dirname, currentIntroRel()); }

  // 列出 intros/ 下所有可用片子：[{ rel, name, size, builtin }]
  function listIntros() {
    ensureIntroDir();
    let files = [];
    try { files = fs.readdirSync(INTRO_DIR, { withFileTypes: true }); } catch { files = []; }
    const out = files
      .filter((d) => d.isFile() && INTRO_EXT.includes(path.extname(d.name).toLowerCase()))
      .map((d) => {
        const rel = `intros/${d.name}`;
        let size = 0;
        try { size = fs.statSync(path.join(INTRO_DIR, d.name)).size; } catch {}
        return { rel, name: d.name.replace(/\.[^.]+$/, ''), size, builtin: rel === DEFAULT_INTRO };
      })
      .sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0) || a.name.localeCompare(b.name, 'zh'));
    if (!out.some((x) => x.builtin)) out.unshift({ rel: DEFAULT_INTRO, name: '守岸人（内置默认）', size: 0, builtin: true });
    return out;
  }

  // 从文件导入动画：复制进 intros/ 并立即启用
  async function importIntro() {
    const res = await dialog.showOpenDialog({
      title: '选择启动动画',
      defaultPath: app.getPath('videos'),
      filters: [{ name: '视频文件', extensions: INTRO_EXT.map((e) => e.slice(1)) }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
    const src = res.filePaths[0];
    let size = 0;
    try { size = fs.statSync(src).size; } catch { say('读不到这个文件，换一个试试'); return null; }
    if (size > INTRO_MAX_MB * 1024 * 1024) {
      say(`这片子 ${(size / 1048576).toFixed(0)} MB 太大了\n建议压到 ${INTRO_MAX_MB} MB 以内再导入`);
      return null;
    }
    ensureIntroDir();
    const base = path.basename(src);
    let target = path.join(INTRO_DIR, base);
    if (fs.existsSync(target)) target = path.join(INTRO_DIR, `${path.basename(base, path.extname(base))}-${Date.now().toString(36)}${path.extname(base)}`);
    try { fs.copyFileSync(src, target); } catch (e) { say(`复制失败：${e.message}`); return null; }
    settings.codexIntroFile = `intros/${path.basename(target)}`;
    saveSettings(); updateTray();
    say(`换上「${path.basename(target, path.extname(target))}」啦\n下次打开 Codex 就是它`);
    return settings.codexIntroFile;
  }

  function pickIntro(rel) {
    settings.codexIntroFile = rel === DEFAULT_INTRO ? '' : rel;
    saveSettings(); updateTray();
    const label = rel === DEFAULT_INTRO ? '守岸人（内置默认）' : path.basename(rel, path.extname(rel));
    say(`启动动画换成「${label}」`);
  }

  const theme = new CodexThemeController({
    debugPort: 9227, enabled: settings.codexTheme,
    activeTheme: settings.codexThemeActive,
    assetRoot: path.join(__dirname, 'assets'),
    runPowerShell, spawn
  });

  // 切换界面主题：持久化 → 通知控制器重注入 → 若 Codex 没开则提醒
  function switchTheme(id, label) {
    settings.codexThemeActive = id;
    saveSettings(); updateTray();
    if (!settings.codexTheme) { say(`已选「${label}」主题\n不过界面主题注入现在是关闭的\n在下面把它打开才会生效哦`); return; }
    theme.setActiveTheme(id).then((r) => {
      log(`主题切换: ${JSON.stringify(r)}`);
      if (r.ok) say(`换上「${label}」啦`);
      else if (theme.debugEndpoint()) say(`「${label}」没能立刻生效：${r.message || '未知原因'}`);
      else say(`已记住「${label}」主题\n下次从鲸鱼娘打开 Codex 时生效`);
    }).catch((e) => log(`主题切换失败: ${e.message}`));
  }

  // ───── 桌宠说话 / 动作 ─────
  const say = (text) => Promise.resolve(api('broadcast?pet=main', { text })).catch((e) => log(`播报失败: ${e.message}`));
  const anim = (name) => Promise.resolve(api('anim?pet=main', { name })).catch(() => {});

  // ───── 用量服务 ─────
  let panel = null;
  const notes = settings.usageNotes || (settings.usageNotes = {});
  function balanceAnim(snap) {
    const b = snap.balances && (snap.balances.codex || snap.balances.claude);
    if (!b || !b.ok || b.remaining == null) return '工作状态-清点归档';
    const v = b.currency === 'USD' ? b.remaining * 7.2 : b.remaining;
    return v <= 0 ? '余额-分文不剩' : v < 5 ? '余额-袋空如洗' : v < 20 ? '余额-数金皱眉' : v < 100 ? '余额-钱袋如常' : v < 500 ? '余额-金袋叮当' : '余额-钱袋满溢';
  }
  function checkMilestones(snap) {
    if (!settings.usageNotify) return;
    const today = snap.stats && snap.stats.periods && snap.stats.periods.today;
    const live = snap.live;
    const date = new Date().toLocaleDateString('sv');
    if (notes.date !== date) { notes.date = date; notes.level = 0; }
    const LV = [10e6, 25e6, 50e6, 100e6, 200e6, 400e6];
    const lv = today ? LV.filter((x) => today.total >= x).length : 0;
    if (lv > (notes.level || 0)) {
      notes.level = lv; saveSettings();
      if (notes.date === date && lv > 0) { anim('吃Token'); say(`今天已经吃掉 ${fmtTok(LV[lv - 1])} tokens 啦\n${snap.stats.periods.today.requests} 次请求 · 花费 $${today.costUsd.toFixed(2)}`); }
      return;
    }
    if (live && live.ok && live.contextPercent >= 85 && live.threadId && notes.ctxThread !== live.threadId) {
      notes.ctxThread = live.threadId; saveSettings();
      anim('工作状态-垂头叹气冒汗'); say(`上下文已经用到 ${Math.round(live.contextPercent)}% 了\n快满啦，可以考虑开个新对话`);
      return;
    }
    const b = snap.balances && snap.balances.codex;
    if (b && b.ok && b.remaining != null && b.kind === 'deepseek' && b.remaining < 5 && Date.now() - (notes.lowAt || 0) > 6 * 3600e3) {
      notes.lowAt = Date.now(); saveSettings();
      anim('余额-袋空如洗'); say(`DeepSeek 余额只剩 ¥${b.remaining.toFixed(2)} 了\n记得去充值哦`);
    }
  }
  const usage = createUsageService({
    onUpdate: (snap) => {
      if (panel && !panel.isDestroyed() && panel.isVisible()) panel.webContents.send('usage:data', snap);
      ctx.setTrayTip && ctx.setTrayTip(trayTip(snap));
    },
    onActivity: (snap) => checkMilestones(snap)
  });
  function trayTip(snap) {
    const d = snap && snap.stats && snap.stats.periods && snap.stats.periods.today;
    return d ? `鲸鱼娘 · 今日 ${fmtTok(d.total)} tokens · $${d.costUsd.toFixed(2)}` : '鲸鱼娘';
  }
  async function broadcastUsage() {
    const snap = await usage.refresh({ forceBalance: true }).catch(() => usage.getSnapshot());
    anim(balanceAnim(snap));
    await say(usage.bubbleText());
  }

  // ───── 用量面板 ─────
  function showPanel(anchor) {
    if (!panel || panel.isDestroyed()) {
      panel = new BrowserWindow({ width: 440, height: 700, frame: false, transparent: true, resizable: false, skipTaskbar: true,
        alwaysOnTop: true, show: false, webPreferences: { preload: path.join(__dirname, 'panel-preload.cjs'), contextIsolation: true, sandbox: true } });
      panel.setMenu(null);
      panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      panel.webContents.on('will-navigate', (e) => e.preventDefault());
      panel.on('blur', () => { if (panel && !panel.isDestroyed() && Date.now() - panel.__shownAt > 600) panel.hide(); });
      panel.loadFile(path.join(__dirname, 'panel.html'));
    }
    const pt = anchor || screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(pt).workArea;
    const [w, h] = panel.getSize();
    const x = anchor ? Math.min(Math.max(wa.x, pt.x - w - 12), wa.x + wa.width - w) : wa.x + wa.width - w - 24;
    const y = anchor ? Math.min(Math.max(wa.y, pt.y - h / 2), wa.y + wa.height - h) : wa.y + wa.height - h - 24;
    panel.setPosition(Math.round(x), Math.round(y));
    panel.__shownAt = Date.now();
    panel.show(); panel.focus();
    anim('工作状态-清点归档');
  }
  function togglePanel() { if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide(); else showPanel(); }
  const fromPanel = (e) => panel && !panel.isDestroyed() && e.sender === panel.webContents;
  ipcMain.handle('usage:refresh', (e) => (fromPanel(e) ? usage.refresh({ forceBalance: true }) : null));
  ipcMain.on('usage:close', (e) => { if (fromPanel(e)) panel.hide(); });
  ipcMain.on('usage:broadcast', (e) => { if (fromPanel(e)) broadcastUsage(); });
  ipcMain.on('usage:open-ccswitch', (e) => {
    if (!fromPanel(e)) return;
    const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'CC Switch', 'cc-switch.exe');
    if (fs.existsSync(exe)) shell.openPath(exe);
  });

  // ───── Codex 启动 + 动画 ─────
  // 设计要点：
  //   1. 动画与 Codex 启动并行，动画先盖住冷启动过程；
  //   2. 主题在动画播放期间就注入，不等动画结束；
  //   3. 动画在终幕溶解前定帧等待，收到"Codex 已就绪"才放行，
  //      因此动画时长自动 >= 启动时长，也不会停在画面转黑的那一段。
  let busy = false;
  // Codex 界面是否已经真正画出来：null = 未判定，true = 就绪。
  // 动画子进程会轮询本地入口拿这个状态（stdin 在 Electron 主进程里不可靠，不用它做主通道）。
  let codexReady = null;
  // Codex 窗口位置（CDP Browser.getWindowForTarget，DIP）。动画轮询 /codex-ready 时顺带取走用于贴合。
  let codexBounds = null;
  async function startCodex({ intro = settings.codexIntro, muted = !settings.codexIntroSound } = {}) {
    if (busy) return; busy = true;
    codexReady = null;
    codexBounds = null;
    let boundsPoll = null;
    try {
      const launch = theme.launchCodex().catch((e) => ({ ok: false, mode: 'error', message: e.message }));
      launch.then((r) => { if (r.ok) theme.activateCodex().catch(() => {}); });

      let child = null;
      const introRel = currentIntroRel();
      if (intro && fs.existsSync(currentIntroAbs())) {
        const env = { ...process.env, WHALE_INTRO_DEBUG: '1' }; delete env.ELECTRON_RUN_AS_NODE;
        const args = [
          '--codex-intro',
          `--intro-user-data=${path.join(dataDir, 'intro-profile')}`,
          `--intro-ready-url=http://127.0.0.1:${CONTROL_PORT}/codex-ready`,
          `--intro-file=${encodeURIComponent(introRel)}`
        ];
        if (muted || process.env.WHALE_INTRO_MUTED === '1') args.push('--intro-muted');
        child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: false });
      }

      // 窗口位置轮询：CDP 直读，比 PowerShell 跟踪器快且稳
      if (child) {
        theme.getWindowRect().then((r) => { if (r) codexBounds = r; }).catch(() => {});
        boundsPoll = setInterval(() => {
          theme.getWindowRect().then((r) => { if (r) codexBounds = r; }).catch(() => {});
        }, 250);
      }

      // ── 放行闸门：Codex 界面真正画出来了，才让动画播完终幕 ──
      let released = false;
      const release = (why) => {
        if (released) return;
        released = true;
        if (child && child.stdin && !child.stdin.destroyed) { try { child.stdin.write('RELEASE\n'); } catch {} }
        log(`动画放行: ${why}`);
      };
      const gate = (async () => {
        const r = await launch;
        if (!r.ok) {
          // Codex 已在普通模式运行或没找到：窗口本身是好的，略等一下即可放行
          await sleep(r.mode === 'restart-required' ? 1400 : 900);
          codexReady = true;
          release(String(r.mode || 'launch-failed'));
          return false;
        }
        if (settings.codexTheme) { theme.start(); theme.applyNow().catch(() => {}); }
        const ok = await theme.waitAppReady(45000).catch(() => false);
        codexReady = true;   // 无论是就绪还是超时，都必须放行，不能把用户卡在动画里
        release(ok ? 'app-ready' : 'ready-timeout');
        return ok;
      })().catch(() => { codexReady = true; release('gate-error'); });

      // 动画进程收场 + 终幕溶解时把焦点交给 Codex
      const closed = new Promise((resolve) => {
        if (!child) return resolve('no-intro');
        let all = '';
        let focused = false;
        let done = false;
        const finishHow = (h) => { if (!done) { done = true; resolve(h); } };
        child.stdout.on('data', (d) => {
          all += d;
          const lines = all.split(/\r?\n/);
          all = lines.pop();
          // 动画进程的关键信号原样进运行日志，方便排查黑屏/放行问题
          for (const l of lines) if (l.includes('INTRO:')) log(`[动画] ${l.trim()}`);
          if (!focused && /INTRO:reveal/.test(all)) {
            focused = true;
            setTimeout(() => theme.focusCodexWindow().catch(() => {}), 200);
          }
          if (/INTRO:(done|error)\b/.test(all)) finishHow('intro');
        });
        child.on('exit', () => finishHow('exit'));
        child.on('error', () => finishHow('error'));
        setTimeout(() => finishHow('timeout'), 160000);
      });

      const how = await closed;
      const result = await launch;
      log(`Codex 启动: ${JSON.stringify({ how, mode: result.mode, ok: result.ok })}`);

      if (!child) {
        // 没有动画时才需要在这里补齐激活与注入
        await theme.activateCodex().catch(() => {});
        if (settings.codexTheme) { theme.start(); theme.applyNow().catch(() => {}); }
        setTimeout(() => theme.focusCodexWindow().catch(() => {}), 900);
        await sleep(600);
      } else {
        theme.focusCodexWindow().catch(() => {});
        await sleep(350);
      }

      if (result.mode === 'restart-required') { anim('工作状态-垂头叹气冒汗'); say('Codex 已经在普通模式运行了\n完全退出 Codex 后再从我这里打开\n才能换上守岸人主题'); }
      else if (!result.ok) say(`没能打开 Codex：${result.message || '未知原因'}`);
      else {
        // 动画全程盖在 Codex 上，收尾时它的渲染器可能还在节流，必须用打包应用激活踢一脚
        await theme.activateCodex().catch(() => {});
        theme.focusCodexWindow().catch(() => {});
        anim('点击回应-元气挥手');
        usage.refresh().then(() => say(`守岸人已就位 ✦\n${usage.bubbleText()}`)).catch(() => {});
      }
    } finally {
      if (boundsPoll) clearInterval(boundsPoll);
      busy = false;
      codexBounds = null;
    }
  }

  // ───── 本地入口（给桌宠右键菜单用） ─────
  let lastCodexHit = 0;
  const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin || '');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };
    if (/^https?:\/\//i.test(origin) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) { res.writeHead(403, cors); return res.end('{"ok":false}'); }
    const url = (req.url || '').split('?')[0];
    // 启动动画子进程轮询这里，问"Codex 界面画好了没"，顺带取窗口位置用于贴合
    if (req.method === 'GET' && url === '/codex-ready') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ ready: codexReady === true, bounds: codexBounds }));
    }
    if (req.method !== 'POST') { res.writeHead(405, cors); return res.end('{"ok":false}'); }
    if (url === '/show') showPanel(screen.getCursorScreenPoint());
    else if (url === '/say') broadcastUsage();
    else if (url === '/codex') { if (Date.now() - lastCodexHit > 10000) { lastCodexHit = Date.now(); startCodex(); } }
    else { res.writeHead(404, cors); return res.end('{"ok":false}'); }
    res.writeHead(200, cors); res.end('{"ok":true}');
  });
  server.on('error', (e) => log(`本地入口 ${CONTROL_PORT} 未启用: ${e.message}`));

  function start() {
    server.listen(CONTROL_PORT, '127.0.0.1');
    usage.start(30000);
    try { globalShortcut.register('CommandOrControl+Alt+U', togglePanel); } catch {}
    // Codex 若已带调试端口在运行（比如鲸鱼娘重启），直接接上主题
    theme.debugEndpoint().then((ep) => { if (ep && settings.codexTheme) theme.start(); }).catch(() => {});
  }
  function stop() {
    try { server.close(); } catch {}
    usage.stop(); theme.stop();
    try { globalShortcut.unregisterAll(); } catch {}
  }
  function trayItems() {
    const toggle = (key, label, after) => ({ label, type: 'checkbox', checked: Boolean(settings[key]),
      click: (item) => { settings[key] = item.checked; saveSettings(); updateTray(); after && after(item.checked); } });
    return [
      { label: '打开 Codex × 守岸人', click: () => startCodex() },
      { label: '查看用量（Ctrl+Alt+U）', click: () => showPanel() },
      { label: '播报今日用量', click: () => broadcastUsage() },
      { label: 'Codex 联动', submenu: [
        { label: '重播启动动画', click: () => startCodex({ intro: true }) },
        toggle('codexIntro', '打开 Codex 时播放启动动画'),
        toggle('codexIntroSound', '启动动画带声音'),
        { label: '启动动画', submenu: [
          ...(() => {
            const cur = currentIntroRel();
            const items = listIntros().map((it) => ({
              label: `${it.builtin ? '守岸人（内置默认）' : it.name}${it.size ? ` · ${(it.size / 1048576).toFixed(0)}MB` : ''}`,
              type: 'radio',
              checked: it.rel === cur,
              click: () => pickIntro(it.rel)
            }));
            items.push({ type: 'separator' });
            items.push({ label: '从文件导入…', click: () => { importIntro(); } });
            items.push({ label: '打开动画目录', click: () => { ensureIntroDir(); shell.openPath(INTRO_DIR); } });
            return items;
          })()
        ] },
        { type: 'separator' },
        { label: '界面主题', submenu: [
          { label: '守岸人 · 夜海', type: 'radio', checked: settings.codexThemeActive !== 'midnight-deepseek',
            click: () => switchTheme('shorekeeper', '守岸人 · 夜海') },
          { label: '深夜大肥鱼 · 雨夜', type: 'radio', checked: settings.codexThemeActive === 'midnight-deepseek',
            click: () => switchTheme('midnight-deepseek', '深夜大肥鱼 · 雨夜') },
          { type: 'separator' },
          toggle('codexTheme', '启用界面主题注入')
        ] },
        { type: 'separator' },
        toggle('usageNotify', '用量提醒气泡（里程碑 / 上下文 / 余额）')
      ] },
      { type: 'separator' }
    ];
  }
  return { start, stop, startCodex, showPanel, trayItems };
}

module.exports = { setup };
