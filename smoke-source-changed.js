'use strict';

// 起動確認 SIGK_SMOKE_SOURCE_CHANGED=<出力先>（spec-6-1 タスク C の C4）。SIGK_SMOKE_PDF（か SIGK_SMOKE_PERF）と一緒に使う。
//
// 開いたあとでほかのアプリに書き換えられたファイルを上書き保存したとき、画面が開いたときの中身（pdf.js の getData()）を
// ワーカーへ送るぶん、メモリの山がどれだけ増えるかを測る。入力を出力先へ複製して開き、
//   1. ふつうの上書き保存（書き換えなし）
//   2. 書き換えてからの上書き保存（確認の窓［上書き］を押す）
// の 2 回を、保存の間 100ms ごとにアプリ全体の実メモリ（app.getAppMetrics() の workingSetSize）を採って比べる。
// electron は起動確認のときだけ読む（main.js が SIGK_SMOKE_SOURCE_CHANGED のときだけ require する）。

const fs = require('node:fs');

const SAMPLE_MS = 100;

// 保存の間のメモリを採る。stop() で { peakMb, peakByType } を返す。
function startSampler(app) {
  const peak = { total: 0, byType: {} };
  const take = () => {
    let total = 0;
    for (const entry of app.getAppMetrics()) {
      const kb = entry.memory?.workingSetSize ?? 0;
      total += kb;
      peak.byType[entry.type] = Math.max(peak.byType[entry.type] ?? 0, kb);
    }
    peak.total = Math.max(peak.total, total);
  };
  take();
  const timer = setInterval(take, SAMPLE_MS);
  const mb = (kb) => Math.round(kb / 1024);
  return {
    stop() {
      clearInterval(timer);
      take();
      return { peakMb: mb(peak.total), peakByType: Object.fromEntries(Object.entries(peak.byType).map(([type, kb]) => [type, mb(kb)])) };
    },
  };
}

// 1 ページ目を回す（保存していない変更を作る）。開き直したあとにも呼ぶ。
const EDIT = `(async () => {
  window.SigK.shell.setMode(document, 'pages');
  window.SigK.pageEdit.rotate(90, [0]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  return window.SigK.viewer.isDirty();
})()`;

// 上書き保存する。確認の窓が出たら［上書き］を押す（書き換えたときだけ出る）。
const SAVE = `(async () => {
  const SigK = window.SigK;
  const started = Date.now();
  const saving = SigK.save.saveActive();
  let confirmShown = false;
  const watch = setInterval(() => {
    if (SigK.confirmOverwrite.isOpen()) {
      confirmShown = true;
      document.getElementById('confirm-overwrite-ok').click();
    }
  }, 50);
  const result = await saving;
  clearInterval(watch);
  return { ok: result?.ok === true, error: result?.error ?? null, bytes: result?.bytes ?? null, ms: Date.now() - started, confirmShown, banner: SigK.viewBanner.text() };
})()`;

async function measureSave(app, win) {
  const sampler = startSampler(app);
  const result = await win.webContents.executeJavaScript(SAVE);
  return { ...result, ...sampler.stop() };
}

async function run({ app, win, source, target }) {
  fs.copyFileSync(source, target);
  await win.webContents.executeJavaScript(`window.SigK.tabs.openPath(${JSON.stringify(target)}).then(() => new Promise((resolve) => setTimeout(resolve, 1500)))`);
  const sizeMb = Math.round(fs.statSync(target).size / 1024 / 1024);
  const report = { target, sizeMb };
  report.dirtyBefore = await win.webContents.executeJavaScript(EDIT);
  report.plain = await measureSave(app, win);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  report.dirtyBeforeChanged = await win.webContents.executeJavaScript(EDIT);
  // ほかのアプリの書き換えの代わり。%%EOF の後ろに足しても PDF としては読めるが、大きさと更新時刻が変わる。
  fs.appendFileSync(target, '\n% changed by smoke-source-changed\n');
  report.changed = await measureSave(app, win);
  return report;
}

module.exports = { SAMPLE_MS, EDIT, startSampler, measureSave, run };
