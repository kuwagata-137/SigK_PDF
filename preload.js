'use strict';

// sandbox: true のため Node の API は使えない。ipcRenderer の橋渡しだけを担う。
// 実際に動く API だけを公開する。中身のない口を先に並べない。
// taskAPI・shellAPI・printAPI は、それぞれの機能を作るフェーズで足す。

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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

  // ドロップされた File から実際のパスを取る（spec-1-2 確定事項6）。
  // File.path は Electron 32 で削除されたため、webUtils が唯一の経路である。
  // sandbox: true の preload でも webUtils は使える（Renderer 名前空間）。
  // ドロップ由来でない File には '' が返る。例外は握って null にし、
  // 呼び出し側が「パスが取れなかった」1本の分岐で扱えるようにする。
  pathForFile: (file) => {
    try {
      const filePath = webUtils.getPathForFile(file);
      return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
    } catch {
      return null;
    }
  },

  // メニューの「開く」（Ctrl+O）と「最近使ったファイル」から届く合図。
  // パスが付いていればそれを開き、無ければダイアログを出す。
  // 開く処理はレンダラー側に1本だけ持つ（spec-1-2 確定事項18）。
  onOpenRequest: (callback) => {
    ipcRenderer.removeAllListeners('pdf:openRequest');
    ipcRenderer.on('pdf:openRequest', (_event, filePath = null) => callback(filePath));
  },

  // メニューの「文書情報」（Ctrl+I）から届く合図。
  onDocInfoRequest: (callback) => {
    ipcRenderer.removeAllListeners('pdf:docInfoRequest');
    ipcRenderer.on('pdf:docInfoRequest', () => callback());
  },
});

// 最近使ったファイル（spec-1-2 確定事項8〜10）。実体は settings.json にあり、
// メニューの再構築もメイン側が持つ。レンダラーは一覧を読んで描くだけ。
contextBridge.exposeInMainWorld('recentAPI', {
  available: true,
  list: () => ipcRenderer.invoke('recent:list'),
  add: (entry) => ipcRenderer.invoke('recent:add', entry),
  remove: (filePath) => ipcRenderer.invoke('recent:remove', filePath),
});
