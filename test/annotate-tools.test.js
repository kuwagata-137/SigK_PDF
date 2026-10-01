'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 編集モードの道具（spec-4-1 確定事項1・8、spec-4b-3a 確定事項C）。描かない道具の「選択」は段の先頭にあり、押したときだけ働く。
// 範囲選択そのものは annotate-marquee.test.js が見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function selectButton(shell) {
  return shell.document.querySelector('#edit-bar .edit-tool[data-tool="select"]');
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', node, px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', node, px(to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

test('「選択」は道具の段の先頭にあり、すぐ後ろに区切りがあり、矢印のアイコンを持つ（確定事項C1）', async (t) => {
  const shell = await withShell(t);
  const bar = shell.document.getElementById('edit-bar');
  const first = bar.firstElementChild;
  assert.equal(first.querySelector('.edit-tool').dataset.tool, 'select');
  assert.equal(first.querySelector('.edit-name').textContent, '選択');
  assert.equal(first.nextElementSibling.classList.contains('edit-sep'), true);
  assert.notEqual(first.querySelector('svg'), null, 'アイコンが埋まっている');
});

test('「選択」は押すと持ち、もう一度押すと道具なしに戻る。ほかの道具を押せば替わる（確定事項C2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  selectButton(shell).click();
  assert.equal(SigK.annotate.getTool(), 'select');
  assert.equal(document.documentElement.getAttribute('data-tool'), 'select');
  assert.equal(selectButton(shell).getAttribute('aria-pressed'), 'true');
  selectButton(shell).click();
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(document.documentElement.hasAttribute('data-tool'), false);
  selectButton(shell).click();
  document.querySelector('#edit-bar .edit-tool[data-tool="pen"]').click();
  assert.equal(SigK.annotate.getTool(), 'pen');
  assert.equal(selectButton(shell).getAttribute('aria-pressed'), 'false');
});

test('「選択」を持っているとき、Esc は先に選択を外し、次に道具を外す（確定事項C2・M）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('select');
  SigK.annotate.select(a);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.annotate.getTool(), 'select');
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotate.getTool(), null);
});

test('「選択」は描く道具ではない。右パネルは次に付ける値を出さず、「選択」のヒントを出す（確定事項C3・C5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('select');
  assert.equal(SigK.annotate.drawingTool(), null);
  assert.equal(document.getElementById('props-kind').textContent, '–');
  assert.equal(document.getElementById('props-color-row').hidden, true);
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationHints.HINTS.select);
  SigK.annotate.setTool('pen');
  assert.equal(SigK.annotate.drawingTool(), 'pen');
});

test('「選択」を持って何も選んでいないとき、色・不透明度を変えても、次に付ける値は変わらない（確定事項C3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const before = JSON.stringify(SigK.annotate.getColors());
  const opacity = SigK.annotate.getOpacity('ink');
  SigK.annotate.setTool('select');
  assert.equal(SigK.annotate.setColor('#123456'), false);
  assert.equal(SigK.annotate.setOpacity(0.5), false);
  assert.equal(JSON.stringify(SigK.annotate.getColors()), before);
  assert.equal(SigK.annotate.getOpacity('ink'), opacity);
});

test('「選択」の道具は、編集モードを行き来しても持ち越す（spec-4-1 確定事項8 のまま）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('select');
  SigK.shell.setMode(document, 'view');
  SigK.shell.setMode(document, 'annot');
  assert.equal(SigK.annotate.getTool(), 'select');
});

test('「選択」の道具で書き込みを押して離すと選べ、書き込みの無い所を押して離すと外れる。何も置かれない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('select');
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const at = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(150, 700);
  mouse(shell, 'mousedown', node, at);
  mouse(shell, 'mouseup', node, at);
  assert.equal(SigK.annotate.getSelected(), a);
  const blank = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(400, 300);
  mouse(shell, 'mousedown', node, blank);
  mouse(shell, 'mouseup', node, blank);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
});
