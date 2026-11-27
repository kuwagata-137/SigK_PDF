'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// マーキングのハンドルとプロパティパネルの行（spec-7-9 確定事項F2・F4・F5）。配置は annotate-marking.test.js が見る。

const A = 'C:\\work\\a.pdf';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withShell(t) {
  const shell = await createShell({ pdfjs: createPdfjsStub({ annotations: {} }), files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

// pt の点にマーキングを配置して、マーキングの書き込みツールを解除する。
function place(shell, point, shape = 'target') {
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  SigK.annotateMarking.setShape(shape);
  const at = px(shell, point);
  mouse(shell, 'mousedown', pageNode(shell), at);
  mouse(shell, 'mouseup', pageNode(shell), at);
  SigK.annotate.setTool(null);
  return current(shell);
}

function current(shell) {
  return shell.SigK.viewer.getAnnotations().added.at(-1);
}

function rowsOf(document) {
  const byId = (id) => document.getElementById(id);
  return {
    shape: byId('props-marking-shape-row'), outer: byId('props-marking-outer-row'), outerLabel: byId('props-marking-outer-label'), outerField: byId('props-marking-outer'),
    inner: byId('props-marking-inner-row'), innerLabel: byId('props-marking-inner-label'), innerField: byId('props-marking-inner'),
    number: byId('props-marking-number-row'), numberField: byId('props-marking-number'),
  };
}

function enter(shell, input, text) {
  input.focus();
  input.value = text;
  input.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

// 表示の座標のハンドルを、dx・dy（px）だけドラッグする。
function dragHandle(shell, id, [dx, dy]) {
  const handle = shell.SigK.annotationFrame.shown().shape.handles.find((each) => each.id === id);
  const base = pageNode(shell).getBoundingClientRect();
  const from = [base.left + handle.at[0], base.top + handle.at[1]];
  mouse(shell, 'mousedown', pageNode(shell), from);
  mouse(shell, 'mousemove', shell.document.body, [from[0] + dx / 2, from[1] + dy / 2]);
  mouse(shell, 'mousemove', shell.document.body, [from[0] + dx, from[1] + dy]);
  mouse(shell, 'mouseup', shell.document.body, [from[0] + dx, from[1] + dy]);
}

const center = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];

test('マーキングの書き込みツールでは形の行と大きさの行（次に配置する値）を、選択した時は番号の行も表示する。回転と大きさ（幅・高さ）の行は表示しない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  assert.equal(rows.shape.hidden, true);
  SigK.annotate.setTool('marking');
  assert.equal(rows.shape.hidden, false);
  assert.deepEqual([rows.outer.hidden, rows.inner.hidden, rows.number.hidden], [false, false, true]);
  assert.deepEqual([rows.outerLabel.textContent, rows.outerField.value, rows.innerLabel.textContent, rows.innerField.value], ['外の円の直径', '100', '中の円の直径', '15']);
  const buttons = [...document.querySelectorAll('#props-marking-shape button')];
  assert.deepEqual(buttons.map((button) => [button.dataset.shape, button.getAttribute('aria-label'), button.dataset.tip]), [
    ['target', '点付き丸', 'marking.target'], ['double', '二重丸', 'marking.double'], ['crosshair', '照準', 'marking.crosshair'],
    ['number', '番号付き丸', 'marking.number'], ['caution', '注意マーク', 'marking.caution']]);
  assert.ok(buttons.every((button) => button.querySelector('svg') !== null));
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  // 線の色・線の太さ・透明度の行は表示し、塗りつぶし・ハッチング・線種の行は表示しない。
  const shown = (id) => document.getElementById(id).hidden === false;
  assert.deepEqual(['props-color-row', 'props-width-row', 'props-opacity-row'].map(shown), [true, true, true]);
  assert.deepEqual(['props-fill-row', 'props-hatch-row', 'props-style-row', 'props-angle-row', 'props-box-size-row', 'props-keep-ratio-row'].map(shown), [false, false, false, false, false, false]);
  assert.equal(document.getElementById('props-width').value, '3');
  buttons[3].click();
  assert.deepEqual([rows.innerLabel.textContent, rows.innerField.value], ['文字サイズ', '50']);
  buttons[2].click();
  assert.deepEqual([rows.innerLabel.textContent, rows.innerField.value], ['十字線の長さ', '150']);
  buttons[4].click();
  assert.deepEqual([rows.outerLabel.textContent, rows.inner.hidden], ['三角形の幅', true]);
  const entry = place(shell, [200, 600], 'number');
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.deepEqual([rows.number.hidden, rows.numberField.value], [false, '1']);
  assert.equal(document.getElementById('props-angle-row').hidden, true);
});

test('形のボタンで、選択中のマーキングの形を中心を保って変える。番号付き丸にすると次の番号を付ける', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const entry = place(shell, [200, 600]);
  const before = center(entry.rect);
  document.querySelector('#props-marking-shape [data-shape="crosshair"]').click();
  assert.equal(current(shell).marking.shape, 'crosshair');
  assert.deepEqual(plain(center(current(shell).rect)), plain(before));
  assert.ok(Math.abs(current(shell).rect[2] - current(shell).rect[0] - 150) < 1e-9, 'rect は十字線まで');
  document.querySelector('#props-marking-shape [data-shape="number"]').click();
  assert.equal(current(shell).marking.number, 1);
  SigK.pageEdit.undo();
  assert.equal(current(shell).marking.shape, 'crosshair');
});

test('数値欄で大きさを変える。範囲の外・中の円が外の円より大きくなる値・数でない値は今の値に戻す', async (t) => {
  const shell = await withShell(t);
  const { document } = shell;
  const rows = rowsOf(document);
  const entry = place(shell, [200, 600]);
  enter(shell, rows.outerField, '50');
  // 外の円を変えると、中の円・十字線・文字サイズも同じ比で変える（質問 MK3 案A）。
  assert.deepEqual([current(shell).marking.outer, current(shell).marking.dot, current(shell).marking.cross], [50, 7.5, 75]);
  assert.equal(rows.innerField.value, '7.5');
  assert.deepEqual(plain(center(current(shell).rect)), plain(center(entry.rect)));
  enter(shell, rows.innerField, '20');
  assert.equal(current(shell).marking.dot, 20);
  for (const text of ['60', '0.5', 'abc', '', '800']) {
    const field = text === '800' ? rows.outerField : rows.innerField;
    enter(shell, field, text);
    assert.equal(field.value, text === '800' ? '50' : '20', `「${text}」`);
  }
  assert.deepEqual([current(shell).marking.outer, current(shell).marking.dot], [50, 20]);
  // 外の円を小さくすると、中の円も同じ比で小さくする（20 × 10/50）。
  enter(shell, rows.outerField, '10');
  assert.deepEqual([current(shell).marking.outer, current(shell).marking.dot], [10, 4]);
});

test('番号の数値欄で番号付き丸の番号を変える', async (t) => {
  const shell = await withShell(t);
  const rows = rowsOf(shell.document);
  place(shell, [200, 600], 'number');
  enter(shell, rows.numberField, '12');
  assert.equal(current(shell).marking.number, 12);
  enter(shell, rows.numberField, '0');
  assert.equal(rows.numberField.value, '12');
});

test('外の円の上下左右に四角いハンドル、中の円の右に丸いハンドル。注意マークは外側の 4 つだけで、回転のハンドルは無い', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  place(shell, [200, 600]);
  const shape = SigK.annotationFrame.shown().shape;
  assert.deepEqual(plain(shape.handles.map((handle) => `${handle.id}:${handle.kind}`)), ['outer-x1:outer', 'outer-x2:outer', 'outer-y1:outer', 'outer-y2:outer', 'inner:inner']);
  assert.equal(document.querySelectorAll('.annot-frame-layer rect.annot-handle.square').length, 4);
  assert.equal(document.querySelectorAll('.annot-frame-layer circle.annot-handle').length, 1);
  assert.equal(document.querySelector('.annot-frame-layer .rotate'), null);
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  const [cx] = px(shell, [200, 600]);
  assert.ok(Math.abs(shape.handles[1].at[0] - (cx + 50 * scale)) < 1, '右のハンドルは外の円の右端');
  assert.ok(Math.abs(shape.handles[4].at[0] - (cx + 7.5 * scale + 5)) < 1, '中の円のハンドルは中の円の右端から半径 5px だけ右');
  place(shell, [300, 600], 'caution');
  assert.deepEqual(plain(SigK.annotationFrame.shown().shape.handles.map((handle) => handle.kind)), ['outer', 'outer', 'outer', 'outer']);
});

test('四角いハンドルで外の円を（中の円も同じ比で）、丸いハンドルで中の円だけを、中心を保って変える。1 世代積む', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = place(shell, [200, 600]);
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  dragHandle(shell, 'outer-x2', [8 * scale, 0]);
  assert.equal(current(shell).marking.outer, 116, '右へ 8pt で直径は 16pt 大きくなる');
  // 外の円のハンドルでも、中の円・十字線を同じ比で変える（質問 MK3 案A）。
  assert.deepEqual([current(shell).marking.dot, current(shell).marking.cross], [17.4, 174]);
  assert.deepEqual(plain(center(current(shell).rect)), plain(center(entry.rect)));
  // 中の円のハンドルは、中の円だけを変える（質問 MK3「中の円だけを変える操作は、どの案でも今までどおり使える」）。
  dragHandle(shell, 'inner', [3 * scale, 0]);
  assert.equal(current(shell).marking.dot, 23.4);
  assert.equal(current(shell).marking.outer, 116);
  // 中の円は外の円で止まる。
  dragHandle(shell, 'inner', [100 * scale, 0]);
  assert.equal(current(shell).marking.dot, 116);
  SigK.pageEdit.undo();
  assert.equal(current(shell).marking.dot, 23.4);
});
