'use strict';

// sandbox: true のため Node の API は使えない。ipcRenderer の橋渡しだけを担う。
// 実際に動く API だけを公開する。中身のない口を先に並べない。
// taskAPI・shellAPI・printAPI は、それぞれの機能を作るフェーズで足す。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfoAPI', {
  available: true,
  get: () => ipcRenderer.invoke('app:info'),
});

contextBridge.exposeInMainWorld('appLogAPI', {
  available: true,
  error: (entry) => ipcRenderer.invoke('log:error', entry),
});

contextBridge.exposeInMainWorld('pdfAPI', {
  available: true,
  // ネイティブの「開く」ダイアログ。{ ok, path, name, size, bytes } / { canceled } / { error }
  open: () => ipcRenderer.invoke('pdf:open'),
  // パス指定で読む。{ ok, ... } / { error }
  read: (filePath) => ipcRenderer.invoke('pdf:read', filePath),
  // メニューの「開く」（Ctrl+O）から届く合図。開く処理はレンダラー側に1本だけ持つ。
  onOpenRequest: (callback) => {
    ipcRenderer.removeAllListeners('pdf:openRequest');
    ipcRenderer.on('pdf:openRequest', () => callback());
  },
});
