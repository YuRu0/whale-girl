'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// A packaged Electron ignores the script argument; explicitly dispatch the bundled helper.
const helperEntry = path.join(__dirname, 'vendor', 'dsh-pet', 'runtime', 'electron-helper', 'main.js');
if (process.argv.includes(helperEntry)) {
  app.setAppPath(path.dirname(helperEntry));
  require(helperEntry);
  return;
}
// Codex × 守岸人 启动动画：独立进程，保留硬件加速（视频解码走 GPU），所以要在下面 disableHardwareAcceleration 之前分流
if (process.argv.includes('--codex-intro')) {
  require(path.join(__dirname, 'codex', 'intro-main.cjs'));
  return;
}

const root = path.dirname(process.execPath);
const data = path.join(root, 'data');
const vendor = path.join(__dirname, 'vendor', 'dsh-pet');
const testMode = process.argv.includes('--self-test');
const testDir = process.env.WHALEGIRL_TEST_DIR || path.join(data, 'test');
fs.mkdirSync(path.join(data, 'launcher'), { recursive: true });
fs.mkdirSync(path.join(data, 'pet-profile'), { recursive: true });
const logFile = path.join(data, '运行日志.txt');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2_000_000) fs.writeFileSync(logFile, '');
function log(message) { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); }
app.setName('鲸鱼娘');
app.setAppUserModelId('Yuru.WhaleGirl');
app.setPath('userData', path.join(data, 'launcher'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const settingsFile = path.join(data, '设置.json');
let settings = { autoStart: true, intro: true, size: 480, fixed: true };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {}
let tray, splash, host, port, quitting = false, readyOnce = false;
let stdoutBuffer = '';
// Codex × 守岸人：启动动画 / 主题 / CC Switch 用量（取代旧桥接器）
const codex = require('./codex/integration.cjs').setup({
  log, api: (route, body) => api(route, body), settings, saveSettings: () => saveSettings(), updateTray: () => updateTray(),
  dataDir: data, setTrayTip: (tip) => { if (tray) tray.setToolTip(tip); },
});
const hostHome = path.join(data, 'host');
const configFile = path.join(hostHome, 'dsh-pet', 'main-config.jsonc');
function saveSettings() { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); }
function petConfig() {
  return {
    notificationsEnabled: false, confineToScreen: true,
    pets: [{ name: '鲸鱼娘', id: 'main', size: settings.size, balanceEnabled: false,
      whisperEnabled: false, workStatusEnabled: false, fixedEnabled: settings.fixed,
      display: 'desktop', position: { corner: 'bottom-right', marginX: 32, marginY: 32 } }],
  };
}
async function api(route, body, method = 'POST') {
  if (!port) return null;
  const response = await fetch(`http://127.0.0.1:${port}/dsh-pet-7340/${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.ok === false) throw new Error(result.message || result.reason || route);
  return result;
}
function safely(promise) { Promise.resolve(promise).catch(error => log(error.stack || String(error))); }
async function updatePet() {
  saveSettings();
  await api('config', petConfig(), 'PUT');
  updateTray();
}
function applyAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--login'] });
  settings.autoStart = enabled;
  saveSettings();
  log(`登录自启: ${JSON.stringify(app.getLoginItemSettings({ path: process.execPath, args: ['--login'] }))}`);
  updateTray();
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '鲸鱼娘 · 予薷的桌面伙伴', enabled: false },
    { type: 'separator' },
    ...(codex ? codex.trayItems() : []),
    { label: '重播出场动画', click: () => showIntro(true) },
    { label: '挥挥手', click: () => safely(api('anim?pet=main', { name: '点击回应-元气挥手' })) },
    { label: '桌宠大小', submenu: [360, 480, 640, 800].map((size, index) => ({
      label: ['小', '标准', '大', '超大'][index], type: 'radio', checked: settings.size === size,
      click: () => { settings.size = size; safely(updatePet()); },
    })) },
    { label: '待在原地', type: 'checkbox', checked: settings.fixed,
      click: item => { settings.fixed = item.checked; safely(updatePet()); } },
    { label: '开机自动启动', type: 'checkbox', checked: settings.autoStart,
      click: item => applyAutoStart(item.checked) },
    { label: '启动时播放动画', type: 'checkbox', checked: settings.intro,
      click: item => { settings.intro = item.checked; saveSettings(); updateTray(); } },
    { type: 'separator' },
    { label: '使用说明', click: () => safely(shell.openPath(path.join(root, '使用说明.txt'))) },
    { label: '退出鲸鱼娘', click: () => app.quit() },
  ]));
}
function finishIntro() {
  if (!splash || splash.isDestroyed()) return;
  splash.close();
  splash = null;
}
function showIntro(replay = false) {
  if (splash && !splash.isDestroyed()) return;
  splash = new BrowserWindow({ width: 820, height: 570, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
    backgroundColor: '#00000000', title: '鲸鱼娘来啦',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const current = splash;
  current.setMenuBarVisibility(false);
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', event => event.preventDefault());
  current.webContents.on('before-input-event', (_event, input) => { if (input.key === 'Escape') finishIntro(); });
  current.once('ready-to-show', () => current.showInactive());
  current.on('closed', () => { if (splash === current) splash = null; });
  safely(current.loadFile(path.join(__dirname, 'splash.html')));
  setTimeout(() => { if (!current.isDestroyed()) current.close(); }, 7000).unref();
  if (testMode) {
    fs.mkdirSync(testDir, { recursive: true });
    setTimeout(async () => {
      if (current.isDestroyed()) return;
      const status = await current.webContents.executeJavaScript(`(() => {
        const v = document.querySelector('video'); return {readyState:v.readyState,
          width:v.videoWidth,height:v.videoHeight,time:v.currentTime,error:v.error?.message || null};
      })()`);
      fs.writeFileSync(path.join(testDir, 'splash.json'), JSON.stringify(status, null, 2));
      fs.writeFileSync(path.join(testDir, '启动动画.png'), (await current.webContents.capturePage()).toPNG());
      log('启动动画自检: ' + JSON.stringify(status));
    }, 2300);
  }
  if (replay) safely(api('anim?pet=main', { name: '女仆屈膝礼仪' }));
}
function startHost() {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, JSON.stringify(petConfig(), null, 2));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: hostHome,
    DSH_PET_ELECTRON_PATH: process.execPath, DSH_PET_USER_DATA: path.join(data, 'pet-profile') };
  if (testMode) Object.assign(env, { DSH_PET_SMOKE: '1',
    DSH_PET_SMOKE_OUT: path.join(testDir, '桌宠自检.png'), DSH_PET_SMOKE_AFTER_MS: '6500' });
  host = spawn(process.execPath, [path.join(vendor, 'lib', 'standalone.js'), '--port', '43874'], {
    env, cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  fs.writeFileSync(path.join(data, '进程.json'), JSON.stringify({ launcher: process.pid, host: host.pid }));
  host.stdout.setEncoding('utf8');
  host.stdout.on('data', chunk => {
    log(chunk.trimEnd());
    stdoutBuffer = (stdoutBuffer + chunk).slice(-6000);
    const match = stdoutBuffer.match(/路由\s+http:\/\/127\.0\.0\.1:(\d+)\//);
    if (!readyOnce && match) {
      readyOnce = true; port = Number(match[1]);
      fs.writeFileSync(path.join(data, '运行状态.json'), JSON.stringify({ port, pid: process.pid }));
      setTimeout(() => safely(api('broadcast?pet=main', { text: '予薷，我来啦～\n左键拖动，右键选动作。' })), 4000);
    }
  });
  host.stderr.on('data', chunk => log(chunk.toString('utf8').trimEnd()));
  host.on('error', error => { log(error.stack); dialog.showErrorBox('鲸鱼娘启动失败', error.message); app.quit(); });
  host.on('exit', (code, signal) => { log(`桌宠进程退出 ${code}/${signal}`); if (!quitting) app.quit(); });
  setTimeout(() => {
    if (!readyOnce && !quitting) { dialog.showErrorBox('鲸鱼娘启动失败', `请查看 ${logFile}`); app.quit(); }
  }, 15000).unref();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => {
    if (args.includes('--quit')) return app.quit();
    if (args.includes('--codex')) return codex && codex.startCodex();
    if (args.includes('--disable-autostart')) return applyAutoStart(false);
    if (args.includes('--enable-autostart')) return applyAutoStart(true);
    showIntro(true);
  });
  app.whenReady().then(() => {
    if (process.argv.includes('--quit')) return app.quit();
    if (!testMode) applyAutoStart(settings.autoStart);
    saveSettings();
    const icon = nativeImage.createFromPath(path.join(vendor, 'assets', 'logo.png')).resize({ width: 24, height: 24 });
    tray = new Tray(icon); tray.setToolTip('鲸鱼娘 · 右键管理桌宠');
    tray.on('double-click', () => showIntro(true)); updateTray();
    ipcMain.on('intro:done', event => { if (splash && event.sender === splash.webContents) finishIntro(); });
    const codexLaunch = process.argv.includes('--codex');
    if ((settings.intro || testMode) && !codexLaunch) showIntro();
    startHost();
    codex.start();
    if (codexLaunch) codex.startCodex();
    if (testMode) {
      const deadline = Date.now() + 25000;
      const timer = setInterval(() => {
        const captured = fs.existsSync(path.join(testDir, '桌宠自检.png'));
        if (captured || Date.now() > deadline) { clearInterval(timer); log(`自检截图完成: ${captured}`); app.quit(); }
      }, 400);
    }
  }).catch(error => { log(error.stack); dialog.showErrorBox('鲸鱼娘启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true; event.preventDefault(); finishIntro();
    if (codex) codex.stop();
    (async () => {
      if (port) { try { await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }); } catch {} }
      if (host && host.exitCode === null) {
        await Promise.race([new Promise(resolve => host.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3500))]);
        if (host.exitCode === null) host.kill();
      }
      if (tray) tray.destroy();
      app.quit();
    })().catch(() => app.exit(1));
  });
}
