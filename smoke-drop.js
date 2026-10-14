'use strict';

// 起動確認 SIGK_SMOKE_DROP=<path>[;<path>…]（spec-1-2 確定事項6、spec-2-5 の起動確認）。main.js の installSmokeCheck が使う。
//
// 本物のドラッグ＆ドロップを再現する。Chromium の Input.dispatchDragEvent に実ファイルのパスを渡すと、ページには OS から落としたときと
// 同じ File が届く。webUtils.getPathForFile がそこからパスを取り出せるかを、人の手を借りずに確かめられる。; で区切った複数のパスは、
// 1 回のドロップでまとめて落とす（ユーザーが PDF を 2 つ一緒に落とした症状を見るため。2026-10-14）。落とす点は窓の真ん中あたり。

const path = require('node:path');

const DROP_POINT = Object.freeze({ x: 640, y: 400 });

// 'a.pdf; b.pdf' → 絶対パスの並び。空の項目は飛ばす。
function dropPaths(text, cwd = process.cwd()) {
  return String(text ?? '').split(';').map((part) => part.trim()).filter((part) => part.length > 0).map((part) => path.resolve(cwd, part));
}

// 窓の幅・高さに収まる落とす点（最小の大きさ 960×600 でもページの表示の上に来るように）。
function dropPointFor(bounds) {
  const width = bounds?.width ?? DROP_POINT.x * 2;
  const height = bounds?.height ?? DROP_POINT.y * 2;
  return { x: Math.min(DROP_POINT.x, Math.round(width * 0.6)), y: Math.min(DROP_POINT.y, Math.round(height * 0.6)) };
}

async function dispatchDrop(win, filePaths) {
  const { debugger: dbg } = win.webContents;
  const at = dropPointFor(win.getContentBounds?.() ?? null);
  dbg.attach('1.3');
  try {
    const data = { items: [], files: [...filePaths], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'])
      await dbg.sendCommand('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data });
  } finally {
    dbg.detach();
  }
}

// 落としたあとの様子。開くのを待ってから（wait ミリ秒）、タブ・映している文書・モード・帯を読む。
function resultScript(wait = 2000) {
  const ms = Math.max(0, Math.round(Number(wait) || 0));
  return `(async () => {
  await new Promise((resolve) => setTimeout(resolve, ${ms}));
  const state = window.SigK.viewer.getState();
  return {
    tabCount: window.SigK.tabs.count(),
    names: [...document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent),
    mode: document.documentElement.getAttribute('data-mode'),
    openedName: state.file && state.file.name,
    openedPath: state.file && state.file.path,
    pageCount: state.pageCount,
    message: document.getElementById('view-empty').hidden ? null : document.getElementById('view-message').textContent,
    banner: document.getElementById('view-banner')?.hidden === false ? document.getElementById('view-banner').textContent.trim() : null,
    overlayHidden: document.getElementById('view-drop').hidden,
  };
})()`;
}

module.exports = { DROP_POINT, dropPaths, dropPointFor, dispatchDrop, resultScript };
