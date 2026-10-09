'use strict';

// 分割の盤の履歴（spec-2-2b 確定事項C8）。盤の写しを積むだけの純粋な層。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/split-plan.js');
require('../renderer/split-board-model.js');
require('../renderer/split-board-history.js');

const board = globalThis.SigK.splitBoard;
const history = globalThis.SigK.splitHistory;

test('積んだ盤を戻し、やり直せる', () => {
  const first = board.create(10);
  const second = board.cut(first, 4);
  const third = board.cut(second, 7);
  let h = history.push(history.push(history.create(first), second), third);
  assert.equal(history.current(h), third);
  assert.equal(history.canUndo(h), true);
  assert.equal(history.canRedo(h), false);

  h = history.undo(h);
  assert.equal(history.current(h), second);
  h = history.undo(h);
  assert.equal(history.current(h), first);
  assert.equal(history.canUndo(h), false);
  assert.equal(history.undo(h), h);

  h = history.redo(h);
  assert.equal(history.current(h), second);
  assert.equal(history.canRedo(h), true);
});

test('戻したあとで新しい操作をすると、先の履歴を捨てる', () => {
  const first = board.create(10);
  const second = board.cut(first, 4);
  const other = board.cut(first, 2);
  let h = history.push(history.create(first), second);
  h = history.push(history.undo(h), other);
  assert.equal(history.current(h), other);
  assert.equal(history.canRedo(h), false);
  assert.equal(history.current(history.undo(h)), first);
});

test('同じ盤は積まない（変わらない操作は履歴を増やさない）', () => {
  const first = board.create(10);
  const h = history.create(first);
  assert.equal(history.push(h, first), h);
  assert.equal(history.push(h, board.create(10)), h);
});

test('100 を超えたら古いものから捨てる', () => {
  let current = board.create(300);
  let h = history.create(current);
  for (let at = 1; at <= 150; at += 1) {
    current = board.cut(current, at);
    h = history.push(h, current);
  }
  let undone = 0;
  while (history.canUndo(h)) {
    h = history.undo(h);
    undone += 1;
  }
  assert.equal(undone, history.MAX_HISTORY - 1);
  assert.equal(history.MAX_HISTORY, 100);
  assert.equal(history.current(h).cuts.length, 51);
});
