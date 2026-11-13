'use strict';

// 編集モードのボタン列の［左回転］［右回転］（spec-7-4 確定事項RT1・RT2・C1・C2）。
// 押すとすぐ、見ているページ（画像のタブでは画像）だけを 90° 回す。サムネイルで選んでいるページは使わない。
// 回転を覚える所・元に戻す仕組みは、ページ編集モードの［左回転］［右回転］（page-actions.js の rotate）と同じ。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const IMG = 'C:\\photo\\a.png';

async function withAnnot(t, files = { [A]: makeSource({ path: A, name: 'a.pdf' }) }, open = A) {
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  await shell.flush();
  if (open !== null)
    await shell.SigK.tabs.openPath(open);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

const rotations = (shell) => [...shell.SigK.viewer.getPlan()].map((page) => page.rotate);

test('［右回転］は見ているページだけを右に 90° 回し、サムネイルで選んでいるページは使わない（確定事項RT1）', async (t) => {
  const shell = await withAnnot(t);
  const { SigK, document } = shell;
  SigK.viewer.goToPage(1);
  SigK.pageGrid.setSelection([0, 2]);

  document.getElementById('edit-rotate-right').click();
  assert.deepEqual(rotations(shell), [0, 90, 0]);

  document.getElementById('edit-rotate-left').click();
  document.getElementById('edit-rotate-left').click();
  assert.deepEqual(rotations(shell), [0, 270, 0], '左回転は 270 として持つ');
  assert.equal(SigK.annotate.getTool(), null, '道具は持たない');
});

test('回したあとは Ctrl+Z と同じ元に戻すで戻せる（ページ編集と同じ履歴）', async (t) => {
  const shell = await withAnnot(t);
  const { SigK, document } = shell;
  document.getElementById('edit-rotate-right').click();
  assert.deepEqual(rotations(shell), [90, 0, 0]);
  assert.equal(SigK.pageEdit.undo(), true);
  assert.deepEqual(rotations(shell), [0, 0, 0]);
});

test('押したままにならず、持っている道具も替えない', async (t) => {
  const shell = await withAnnot(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('pen');
  const button = document.getElementById('edit-rotate-right');
  button.click();
  assert.equal(button.hasAttribute('aria-pressed'), false);
  assert.equal(button.classList.contains('active'), false);
  assert.equal(SigK.annotate.getTool(), 'pen');
});

test('回す前に、入力中のテキストを確定する（抽出と同じ。spec-4-2 確定事項8）', async (t) => {
  const shell = await withAnnot(t);
  const { SigK, document } = shell;
  let finished = 0;
  const original = SigK.annotate.finishEditing;
  SigK.annotate.finishEditing = (...args) => { finished += 1; return original(...args); };
  t.after(() => { SigK.annotate.finishEditing = original; });
  document.getElementById('edit-rotate-left').click();
  assert.equal(finished, 1);
});

test('文書が開いていなければ灰色で、押しても何もしない', async (t) => {
  const shell = await withAnnot(t, {}, null);
  const { SigK, document } = shell;
  const button = document.getElementById('edit-rotate-right');
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.click();
  assert.equal(SigK.viewer.getState().open, false);
});

test('画像のタブでも灰色にせず、画像（1 ページ目）を回す（確定事項RT1）', async (t) => {
  const files = { [IMG]: { ...makeSource({ path: IMG, name: 'a.png' }), image: { kind: 'png', frames: [{ width: 120, height: 80 }] } } };
  const shell = await withAnnot(t, files, IMG);
  const { SigK, document } = shell;
  const button = document.getElementById('edit-rotate-right');
  assert.equal(button.hasAttribute('aria-disabled'), false);
  button.click();
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
});
