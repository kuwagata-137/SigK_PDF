'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 閲覧の［選択］［ハンド］と編集の道具の引き継ぎ、起動時の当て（spec-2-5 確定事項K5・K9・K10。決定80 ㉔㉗）。
// 編集の道具とはハンドかどうかだけを引き継ぐ。閲覧・ページ編集で選んだ方は、編集モードへ入るときに編集の道具へ映す。

const A = 'C:\\work\\a.pdf';

async function withShell(t, { ui } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) }, ...(ui === undefined ? {} : { ui }) });
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.SigK.app.ready;
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

function setMode(shell, mode) {
  shell.SigK.shell.setMode(shell.document, mode);
}

function esc(shell) {
  shell.document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

const pointerCalls = (shell) => shell.uiCalls.filter((patch) => 'viewPointer' in patch).map((patch) => patch.viewPointer);

test('編集モードで道具をハンドにすると閲覧もハンドになって覚え、ほかの道具にすると選択に戻る（K9）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  setMode(shell, 'annot');

  SigK.annotate.toggleTool('hand');
  assert.equal(SigK.pointerMode.get(), 'hand');
  SigK.annotate.toggleTool('pen');
  assert.equal(SigK.pointerMode.get(), 'select');
  SigK.annotate.toggleTool('hand');
  esc(shell);
  assert.equal(SigK.annotate.getTool(), null, 'Esc で道具を外す');
  assert.equal(SigK.pointerMode.get(), 'select');
  assert.deepEqual(pointerCalls(shell), ['hand', 'select', 'hand', 'select']);
  // 選択の道具・道具なしの間の行き来では覚え直さない。
  SigK.annotate.toggleTool('select');
  SigK.annotate.toggleTool('select');
  assert.deepEqual(pointerCalls(shell), ['hand', 'select', 'hand', 'select']);
});

test('編集モードのハンドのまま閲覧へ移ると［ハンド］を押した形で、紙を引ける（K9）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  setMode(shell, 'annot');
  SigK.annotate.toggleTool('hand');
  setMode(shell, 'view');

  assert.equal(document.getElementById('btn-pointer-hand').classList.contains('active'), true);
  assert.equal(document.documentElement.getAttribute('data-pointer'), 'hand');
});

test('閲覧で［ハンド］にして編集へ入ると、編集の道具はハンド（K9）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  setMode(shell, 'annot');
  SigK.annotate.toggleTool('pen');
  setMode(shell, 'view');
  SigK.pointerMode.press('hand');
  assert.equal(SigK.annotate.getTool(), 'pen', '閲覧にいる間は編集の道具を替えない');

  setMode(shell, 'annot');
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(document.querySelector('#edit-bar [data-tool="hand"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('btn-pointer-hand').classList.contains('active'), true);
});

test('閲覧で［選択］に戻して編集へ入ると、編集の道具がハンドならハンドの前の戻り先へ戻す。ほかの道具は替えない（K9）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  setMode(shell, 'annot');
  SigK.annotate.toggleTool('select');
  SigK.annotateTools.chord();
  assert.equal(SigK.annotate.getTool(), 'hand');
  setMode(shell, 'view');
  SigK.pointerMode.press('select');
  setMode(shell, 'annot');
  assert.equal(SigK.annotate.getTool(), 'select', '戻り先は選択');

  SigK.annotate.toggleTool('select');
  SigK.annotate.toggleTool('hand');
  setMode(shell, 'pages');
  SigK.pointerMode.chord();
  assert.equal(SigK.pointerMode.get(), 'select');
  setMode(shell, 'annot');
  assert.equal(SigK.annotate.getTool(), null, '戻り先は道具なし');

  SigK.annotate.toggleTool('marker');
  setMode(shell, 'view');
  setMode(shell, 'annot');
  assert.equal(SigK.annotate.getTool(), 'marker', '選択のままならハンドでない道具は替えない');
});

test('前回ハンドで終えていたら、閲覧はハンドで始まり、覚え直さない（K5・K10）', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', viewPointer: 'hand', sidePanel: { open: true, width: 240 } } });
  const { SigK, document } = shell;

  assert.equal(SigK.pointerMode.get(), 'hand');
  assert.equal(document.documentElement.getAttribute('data-pointer'), 'hand');
  assert.equal(document.getElementById('btn-pointer-hand').classList.contains('active'), true);
  assert.deepEqual(pointerCalls(shell), [], '起動時の当ては覚え直さない');
  assert.equal(SigK.annotate.getTool(), null, '閲覧で始まるなら編集の道具はまだ替えない');
  setMode(shell, 'annot');
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.deepEqual(pointerCalls(shell), []);
});

test('前回ハンドで編集モードのまま終えていたら、編集の道具はハンドで始まる。選択なら道具なし（K10）', async (t) => {
  const hand = await withShell(t, { ui: { mode: 'annot', viewPointer: 'hand', sidePanel: { open: true, width: 240 } } });
  assert.equal(hand.document.documentElement.getAttribute('data-mode'), 'annot');
  assert.equal(hand.SigK.annotate.getTool(), 'hand');
  assert.equal(hand.document.getElementById('btn-pointer-hand').classList.contains('active'), true);
  assert.deepEqual(pointerCalls(hand), []);

  const select = await withShell(t, { ui: { mode: 'annot', viewPointer: 'select', sidePanel: { open: true, width: 240 } } });
  assert.equal(select.SigK.annotate.getTool(), null);
  assert.equal(select.SigK.pointerMode.get(), 'select');

  // 古い settings.json（viewPointer が無い）は選択で始まる。
  const old = await withShell(t, { ui: { mode: 'view', sidePanel: { open: true, width: 240 } } });
  assert.equal(old.SigK.pointerMode.get(), 'select');
});
