'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, DEFAULT_VIEWPORT } = require('./harness.js');

// 「ハンド」の道具（spec-4b-3b 確定事項A）。段の「選択」の隣にあり、持っている間は #view のどこを左で押して引いても表示が動く。
// 左ボタンでは書き込みを見ない（当たり・つまみ・ダブルクリック）。jsdom はスクロール量を丸めないので、引いた差がそのまま出る。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function handButton(shell) {
  return shell.document.querySelector('#edit-bar .edit-tool[data-tool="hand"]');
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

function mouse(shell, type, target, [x, y], { button = 0 } = {}) {
  const buttons = type === 'mouseup' ? 0 : [1, 4, 2][button];
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons });
  target.dispatchEvent(event);
  return event;
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

function view(shell) {
  return shell.document.getElementById('view');
}

function scrollOf(shell) {
  return [view(shell).scrollLeft, view(shell).scrollTop];
}

test('「ハンド」は道具の段の「選択」のすぐ後ろ、区切りの前にあり、手のアイコンと名前を持つ（確定事項A1）', async (t) => {
  const shell = await withShell(t);
  const bar = shell.document.getElementById('edit-bar');
  const item = handButton(shell).closest('.edit-item');
  assert.equal(item.previousElementSibling, bar.firstElementChild);
  assert.equal(item.previousElementSibling.querySelector('.edit-tool').dataset.tool, 'select');
  assert.equal(item.nextElementSibling.classList.contains('edit-sep'), true);
  assert.equal(item.querySelector('.edit-name').textContent, 'ハンド');
  assert.notEqual(item.querySelector('svg'), null, 'アイコンが埋まっている');
});

test('「ハンド」は押すと持ち、もう一度押すと道具なしに戻る。描く道具ではないので右パネルの描く欄は出さない（確定事項A2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  handButton(shell).click();
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(SigK.annotate.drawingTool(), null);
  assert.equal(document.documentElement.getAttribute('data-tool'), 'hand');
  assert.equal(handButton(shell).getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationHints.HINTS.hand);
  handButton(shell).click();
  assert.equal(SigK.annotate.getTool(), null);
});

test('ハンドで紙の上を左で押して引くと、引いた向きと逆に表示が動き、引いている間だけ data-panning が付く（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('hand');
  view(shell).scrollLeft = 50;
  view(shell).scrollTop = 400;
  const down = mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  assert.equal(down.defaultPrevented, true, '文字を選ばせない');
  assert.equal(document.documentElement.hasAttribute('data-panning'), true);
  mouse(shell, 'mousemove', document.body, [290, 260]);
  assert.deepEqual(scrollOf(shell), [60, 440]);
  mouse(shell, 'mousemove', document.body, [320, 200]);
  assert.deepEqual(scrollOf(shell), [30, 500]);
  mouse(shell, 'mouseup', document.body, [320, 200]);
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  mouse(shell, 'mousemove', document.body, [0, 0]);
  assert.deepEqual(scrollOf(shell), [30, 500], '離したら動かない');
});

test('ハンドは紙の外の灰色の所からも引ける。スクロールバーの上の押しでは引かない（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('hand');
  mouse(shell, 'mousedown', view(shell), [20, 300]);
  mouse(shell, 'mousemove', document.body, [20, 250]);
  mouse(shell, 'mouseup', view(shell), [20, 250]);
  assert.deepEqual(scrollOf(shell), [0, 50]);
  // jsdom では #view の左上が (0,0) で、clientWidth（900）より右はスクロールバーの上。
  mouse(shell, 'mousedown', view(shell), [DEFAULT_VIEWPORT.width + 4, 300]);
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  mouse(shell, 'mousemove', document.body, [DEFAULT_VIEWPORT.width + 4, 200]);
  mouse(shell, 'mouseup', view(shell), [DEFAULT_VIEWPORT.width + 4, 200]);
  assert.deepEqual(scrollOf(shell), [0, 50]);
});

