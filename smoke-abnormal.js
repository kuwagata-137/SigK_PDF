'use strict';

// 起動確認 SIGK_SMOKE_ABNORMAL=<path1>;<path2>;...（spec-6-1 タスク D の D2。ロードマップ 6-3）。
//
// 異常な PDF（空・見出しだけ・中身が PDF でない・壊れた・パスワード付き・所有者パスワードだけ・AES-128・1 ページだけ壊れた など）を、
// 本物の pdf.js で 1 本ずつ開き、閲覧のタブとツールモードの帯でどう見えるかを記録する。テストはどれも pdf.js のスタブなので、
// 本物で開く確かめはここだけ。パスワードを聞かれたら user1 を入れる（検体の決まり。test/fixtures の encrypted.pdf・aes-128.pdf）。
// 開いたタブは毎回閉じる（保存していない変更は無いので確認は出ない）。
//
// SIGK_SMOKE_ABNORMAL_ZOOM=<倍率>@<画面の画素の倍率>（例 4@1.5）を付けると、開けた文書をその倍率で描き直し、1 ページ目の canvas の
// 大きさと、描けたか（真ん中の 1 画素に色が載ったか）も記録する（D9。大きな紙で canvas が Chromium の上限を超えないか）。

// 1 本を閲覧で開き、ツールモード（透かし）の帯の様子も見て、閉じる。
const OPEN_ONE = (filePath, zoom) => `(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SigK = window.SigK;
  SigK.shell.setMode(document, 'view');
  let asked = 0;
  const watch = setInterval(() => {
    if (SigK.passwordPrompt.isOpen() && asked < 3) {
      asked += 1;
      document.getElementById('password-prompt-input').value = 'user1';
      document.getElementById('password-prompt-ok').click();
    }
  }, 50);
  const before = SigK.tabs.list().length;
  const opened = await SigK.tabs.openPath(${JSON.stringify(filePath)});
  await wait(800);
  clearInterval(watch);
  const tab = SigK.tabs.list().find((entry) => entry.active) ?? null;
  const state = SigK.viewer.getState();
  const report = {
    opened,
    tabMade: SigK.tabs.list().length > before,
    tabError: tab?.error ?? null,
    message: SigK.viewer.getMessage?.() ?? null,
    passwordAsked: asked,
    pageCount: state.open ? state.pageCount : null,
    encrypted: state.file?.encrypted ?? null,
    unsaveable: SigK.save.unsaveableReason(),
  };
  const zoom = ${JSON.stringify(zoom)};
  if (opened && zoom !== null) {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => zoom.dpr });
    SigK.viewer.setZoom(zoom.zoom);
    SigK.viewer.goToPage(0);
    await wait(5000);
    const canvas = document.querySelector('#view-pages canvas');
    let drawn = null;
    try {
      const pixel = canvas?.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      drawn = pixel === undefined ? null : pixel[3] > 0;
    } catch (error) {
      drawn = String(error?.message ?? error);
    }
    report.zoomed = { zoom: zoom.zoom, dpr: zoom.dpr, width: canvas?.width ?? null, height: canvas?.height ?? null, drawn };
    SigK.viewer.setZoom(1);
    await wait(500);
  }
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('watermark');
  await wait(300);
  report.stripBlocked = SigK.toolsWatermark.stateText();
  report.canRunWatermark = SigK.toolsWatermark.canRun();
  SigK.shell.setMode(document, 'view');
  if (tab !== null && report.tabMade)
    SigK.tabs.forceCloseTab(tab.id);
  await wait(300);
  return report;
})()`;

// '4@1.5' → { zoom: 4, dpr: 1.5 }。無ければ null。
function parseZoom(text) {
  const [zoom, dpr = 1] = String(text ?? '').split('@').map(Number);
  return Number.isFinite(zoom) && zoom > 0 && Number.isFinite(dpr) && dpr > 0 ? { zoom, dpr } : null;
}

async function run({ win, paths, zoom = null }) {
  const results = [];
  const zoomed = parseZoom(zoom);
  for (const filePath of paths) {
    try {
      results.push({ file: filePath.split(/[\\/]/).pop(), ...(await win.webContents.executeJavaScript(OPEN_ONE(filePath, zoomed))) });
    } catch (error) {
      results.push({ file: filePath.split(/[\\/]/).pop(), failed: error?.message ?? String(error) });
    }
  }
  return results;
}

module.exports = { parseZoom, run };
