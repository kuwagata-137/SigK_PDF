'use strict';

// ツールモードの帯のページ段の上のホイールを左右に送る（spec-7-4 確定事項ST1。質問 ST1 の答え「案A ページ段横移動」）。
// jsdom は寸法を測らないので、段の幅（scrollWidth・clientWidth）は試験の中で決める。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function withStrip(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  await shell.flush();
  return shell;
}

// 段の幅を決める（scrollWidth＝中身の幅、clientWidth＝見えている幅）。
function size(row, { scrollWidth, clientWidth }) {
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: clientWidth });
  row.scrollLeft = 0;
  return row;
}

function wheel(shell, target, init) {
  const event = new shell.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

const rowOf = (shell) => shell.document.querySelector('#strips .strip-pages');
const headOf = (shell) => shell.document.querySelector('#strips .strip-head');

test('ページ段の上で素のホイールを回すと、段が左右に動き、帯の並びは上下に動かない', async (t) => {
  const shell = await withStrip(t);
  const row = size(rowOf(shell), { scrollWidth: 1000, clientWidth: 400 });
  const down = wheel(shell, row, { deltaY: 120 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(row.scrollLeft, 120);
  const up = wheel(shell, row, { deltaY: -50 });
  assert.equal(up.defaultPrevented, true);
  assert.equal(row.scrollLeft, 70);
});

test('行で数える量（deltaMode 1）は 1 行 40px にそろえる', async (t) => {
  const shell = await withStrip(t);
  const row = size(rowOf(shell), { scrollWidth: 1000, clientWidth: 400 });
  wheel(shell, row, { deltaY: 3, deltaMode: 1 });
  assert.equal(row.scrollLeft, 3 * shell.SigK.stripWheel.LINE_PX);
});

test('見出しの行の上では、今までどおり上下に動く（止めない）', async (t) => {
  const shell = await withStrip(t);
  size(rowOf(shell), { scrollWidth: 1000, clientWidth: 400 });
  const event = wheel(shell, headOf(shell), { deltaY: 120 });
  assert.equal(event.defaultPrevented, false);
});

test('ページが段に全部収まっている（左右に動く余地が無い）ときは、上下に動く', async (t) => {
  const shell = await withStrip(t);
  const row = size(rowOf(shell), { scrollWidth: 400, clientWidth: 400 });
  const event = wheel(shell, row, { deltaY: 120 });
  assert.equal(event.defaultPrevented, false);
  assert.equal(row.scrollLeft, 0);
});

test('左右の端まで送ったあとは、上下には移らない', async (t) => {
  const shell = await withStrip(t);
  const row = size(rowOf(shell), { scrollWidth: 1000, clientWidth: 400 });
  wheel(shell, row, { deltaY: 5000 });
  assert.equal(row.scrollLeft, 600, '右端で止まる');
  const more = wheel(shell, row, { deltaY: 120 });
  assert.equal(more.defaultPrevented, true);
  assert.equal(row.scrollLeft, 600);
  wheel(shell, row, { deltaY: -5000 });
  assert.equal(row.scrollLeft, 0, '左端で止まる');
});

test('Ctrl＋ホイールは紙の倍率のまま、Shift＋ホイールと横の動きは触らない', async (t) => {
  const shell = await withStrip(t);
  const { SigK } = shell;
  const row = size(rowOf(shell), { scrollWidth: 1000, clientWidth: 400 });
  wheel(shell, row, { deltaY: -120, ctrlKey: true });
  assert.equal(row.scrollLeft, 0, 'Ctrl のときは左右に送らない');
  assert.ok(SigK.toolsZoom.get() > 1, '紙の倍率が上がる');
  const shift = wheel(shell, row, { deltaY: 120, shiftKey: true });
  assert.equal(shift.defaultPrevented, false);
  const sideways = wheel(shell, row, { deltaX: 80, deltaY: 10 });
  assert.equal(sideways.defaultPrevented, false);
  assert.equal(row.scrollLeft, 0);
});

test('「変換する画像」の帯の画像の段でも、同じく左右に動く', async (t) => {
  const shell = await withStrip(t);
  const items = size(shell.document.getElementById('image-strip-items'), { scrollWidth: 900, clientWidth: 300 });
  const event = wheel(shell, items, { deltaY: 100 });
  assert.equal(event.defaultPrevented, true);
  assert.equal(items.scrollLeft, 100);
});