test('ハンドで書き込みの上を押して引いても、書き込みは動かず、選択も変わらない（確定事項A4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  const rectOf = () => [...SigK.viewer.getAnnotations().added.find((entry) => entry.id === a).rect];
  const before = rectOf();
  SigK.annotate.select(b);
  SigK.annotate.setTool('hand');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [150, 650]));
  mouse(shell, 'mousemove', document.body, px(shell, [180, 640]));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [180, 640]));
  assert.deepEqual(rectOf(), before);
  assert.deepEqual([...SigK.annotate.getSelection()], [b]);
  // 押して離すだけでも選ばない・外さない。
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [150, 650]));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [150, 650]));
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [500, 300]));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [500, 300]));
  assert.deepEqual([...SigK.annotate.getSelection()], [b]);
  assert.equal(SigK.viewer.getAnnotations().added.length, 2);
});

test('ハンドのとき、選んでいる四角の角のつまみを押して引いても大きさは変わらず、表示が動く（確定事項A4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const rectOf = () => [...SigK.viewer.getAnnotations().added.find((entry) => entry.id === a).rect];
  const before = rectOf();
  SigK.annotate.select(a);
  SigK.annotate.setTool('hand');
  // 左上の角のつまみ（道具なしなら大きさが変わる所）。
  const corner = SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === 'x1y1').at;
  mouse(shell, 'mousedown', pageNode(shell), corner);
  mouse(shell, 'mousemove', document.body, [corner[0] - 40, corner[1] - 40]);
  mouse(shell, 'mouseup', pageNode(shell), [corner[0] - 40, corner[1] - 40]);
  assert.deepEqual(rectOf(), before);
  assert.deepEqual(scrollOf(shell), [40, 40]);
  assert.equal(document.documentElement.hasAttribute('data-transform-cursor'), false);
});

test('ハンドのとき、書き込みをダブルクリックしても直し始めない（確定事項A4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  drawSquare(shell, [100, 700], [200, 600]);
  const calls = [];
  SigK.annotateText.beginEdit = (key) => { calls.push(key); return true; };
  const at = px(shell, [150, 650]);
  pageNode(shell).dispatchEvent(new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1] }));
  assert.equal(calls.length, 1, '道具なしなら直し始める（比べるため）');
  SigK.annotate.setTool('hand');
  pageNode(shell).dispatchEvent(new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1] }));
  assert.equal(calls.length, 1);
});

test('ハンドのとき、右や中のボタンで押して引いても表示は動かない（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('hand');
  for (const button of [1, 2]) {
    mouse(shell, 'mousedown', pageNode(shell), [300, 300], { button });
    mouse(shell, 'mousemove', document.body, [300, 200], { button });
    mouse(shell, 'mouseup', pageNode(shell), [300, 200], { button });
  }
  assert.deepEqual(scrollOf(shell), [0, 0]);
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
});

test('引いている途中の Esc は引くのを終えるだけで、次の Esc で道具なしに戻る。モードを離れても終える（確定事項A3・G）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('hand');
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  mouse(shell, 'mousemove', document.body, [300, 250]);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  assert.equal(SigK.annotate.getTool(), 'hand');
  mouse(shell, 'mousemove', document.body, [300, 100]);
  assert.deepEqual(scrollOf(shell), [0, 50], 'Esc の後は動かない');
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotate.getTool(), null);

  SigK.annotate.setTool('hand');
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  SigK.shell.setMode(document, 'view');
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
});

test('引いている途中に離しが届かず、ボタンを押していない動きが来たら引くのを終える。窓のフォーカスが外れても終える（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('hand');
  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  mouse(shell, 'mousemove', document.body, [300, 250]);
  assert.deepEqual(scrollOf(shell), [0, 50]);
  document.body.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 300, clientY: 100, buttons: 0 }));
  assert.deepEqual(scrollOf(shell), [0, 50], 'ボタンを押していない動きでは引かない');
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);

  mouse(shell, 'mousedown', pageNode(shell), [300, 300]);
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  mouse(shell, 'mousemove', document.body, [300, 200]);
  assert.deepEqual(scrollOf(shell), [0, 50]);
});
