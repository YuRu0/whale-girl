'use strict';
// 用量面板的 preload：只暴露 5 个受限通道，页面拿不到 Node / ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usagePanel', {
  /** 订阅主进程推送的快照；返回取消订阅函数 */
  onData(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('usage:data', listener);
    return () => ipcRenderer.removeListener('usage:data', listener);
  },
  /** 请主进程立即刷新（含按需查询余额），返回最新快照 */
  refresh: () => ipcRenderer.invoke('usage:refresh'),
  close: () => ipcRenderer.send('usage:close'),
  /** 把摘要发到鲸鱼娘气泡 */
  broadcast: () => ipcRenderer.send('usage:broadcast'),
  openCcSwitch: () => ipcRenderer.send('usage:open-ccswitch')
});
