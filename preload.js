'use strict';

// sandbox: true のため Node の API は使えない。ipcRenderer の橋渡しだけを担う。
// 実際に動く API だけを公開する。中身のない口を先に並べない。
// taskAPI・shellAPI は、それぞれの機能を作るフェーズで足す。

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

  // 保存先を選ばせる（spec-1-6 確定事項25）。{ path } / { canceled }。
  pickSavePath: (options) => ipcRenderer.invoke('pdf:pickSavePath', options),
  pickInsertSource: (options) => ipcRenderer.invoke('pdf:pickInsertSource', options),
  // 結合する PDF をまとめて選ばせる（spec-2-1 確定事項9）。{ paths } / { canceled }。
  pickMergeSources: (options) => ipcRenderer.invoke('pdf:pickMergeSources', options),
  // 出力先に同名があるか（spec-2-1 確定事項28）。{ ok, exists }。
  exists: (filePath) => ipcRenderer.invoke('pdf:exists', filePath),

  // メニューの「保存」「名前を付けて保存…」（Ctrl+S / Ctrl+Shift+S）から届く合図。
  // レンダラーの keydown には頼らない。viewer-controls.js の handleKey が
  // ctrlKey で早期 return するためで、accelerator で受けるほうが確実である
  // （確定事項39）。mode は 'save' か 'saveAs'。
  onSaveRequest: (callback) => {
    ipcRenderer.removeAllListeners('pdf:saveRequest');
    ipcRenderer.on('pdf:saveRequest', (_event, mode) => callback(mode));
  },
});

// 重い処理をワーカーへ出す口（spec-1-6 確定事項1〜10）。
//
// taskId はレンダラーが決める。run() が終わるのを待たずに cancel() を押せる
// ようにするためで、メイン側が採番すると「まだ id を知らないのに中止したい」
// が起こる。
contextBridge.exposeInMainWorld('taskAPI', {
  available: true,
  // { ok, ... } / { canceled: true } / { changed: true, current } / { error }
  run: (taskId, spec) => ipcRenderer.invoke('task:run', taskId, spec),
  cancel: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  // { taskId, phase, label, step, total }
  onProgress: (callback) => {
    ipcRenderer.removeAllListeners('task:progress');
    ipcRenderer.on('task:progress', (_event, progress) => callback(progress));
  },
});

// エクスプローラーからの起動要求（docs/03 第3章・spec-1-6 確定事項77・80）。
//
// **onLaunch を呼んでから ready() を送ること。**購読を始める前にメインが送ると
// 取りこぼす。メイン側は ready を受けるまで要求を溜めている。
contextBridge.exposeInMainWorld('shellAPI', {
  available: true,
  // { intent: 'open'|'merge'|'split'|'toPdf', paths: string[] }
  onLaunch: (callback) => {
    ipcRenderer.removeAllListeners('shell:launch');
    ipcRenderer.on('shell:launch', (_event, request) => callback(request));
  },
  ready: () => ipcRenderer.send('shell:ready'),
});

// 画面の見た目を覚える（spec-1-3 確定事項31〜35）。覚えるのはモードと
// サイドパネルの開閉・幅の3つだけで、サムネイルのスクロール位置のような
// タブごとの一時的な状態は settings.json に置かない。
contextBridge.exposeInMainWorld('settingsAPI', {
  available: true,
  getUi: () => ipcRenderer.invoke('settings:getUi'),
  setUi: (patch) => ipcRenderer.invoke('settings:setUi', patch),
});

// 未保存の編集を持ったまま終了しようとしたときの往復（spec-1-5 確定事項56）。
// 確認のダイアログはアプリ内の <dialog> なので、レンダラーでしか出せない。
// メイン側は「未保存があるか」だけを持ち、無ければ従来どおり素通りで閉じる。
contextBridge.exposeInMainWorld('appCloseAPI', {
  available: true,
  // 未保存のタブ数を知らせる。返事は要らない。
  setDirty: (count) => ipcRenderer.send('app:dirty', count),
  // 終了しようとしている合図。
  onCloseRequest: (callback) => {
    ipcRenderer.removeAllListeners('app:closeRequest');
    ipcRenderer.on('app:closeRequest', () => callback());
  },
  // 聞いた結果。true なら閉じてよい。
  confirm: (ok) => ipcRenderer.invoke('app:closeConfirm', ok),
});

// 印刷（spec-1-4 確定事項30）。レンダラーが印刷用のコンテナへ画像を並べてから
// ここを呼ぶ。実際に紙へ送るのはメイン側の webContents.print() で、
// silent を false にすると OS の印刷ダイアログが出る。
// レンダラーの window.print() を使わないのは、オプションを渡せず結果
// （成功・取り消し・失敗）も受け取れないためである（確定事項29）。
contextBridge.exposeInMainWorld('printAPI', {
  available: true,
  print: (options) => ipcRenderer.invoke('print:run', options),
});

// 最近使ったファイル（spec-1-2 確定事項8〜10）。実体は settings.json にあり、
// メニューの再構築もメイン側が持つ。レンダラーは一覧を読んで描くだけ。
contextBridge.exposeInMainWorld('recentAPI', {
  available: true,
  list: () => ipcRenderer.invoke('recent:list'),
  add: (entry) => ipcRenderer.invoke('recent:add', entry),
  remove: (filePath) => ipcRenderer.invoke('recent:remove', filePath),
});
