'use strict';

// 画面の処理（レンダラー）が止まったときの動き（renderer-gone.js。spec-6-1 タスク B の B2。docs/07 決定81 ⑪）。
// 確認の窓（［画面を開き直す］［終了］）を出し、開き直すなら読み込み直し、終了ならアプリを閉じる。Electron の部品は偽物を渡す。
// 見本: screenshots/phase6-question-11-renderer-gone.png

const test = require('node:test');
const assert = require('node:assert/strict');

const { GONE_DIALOG, handleRendererGone, runCrashCheck } = require('../renderer-gone.js');

function fakes({ response = 0, destroyed = false, dialogThrows = null } = {}) {
  const calls = [];
  const logged = [];
  const win = {
    isDestroyed: () => destroyed,
    webContents: { reload: () => calls.push('reload') },
  };
  const dialog = {
    showMessageBox: async (parent, options) => {
      calls.push(['dialog', parent === win, options]);
      if (dialogThrows)
        throw dialogThrows;
      return { response };
    },
  };
  const app = { quit: () => calls.push('quit') };
  return { win, dialog, app, calls, logged, logError: (entry) => logged.push(entry) };
}

test('確認の窓の文とボタン: 肯定の［画面を開き直す］を左、［終了］を右。最初の選択と × と Esc は［画面を開き直す］', () => {
  assert.equal(GONE_DIALOG.type, 'warning');
  assert.equal(GONE_DIALOG.title, 'SigK PDF');
  assert.equal(GONE_DIALOG.message, 'SigK PDF の画面の処理が止まりました');
  assert.equal(GONE_DIALOG.detail,
    '保存していない変更は失われました。保存したファイルは、保存したところまで残っています。\n［画面を開き直す］を押すと、最近使ったファイルから開き直せます。');
  assert.deepEqual(GONE_DIALOG.buttons, ['画面を開き直す', '終了']);
  assert.equal(GONE_DIALOG.defaultId, 0);
  assert.equal(GONE_DIALOG.cancelId, 0, '窓の × と Esc でも、アプリを残す方にする');
  assert.equal(GONE_DIALOG.noLink, true, 'ボタンの形で並べる（Windows の大きな選択肢の形にしない）');
});

test('［画面を開き直す］なら、主窓の画面を読み込み直す', async () => {
  const f = fakes({ response: 0 });
  assert.equal(await handleRendererGone(f), 'reload');
  assert.equal(f.calls[0][0], 'dialog');
  assert.equal(f.calls[0][1], true, '主窓を親にして出す');
  assert.deepEqual(f.calls[0][2].buttons, GONE_DIALOG.buttons);
  assert.equal(f.calls[1], 'reload');
});

test('［終了］なら、アプリを閉じる', async () => {
  const f = fakes({ response: 1 });
  assert.equal(await handleRendererGone(f), 'quit');
  assert.deepEqual(f.calls.slice(1), ['quit']);
});

test('アプリを終えている途中・窓がもう無いときは、何もしない', async () => {
  const quitting = fakes();
  assert.equal(await handleRendererGone({ ...quitting, quitting: true }), 'skip');
  assert.deepEqual(quitting.calls, []);
  const gone = fakes({ destroyed: true });
  assert.equal(await handleRendererGone(gone), 'skip');
  assert.deepEqual(gone.calls, []);
});

test('起動確認（smoke）では窓を出さず、出すはずだったことだけを返す', async () => {
  const f = fakes();
  assert.equal(await handleRendererGone({ ...f, smoke: true }), 'smoke');
  assert.deepEqual(f.calls, []);
});

test('確認の窓を出せなかったときは記録に残し、画面を読み込み直す（アプリを残す方）', async () => {
  const f = fakes({ dialogThrows: new Error('no dialog') });
  assert.equal(await handleRendererGone(f), 'reload');
  assert.equal(f.logged[0].message, '画面の処理が止まったときの確認の窓を出せませんでした');
  assert.equal(f.calls.at(-1), 'reload');
});

test('runCrashCheck（起動確認 SIGK_SMOKE_CRASH）は画面の処理を止め、記録と、窓を出す道を通ったかを返す', async () => {
  let outcome = null;
  const win = { webContents: { forcefullyCrashRenderer: () => { setTimeout(() => { outcome = 'smoke'; }, 20); } } };
  const log = [{ message: '別の記録' }, { message: '画面の処理が止まりました', context: { reason: 'killed', exitCode: 1 } }];
  const report = await runCrashCheck({ win, readLog: () => log, outcome: () => outcome, waitMs: 1000 });
  assert.deepEqual(report, { outcome: 'smoke', logged: 1, last: { message: '画面の処理が止まりました', context: { reason: 'killed', exitCode: 1 } } });
});

test('runCrashCheck は、止まった知らせが来なければ待つのをやめて outcome: null を返す', async () => {
  const win = { webContents: { forcefullyCrashRenderer: () => {} } };
  const report = await runCrashCheck({ win, readLog: () => [], outcome: () => null, waitMs: 150 });
  assert.deepEqual(report, { outcome: null, logged: 0, last: null });
});
