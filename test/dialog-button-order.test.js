'use strict';

// 確認の窓のボタンの並び（2026-10-14 のユーザーの指示）。Windows の決まりに合わせ、肯定の選択肢（印刷・上書き・開く・抽出・
// 焼き込む・保存など）を左に、否定・取りやめ（閉じる・保存しない・キャンセル・中止など）を右に置く。並べ替えても、最初に
// フォーカスを当てるボタンは変えない（危ない操作の窓は安全側のボタン）。Tab キーで回る順は DOM の順なので、見た目の左から
// 右と同じになる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

// 窓ごとの、下の段のボタン（左から）。[id, 見出し]。
const ORDER = {
  'print-dialog': [['print-run', '印刷…'], ['print-cancel', '閉じる']],
  'confirm-overwrite': [['confirm-overwrite-ok', '上書き'], ['confirm-overwrite-cancel', '取りやめ']],
  'password-prompt': [['password-prompt-ok', '開く'], ['password-prompt-cancel', 'キャンセル']],
  'confirm-extract': [['confirm-extract-ok', '抽出'], ['confirm-extract-cancel', 'キャンセル']],
  'confirm-flatten': [['confirm-flatten-ok', '焼き込む'], ['confirm-flatten-cancel', 'キャンセル']],
  'confirm-mosaic': [['confirm-mosaic-ok', '置き換えて保存'], ['confirm-mosaic-cancel', 'キャンセル']],
  'confirm-replace': [['confirm-replace-ok', '上書き'], ['confirm-replace-rename', '別名で保存…'], ['confirm-replace-cancel', '中止']],
  'confirm-discard': [['confirm-discard-save', '保存'], ['confirm-discard-discard', '保存しない'], ['confirm-discard-cancel', 'キャンセル']],
  // 保存していない帯をツールで使う前の確認（spec-2-5 確定事項F2。決定80 ㉜。［やめる］を［キャンセル］に改めた）。
  'confirm-unsaved-run': [['confirm-unsaved-run-save', '上書き保存してから実行'], ['confirm-unsaved-run-run', '保存せずに実行'], ['confirm-unsaved-run-cancel', 'キャンセル']],
};

async function withShell(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const footOf = (shell, id) => [...shell.document.querySelectorAll(`#${id} .dlg-foot button`)].map((node) => [node.id, node.textContent]);

// showModal はコードがフォーカスを当てなければ、窓の中で木の順にいちばん先のフォーカスできる要素へ当てる。
function firstFocusable(dialog) {
  return dialog.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
}

test('9 つの確認の窓は、肯定のボタンを左に、取りやめのボタンを右に並べる', async (t) => {
  const shell = await withShell(t);
  for (const [id, buttons] of Object.entries(ORDER))
    assert.deepEqual(footOf(shell, id), buttons, id);
  // 使い方の窓は［閉じる］1 つだけなので変えない。
  assert.deepEqual(footOf(shell, 'help-dialog'), [['help-done', '閉じる']]);
});

test('並べ替えても、確認の窓が最初にフォーカスを当てるのは今と同じボタン（危ない操作は安全側）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const cases = [
    [() => SigK.confirmOverwrite.ask({ name: 'a.pdf' }), 'confirm-overwrite-cancel'],
    [() => SigK.passwordPrompt.ask({ name: 'a.pdf' }), 'password-prompt-input'],
    [() => SigK.confirmExtract.ask({ count: 2 }), 'confirm-extract-ok'],
    [() => SigK.confirmFlatten.ask({ count: 3, name: 'b.pdf', notes: 0 }), 'confirm-flatten-cancel'],
    [() => SigK.confirmMosaic.ask({ mode: 'overwrite', count: 1, pages: '1 ページ目', name: 'a.pdf' }), 'confirm-mosaic-cancel'],
    [() => SigK.confirmReplace.ask({ name: 'b.pdf' }), 'confirm-replace-cancel'],
    [() => SigK.confirmDiscard.ask({ name: 'a.pdf' }), 'confirm-discard-cancel'],
    [() => SigK.confirmUnsavedRun.ask({ entries: [{ name: 'a.pdf', counts: null }] }), 'confirm-unsaved-run-cancel'],
  ];
  for (const [open, focused] of cases) {
    const answer = open();
    assert.equal(document.activeElement?.id, focused);
    // Esc（cancel イベント）で閉じる。どの窓も取りやめとして答える。
    document.activeElement.closest('dialog').dispatchEvent(new shell.window.Event('cancel'));
    await answer;
  }
});

// 印刷の窓はコードでフォーカスを当てず、showModal が見出しの［×］へ当てる。下の段を並べ替えても［×］のまま。
test('印刷の窓の最初のフォーカスは、見出しの［×］のまま', async (t) => {
  const shell = await withShell(t);
  await shell.SigK.viewer.open(makeSource({ path: A }));
  await shell.flush();
  assert.equal(shell.SigK.print.open(), true);
  const dialog = shell.document.getElementById('print-dialog');
  assert.equal(firstFocusable(dialog).id, 'print-close');
  shell.document.getElementById('print-cancel').click();
});
