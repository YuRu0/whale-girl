'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadTheme(reply, overrides = {}) {
  let sockets = 0;
  class Socket {
    constructor() { sockets++; queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const message = JSON.parse(raw);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, ...reply(message) }) }));
    }
    close() { this.onclose?.(); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/codex/theme.cjs'), 'utf8'), {
    require: name => name === 'node:fs' && overrides.fs ? overrides.fs : (name === './cdp.cjs' ? require('../app/codex/cdp.cjs') : require(name)),
    process: { env: overrides.env || process.env },
    module, __dirname, WebSocket: Socket, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => [{ type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9227/page' }] }),
    AbortSignal, console
  });
  const theme = new module.exports.CodexThemeController({});
  theme.themeExpression = () => 'inject';
  return { theme, socketCount: () => sockets };
}

test('successful injection is recorded only after the page confirms the theme', async () => {
  const { theme } = loadTheme(m => ({ result: { result: { value: m.params.expression === 'inject' ? { theme: 'midnight-deepseek' } : false } } }));
  assert.equal((await theme.applyNow()).ok, true);
  assert.ok(theme.state().lastAppliedAt);
});

test('CDP protocol errors surface as failures', async () => {
  const { theme } = loadTheme(() => ({ error: { message: 'Target closed' } }));
  const result = await theme.applyNow();
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Target closed');
  assert.equal(theme.state().lastAppliedAt, null);
});

test('page exceptions preserve the actual error description', async () => {
  const { theme } = loadTheme(m => m.params.expression === 'inject'
    ? { result: { exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: missing document.body' } } } }
    : { result: { result: { value: false } } });
  assert.match((await theme.applyNow()).message, /missing document.body/);
});

test('undefined page result is not reported as successful injection', async () => {
  const { theme } = loadTheme(() => ({ result: { result: {} } }));
  assert.equal((await theme.applyNow()).ok, false);
});

test('overlapping polling calls share one connection', async () => {
  const { theme, socketCount } = loadTheme(() => ({ result: { result: { value: true } } }));
  const results = await Promise.all([theme.applyNow(), theme.applyNow(), theme.applyNow()]);
  assert.ok(results.every(r => r.ok));
  assert.equal(socketCount(), 1);
});

test('disabled theme does not open a debugging connection', async () => {
  const { theme, socketCount } = loadTheme(() => ({}));
  theme.setOptions({ enabled: false });
  assert.equal((await theme.applyNow()).ok, false);
  assert.equal(socketCount(), 0);
});

test('AppExecLink alias is detected with lstat even when existsSync is false', async () => {
  let inspected;
  const { theme } = loadTheme(() => ({}), {
    fs: { existsSync: () => false, lstatSync: file => { inspected = file; return {}; } },
    env: { LOCALAPPDATA: 'C:\\Probe\\Local' }
  });
  const resolved = await theme.resolveCodexExe();
  assert.equal(resolved, path.join('C:\\Probe\\Local', 'Microsoft', 'WindowsApps', 'chatgpt-desktop.exe'));
  assert.equal(inspected, resolved);
});

test('launch keeps the requested visible Codex window and loopback debug binding', async () => {
  const { theme } = loadTheme(() => ({}));
  let probes = 0, launch;
  theme.debugEndpoint = async () => ++probes === 1 ? null : {};
  theme.isCodexRunning = async () => false;
  theme.resolveCodexExe = async () => 'official-alias.exe';
  theme.options.spawn = (exe, args, options) => { launch = { exe, args, options }; return { unref() {} }; };
  assert.equal((await theme.launchCodex()).ok, true);
  assert.equal(launch.exe, 'official-alias.exe');
  assert.equal(launch.options.windowsHide, false);
  assert.ok(launch.args.includes('--remote-debugging-port=9227'));
  assert.ok(launch.args.includes('--remote-debugging-address=127.0.0.1'));
});

test('activating an existing Codex restores its window without another AppsFolder launch', async () => {
  const { theme } = loadTheme(() => ({}));
  let focused = 0;
  theme.isCodexRunning = async () => true;
  theme.focusCodexWindow = async () => focused++;
  theme.options.spawn = () => { throw Error('Unexpected second launch'); };
  await theme.activateCodex();
  assert.equal(focused, 1);
});

test('startup always polls and the tray toggle updates the live controller', () => {
  const calls = [];
  let controller;
  class Theme {
    constructor(options) { this.options = options; controller = this; }
    start() { calls.push('start'); }
    stop() { calls.push('stop'); }
    setOptions(options) { Object.assign(this.options, options); }
    async removeTheme() { calls.push('remove'); }
    state() { return { enabled: this.options.enabled }; }
  }
  const module = { exports: {} };
  const server = { on() {}, listen() {}, close() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/codex/integration.cjs'), 'utf8'), {
    require: name => name === 'electron' ? { app: {}, ipcMain: { handle() {}, on() {} }, globalShortcut: { register() {}, unregisterAll() {} } }
      : name === './theme.cjs' ? { CodexThemeController: Theme }
      : name === './usage-service.cjs' ? { createUsageService: () => ({ start() {}, stop() {} }) }
      : name === 'node:http' ? { createServer: () => server } : (name === './cdp.cjs' ? require('../app/codex/cdp.cjs') : require(name)),
    module, __dirname, process, console, setTimeout, clearTimeout, setInterval, clearInterval
  });
  const integration = module.exports.setup({ settings: {}, log() {}, api: async () => {},
    saveSettings() {}, updateTray() {}, dataDir: __dirname });
  integration.start();
  assert.deepEqual(calls, ['start']);
  const toggles = [];
  const visit = items => items.forEach(item => { if (item.submenu) visit(item.submenu); if (item.label === '启用界面主题注入') toggles.push(item); });
  visit(integration.trayItems());
  toggles[0].click({ checked: false });
  assert.equal(controller.options.enabled, false);
  assert.deepEqual(calls, ['start', 'stop', 'remove']);
  toggles[0].click({ checked: true });
  assert.equal(controller.options.enabled, true);
  assert.equal(calls.at(-1), 'start');
});

