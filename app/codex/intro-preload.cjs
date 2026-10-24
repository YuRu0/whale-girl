'use strict';
// 渲染进程桥：只暴露启动动画需要的几个信号，页面拿不到 Node。
const { contextBridge, ipcRenderer } = require('electron');

let started = false;
const waiters = [];

ipcRenderer.on('intro:start', () => {
  started = true;
  while (waiters.length) {
    try { waiters.shift()(); } catch {}
  }
});

contextBridge.exposeInMainWorld('intro', {
  // 首帧已解码并上屏，主进程可以显示窗口了
  prepared: () => ipcRenderer.send('intro:prepared'),
  // 到达保持点，正在等 Codex 就绪（附带当时的播放进度，便于排查）
  hold: (at) => ipcRenderer.send('intro:hold', String(at || '')),
  // 进入终幕溶解，Codex 可以接管焦点（或用户跳过）
  reveal: (reason) => ipcRenderer.send('intro:reveal', String(reason || '')),
  end: () => ipcRenderer.send('intro:end'),
  skip: () => ipcRenderer.send('intro:skip'),
  error: (msg) => ipcRenderer.send('intro:error', String(msg || '')),
  // 主进程下发开始信号；若信号早于注册，注册时立刻补发
  onStart: (cb) => {
    if (started) cb();
    else waiters.push(cb);
  },
  // 主进程下发“Codex 已就绪，可以放行”
  onRelease: (cb) => ipcRenderer.on('intro:release', () => cb())
});
