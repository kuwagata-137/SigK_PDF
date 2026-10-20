'use strict';

// 起動確認 SIGK_SMOKE_MEASURE=<path1>;<path2>;...（spec-6-1 タスク D の D5。決定81 ⑩）。窓を出さずに大きさを測る
// （SIGK_SMOKE_PERF は窓を出すので使わない）。
//
// 並べたファイルを 1 本ずつタブで開き、開くまでの時間と、開いたあとのアプリ全体の実メモリ（app.getAppMetrics() の workingSetSize）を記録する。
// SIGK_SMOKE_MEASURE_SAVE=1 なら、最後に映しているタブの 1 ページ目を回して上書き保存し、保存の間のメモリの山も採る（smoke-source-changed.js と同じ採り方）。
// 安全装置: パソコンの空きメモリが SIGK_SMOKE_MEASURE_MIN_FREE_MB（既定 1,500MB）を切ったら、それ以上は開かずに止め、理由を残す
// （ユーザーのパソコン全体が遅くなるのを避ける）。1 分より長く返事が無い（固まった）ら hung を立てる。

const os = require('node:os');

const { EDIT, measureSave } = require('./smoke-source-changed.js');

const HANG_MS = 60_000;
const mb = (bytes) => Math.round(bytes / 1024 / 1024);

function snapshot(app) {
  const byType = {};
  let total = 0;
  for (const entry of app.getAppMetrics()) {
    const kb = entry.memory?.workingSetSize ?? 0;
    total += kb;
    byType[entry.type] = (byType[entry.type] ?? 0) + Math.round(kb / 1024);
  }
  return { appMb: Math.round(total / 1024), byType, freeMb: mb(os.freemem()) };
}

const OPEN = (filePath) => `(async () => {
  const started = Date.now();
  const opened = await window.SigK.tabs.openPath(${JSON.stringify(filePath)});
  const ms = Date.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const state = window.SigK.viewer.getState();
  return { opened, ms, pages: state.open ? state.pageCount : null, message: state.open ? null : window.SigK.viewer.getMessage() };
})()`;

// 返事が limit より長く無ければ { hung: true }。
function withHangGuard(promise, limit = HANG_MS) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve({ hung: true }), limit); })]).finally(() => clearTimeout(timer));
}

async function run({ app, win, paths, save = false, minFreeMb = 1500 }) {
  const report = { baseline: snapshot(app), opens: [], stopped: null };
  for (const [index, filePath] of paths.entries()) {
    if (mb(os.freemem()) < minFreeMb) {
      report.stopped = `パソコンの空きメモリが ${minFreeMb}MB を切ったので、${index + 1} 本目から開かなかった`;
      break;
    }
    let result;
    try {
      result = await withHangGuard(win.webContents.executeJavaScript(OPEN(filePath)));
    } catch (error) {
      result = { failed: error?.message ?? String(error) };
    }
    report.opens.push({ tab: index + 1, ...result, ...snapshot(app) });
    if (result.failed !== undefined || result.hung === true)
      break;
  }
  if (save && report.stopped === null && report.opens.every((entry) => entry.opened === true)) {
    await win.webContents.executeJavaScript(EDIT);
    report.save = await withHangGuard(measureSave(app, win));
    report.afterSave = snapshot(app);
  }
  return report;
}

module.exports = { HANG_MS, run, withHangGuard };
