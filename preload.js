'use strict';

// sandbox: true のため Node の API は使えない。ipcRenderer の橋渡しだけを担う。
// Phase 0 で実際に動く API だけを公開する。
// pdfAPI・taskAPI・shellAPI・printAPI は、それぞれの機能を作るフェーズで足す。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfoAPI', {
  available: true,
  get: () => ipcRenderer.invoke('app:info'),
});

contextBridge.exposeInMainWorld('appLogAPI', {
  available: true,
  error: (entry) => ipcRenderer.invoke('log:error', entry),
});
