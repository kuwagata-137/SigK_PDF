'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 編集の道具の段（edit-bar.js。spec-4b-1a 確定事項1〜7）。押したときの道具の持ち方・離し方と、図形の種類の
// 替え方は annotate-shape.test.js・annotate.test.js が見ており、ここは段そのものの作りと印の揃え方を見る。
// 編集モードのときだけ出すのは CSS（html[data-mode="annot"] #edit-bar）で、jsdom は描かないので起動確認で見る。

async function withShell(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pressed(document) {
  return [...document.querySelectorAll('#edit-bar .edit-tool')].filter((el) => el.getAttribute('aria-pressed') === 'true').map((el) => el.dataset.shape ?? el.dataset.tool);
}

test('道具の段は、キーボードで押せるボタンに名前とアイコンを添え、段は道具の並びとして読み上げる', async (t) => {
  const { document } = await withShell(t);
  const bar = document.getElementById('edit-bar');
  assert.equal(bar.getAttribute('role'), 'toolbar');
  assert.equal(bar.getAttribute('aria-label'), '書き込みの道具');
  // ツールバーの下・本体の上に置く（spec-4b-1a 確定事項1）。
  assert.equal(bar.previousElementSibling.id, 'toolbar');
  assert.equal(bar.nextElementSibling.id, 'body');
  for (const button of bar.querySelectorAll('.edit-tool')) {
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(button.getAttribute('aria-label'), button.title);
    assert.equal(button.nextElementSibling.textContent, button.title);
    assert.ok(button.querySelector('svg') !== null, `${button.title} のアイコン`);
  }
});

test('sync は、持っている道具（図形は種類まで）のボタンだけに印を付ける', async (t) => {
  const { document, SigK } = await withShell(t);
  assert.deepEqual(pressed(document), []);
  SigK.editBar.sync('shape', 'circle');
  assert.deepEqual(pressed(document), ['circle']);
  assert.equal(document.querySelector('#edit-bar [data-shape="circle"]').classList.contains('active'), true);
  SigK.editBar.sync('text', 'circle');
  assert.deepEqual(pressed(document), ['text']);
  SigK.editBar.sync(null, 'square');
  assert.deepEqual(pressed(document), []);
});

test('道具を持ち替える操作（API・Esc）でも段の印が揃う', async (t) => {
  const { document, SigK } = await withShell(t);
  SigK.annotate.setTool('note');
  assert.deepEqual(pressed(document), ['note']);
  SigK.annotateShape.setShapeKind('line');
  SigK.annotate.setTool('shape');
  assert.deepEqual(pressed(document), ['line']);
  // 起動時に覚えた種類を戻したときも揃う。
  SigK.annotateShape.applyShapeKind('arrow');
  assert.deepEqual(pressed(document), ['arrow']);
  assert.equal(SigK.annotate.escape(), true);
  assert.deepEqual(pressed(document), []);
});

test('押すたびに道具を持ち、同じボタンで離す。マークアップも同じ', async (t) => {
  const { document, SigK } = await withShell(t);
  const highlight = document.querySelector('#edit-bar .edit-tool[data-tool="highlight"]');
  highlight.click();
  assert.equal(SigK.annotate.getTool(), 'highlight');
  document.querySelector('#edit-bar .edit-tool[data-tool="text"]').click();
  assert.equal(SigK.annotate.getTool(), 'text');
  assert.deepEqual(pressed(document), ['text']);
  document.querySelector('#edit-bar .edit-tool[data-tool="text"]').click();
  assert.equal(SigK.annotate.getTool(), null);
});

// マウスで押したときは押したボタンにフォーカスを残さない。キーボードで押したときは残す（計画外の直し③）。
// Windows の Chromium はマウスの押下でボタンへフォーカスを移すが、jsdom は移さないので、テストの中で focus() してから
// detail が 1 の click（マウス）を送る。キーボードの Enter・Space で押した click は detail が 0。
function clickBy(shell, button, { mouse }) {
  button.focus();
  button.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: mouse ? 1 : 0 }));
}

test('道具の段のボタンをマウスで押すと道具を持ち、フォーカスはボタンに残らない。キーボードで押せばボタンに残る（計画外の直し③）', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const trim = document.querySelector('#edit-bar .edit-tool[data-tool="trim"]');
  clickBy(shell, trim, { mouse: true });
  assert.equal(SigK.annotate.getTool(), 'trim');
  assert.notEqual(document.activeElement, trim, 'マウスで押したボタンにフォーカスが残っている');
  // 図形のボタン（種類を替える）も同じ。
  const circle = document.querySelector('#edit-bar .edit-tool[data-shape="circle"]');
  clickBy(shell, circle, { mouse: true });
  assert.deepEqual(pressed(document), ['circle']);
  assert.notEqual(document.activeElement, circle);
  // キーボードで押したときは、続けてキーで操作できるようにボタンに残す。
  const pen = document.querySelector('#edit-bar .edit-tool[data-tool="pen"]');
  clickBy(shell, pen, { mouse: false });
  assert.equal(SigK.annotate.getTool(), 'pen');
  assert.equal(document.activeElement, pen);
});
