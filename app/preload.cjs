'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('whaleIntro', { finish: () => ipcRenderer.send('intro:done') });
