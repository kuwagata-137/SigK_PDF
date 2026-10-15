'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-grid-rules.js');
require('../renderer/strip-layout.js');
require('../renderer/strip-selection.js');
const L = globalThis.SigK.stripLayout;
const selection = globalThis.SigK.stripSelection;

// 帯の寸法と見えている所（spec-2-5 確定事項D2・D8）、帯のページの選択（D10）。

const A4 = { width: 595, height: 842 };
const WIDE = { width: 1684, height: 595 };

test('紙は高さ 104px にそろえ、横長の紙は幅 180px で止める', () => {
  assert.deepEqual(L.sheetOf(A4), { width: 73, height: 104 }, '104 × 595 / 842 ＝ 73.5');
  assert.deepEqual(L.sheetOf({ width: 842, height: 595 }), { width: 147, height: 104 });
  assert.deepEqual(L.sheetOf(WIDE), { width: 180, height: 64 });
  assert.deepEqual(L.sheetOf(null), { width: 74, height: 104 }, '寸法が無ければ A4 の縦（104 × 0.707）');
});

test('紙の列のセルの位置と幅', () => {
  const line = L.row([A4, A4, WIDE]);
  assert.deepEqual(line.lefts, [2, 2 + 81 + 12, 2 + 2 * (81 + 12)]);
  assert.deepEqual(line.widths, [81, 81, 188]);
  assert.equal(line.total, 2 + 81 + 12 + 81 + 12 + 188 + 2);
  assert.equal(L.row([]).total, 0);
});

test('見えているセルと、左右 4 枚の先読み', () => {
  const line = L.row(Array.from({ length: 100 }, () => A4));
  const step = 81 + 12;
  // 幅 500 は 6 枚目の途中まで（2 + 5 × 93 = 467 から 6 枚目が始まる）。
  assert.deepEqual(L.visibleCells(line, 0, 500), { first: 0, last: 6, from: 0, to: 10 });
  const middle = L.visibleCells(line, 2 + step * 49 + 40, 500);
  assert.equal(middle.first, 49, '左端が隠れている 49 枚目も見えている');
  assert.equal(L.visibleCells(line, 2 + step * 49 + 81, 500).first, 50, '49 枚目の右端ちょうどなら 50 枚目から');
  assert.equal(middle.from, 45);
  assert.equal(middle.to, middle.last + 4);
  assert.deepEqual(L.visibleCells(line, 0, 0), { first: 0, last: 0, from: 0, to: 0 });
  const end = L.visibleCells(line, line.total - 300, 300);
  assert.equal(end.to, 100);
});

test('見えている帯と、上下 1 本の先読み', () => {
  const step = L.STRIP_HEIGHT + L.STRIP_GAP;
  assert.equal(L.STRIP_HEIGHT, 188);
  // 帯の上端は 12・210・408・606。高さ 600 なら 3 本目まで。
  assert.deepEqual(L.visibleStrips(20, 0, 600), { first: 0, last: 3, from: 0, to: 4 });
  const scrolled = L.visibleStrips(20, L.COLUMN_PAD + step * 10, 300);
  assert.equal(scrolled.first, 10);
  assert.equal(scrolled.from, 9);
  assert.equal(L.visibleStrips(20, L.COLUMN_PAD + step * 10 - L.STRIP_GAP - 1, 1).first, 9, '9 本目の下端の 1px');
  assert.deepEqual(L.visibleStrips(0, 0, 600), { first: 0, last: 0, from: 0, to: 0 });
});

test('高さの違う帯（分割の ✂ の盤を広げた帯）があっても、帯ごとの高さで数える（spec-2-5 確定事項G9）', () => {
  const H = L.STRIP_HEIGHT;
  const heights = [H, 1000, H, H];
  // 帯の上端は 12・210・1220・1418。
  assert.deepEqual(L.tops(heights), [12, 12 + H + 10, 12 + H + 10 + 1010, 12 + 2 * (H + 10) + 1010]);
  assert.deepEqual(L.visibleStrips(4, 0, 600, 1, heights), { first: 0, last: 2, from: 0, to: 3 }, '広げた帯の途中までしか見えない');
  assert.deepEqual(L.visibleStrips(4, 1100, 400, 1, heights), { first: 1, last: 4, from: 0, to: 4 }, '広げた帯の下端と、その下の 2 本');
  assert.deepEqual(L.visibleStrips(4, 1300, 100, 1, heights), { first: 2, last: 3, from: 1, to: 4 });
});

test('描く順は見えているものが先で、帯の順・紙の順', () => {
  const order = L.drawOrder([
    { strip: 1, page: 0, near: true }, { strip: 2, page: 3, near: false }, { strip: 0, page: 9, near: false }, { strip: 2, page: 1, near: false },
  ]);
  assert.deepEqual(order.map((item) => `${item.strip}:${item.page}`), ['0:9', '2:1', '2:3', '1:0']);
  assert.equal(L.moved([1, 2, 3], [1, 2, 3]), false);
  assert.equal(L.moved([1, 2, 3], [1, 3, 2]), true);
  assert.equal(L.moved([1, 2], [1, 2, 3]), true);
});

test('帯のページの選択はタブごとで、Shift・Ctrl はページ編集と同じ', () => {
  const plan = [];
  const changes = [];
  selection.onChange((tabId) => changes.push(tabId));
  assert.deepEqual(selection.click(1, 2, { plan }), [2]);
  assert.deepEqual(selection.click(1, 5, { shift: true }), [2, 3, 4, 5]);
  assert.deepEqual(selection.click(1, 3, { ctrl: true }), [2, 4, 5]);
  assert.deepEqual(selection.click(2, 0), [0]);
  assert.deepEqual(selection.get(1), [2, 4, 5], 'ほかのタブの選択は変わらない');
  assert.equal(selection.hasAny(), true);

  assert.equal(selection.onPlanChanged(1, plan), false, '同じ並び');
  assert.equal(selection.onPlanChanged(1, []), true, '並びが変わったら外す');
  assert.deepEqual(selection.get(1), []);

  selection.forget(2);
  assert.deepEqual(selection.get(2), []);
  selection.click(3, 1);
  assert.equal(selection.escape(), true);
  assert.equal(selection.hasAny(), false);
  assert.equal(selection.escape(), false, '選んでいなければ Esc の段にならない');
  assert.ok(changes.length >= 5);
});
