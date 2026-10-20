'use strict';

// 画面の処理（レンダラー）が止まったときの動き（spec-6-1 タスク B の B2。docs/07 決定81 ⑪〔ユーザーが推しを選んだ〕。
// 見本 screenshots/phase6-question-11-renderer-gone.png）。main.js が使う。
// 止まったことの記録は、error-capture.js の watchWebContents が先に書く。ここでは確認の窓を出し、［画面を開き直す］なら画面を
// 読み込み直し、［終了］ならアプリを閉じる。今までは窓の中が白いままになり、何も起きなかった。
// Electron の dialog・app は外から渡す（テストでは偽物）。このファイルは Electron を読まない。

const RELOAD = 0;

// 確認の窓（Windows の窓。dialog.showMessageBox）。ボタンは肯定の［画面を開き直す］を左に置く（~/.claude/CLAUDE.md）。
// 最初の選択と、窓の × と Esc（cancelId）は［画面を開き直す］（うっかり閉じても、アプリは残る）。
const GONE_DIALOG = Object.freeze({
  type: 'warning',
  title: 'SigK PDF',
  message: 'SigK PDF の画面の処理が止まりました',
  detail: '保存していない変更は失われました。保存したファイルは、保存したところまで残っています。\n［画面を開き直す］を押すと、最近使ったファイルから開き直せます。',
  buttons: Object.freeze(['画面を開き直す', '終了']),
  defaultId: RELOAD,
  cancelId: RELOAD,
  noLink: true,
});

// 戻り値は、したこと: 'reload'（読み込み直した）・'quit'（アプリを閉じた）・'skip'（終えている途中・窓が無い）・'smoke'（起動確認。窓は出さない）。
async function handleRendererGone({ win, dialog, app, logError, smoke = false, quitting = false }) {
  if (quitting || win.isDestroyed())
    return 'skip';
  if (smoke)
    return 'smoke';
  let response = RELOAD;
  try {
    ({ response } = await dialog.showMessageBox(win, { ...GONE_DIALOG, buttons: [...GONE_DIALOG.buttons] }));
  } catch (error) {
    logError({ message: '画面の処理が止まったときの確認の窓を出せませんでした', stack: error?.stack });
  }
  if (win.isDestroyed())
    return 'skip';
  if (response === RELOAD) {
    win.webContents.reload();
    return 'reload';
  }
  app.quit();
  return 'quit';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 起動確認 SIGK_SMOKE_CRASH=1。画面の処理をわざと止め、止まったことが記録に残ったかと、確認の窓を出す道を通ったか
// （outcome。起動確認では 'smoke'）を返す。readLog は記録を読み戻す口（errorlog.js の readAll）。
async function runCrashCheck({ win, readLog, outcome, waitMs = 3000 }) {
  win.webContents.forcefullyCrashRenderer();
  const started = Date.now();
  while (outcome() === null && Date.now() - started < waitMs)
    await wait(50);
  const entries = readLog().filter((entry) => entry.message === '画面の処理が止まりました');
  return { outcome: outcome(), logged: entries.length, last: entries.at(-1) ?? null };
}

module.exports = { GONE_DIALOG, handleRendererGone, runCrashCheck };
