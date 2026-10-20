'use strict';

// 起動確認 SIGK_SMOKE_ABNORMAL=<path1>;<path2>;...（spec-6-1 タスク D の D2。ロードマップ 6-3）。
//
// 異常な PDF（空・見出しだけ・中身が PDF でない・壊れた・パスワード付き・所有者パスワードだけ・AES-128・1 ページだけ壊れた など）を、
// 本物の pdf.js で 1 本ずつ開き、閲覧のタブとツールモードの帯でどう見えるかを記録する。テストはどれも pdf.js のスタブなので、
// 本物で開く確かめはここだけ。パスワードを聞かれたら user1 を入れる（検体の決まり。test/fixtures の encrypted.pdf・aes-128.pdf）。
// 開いたタブは毎回閉じる（保存していない変更は無いので確認は出ない）。

// 1 本を閲覧で開き、ツールモード（透かし）の帯の様子も見て、閉じる。
const OPEN_ONE = (filePath) => `(async () => {
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

async function run({ win, paths }) {
  const results = [];
  for (const filePath of paths) {
    try {
      results.push({ file: filePath.split(/[\\/]/).pop(), ...(await win.webContents.executeJavaScript(OPEN_ONE(filePath))) });
    } catch (error) {
      results.push({ file: filePath.split(/[\\/]/).pop(), failed: error?.message ?? String(error) });
    }
  }
  return results;
}

module.exports = { run };
