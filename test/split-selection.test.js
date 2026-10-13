'use strict';

// 分割の盤の選択（spec-2-2b 確定事項C3・C4・G3）。つながったページだけを選ぶ純粋な層。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/split-plan.js');
require('../renderer/split-board-model.js');
require('../renderer/split-selection.js');

const board = globalThis.SigK.splitBoard;
const selection = globalThis.SigK.splitSelection;

test('クリックはその 1 枚を選び、Shift はクリックした所との間を選ぶ（どちら向きでも）', () => {
  const clicked = selection.click(5);
  assert.deepEqual(selection.range(clicked), { from: 5, to: 5 });
  assert.deepEqual(selection.range(selection.extend(clicked, 9)), { from: 5, to: 9 });
  assert.deepEqual(selection.range(selection.extend(clicked, 2)), { from: 2, to: 5 });
  // Shift を続けて押しても、起点は最初にクリックしたページのまま。
  assert.deepEqual(selection.range(selection.extend(selection.extend(clicked, 9), 3)), { from: 3, to: 5 });
});

test('何も選んでいないときの Shift はクリックと同じ', () => {
  assert.deepEqual(selection.range(selection.extend(selection.none(), 4)), { from: 4, to: 4 });
  assert.equal(selection.range(selection.none()), null);
  assert.equal(selection.isEmpty(selection.none()), true);
});

test('なぞると、押したページからなぞった所までを選ぶ', () => {
  assert.deepEqual(selection.range(selection.dragTo(3, 8)), { from: 3, to: 8 });
  assert.deepEqual(selection.range(selection.dragTo(8, 3)), { from: 3, to: 8 });
});

test('帯の中身: 選んだ数と、全部が書き出さないページか', () => {
  const split = board.setSkipped(board.cut(board.create(12), 8), 10, 11, true);
  assert.deepEqual(selection.bandOf(split, selection.dragTo(8, 10)), { from: 8, to: 10, count: 3, allSkipped: false });
  assert.deepEqual(selection.bandOf(split, selection.dragTo(10, 11)), { from: 10, to: 11, count: 2, allSkipped: true });
  assert.equal(selection.bandOf(split, selection.none()), null);
});

test('盤のページ数を超えた選択は切り詰め、全部外れたら選ばない', () => {
  assert.deepEqual(selection.range(selection.clamp(selection.dragTo(3, 20), 10)), { from: 3, to: 9 });
  assert.equal(selection.isEmpty(selection.clamp(selection.dragTo(12, 20), 10)), true);
});
