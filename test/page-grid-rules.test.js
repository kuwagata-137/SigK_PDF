'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-grid-rules.js');
const rules = globalThis.SigK.pageGridRules;

// ページ編集の格子の選択と並べ替えの当たり判定（spec-1-5 確定事項14〜18・33・36）。
// spec-4b-6a a0 で page-plan.js から分けた。格子の振る舞いそのものは test/page-grid.test.js が見る。

// ---- 選択（確定事項14〜18） ----

test('resolveClick は素のクリックでその 1 枚だけを選び、起点にする', () => {
  assert.deepEqual(rules.resolveClick({ selection: [0, 2], anchor: 0, index: 3 }), { selection: [3], anchor: 3 });
});

test('resolveClick は Ctrl で押した 1 枚の選択を反転し、起点をそこへ移す', () => {
  assert.deepEqual(rules.resolveClick({ selection: [0, 2], anchor: 0, index: 2, ctrl: true }), { selection: [0], anchor: 2 });
  assert.deepEqual(rules.resolveClick({ selection: [0], anchor: 0, index: 4, ctrl: true }), { selection: [0, 4], anchor: 4 });
});

test('resolveClick は Shift で起点からの範囲を選び、起点は動かさない。Ctrl+Shift なら足す', () => {
  assert.deepEqual(rules.resolveClick({ selection: [1], anchor: 1, index: 3, shift: true }), { selection: [1, 2, 3], anchor: 1 });
  assert.deepEqual(rules.resolveClick({ selection: [5], anchor: 1, index: 3, shift: true, ctrl: true }), { selection: [1, 2, 3, 5], anchor: 1 });
});

test('resolveClick は index が整数でなければ何も変えない', () => {
  assert.deepEqual(rules.resolveClick({ selection: [1], anchor: 1, index: null }), { selection: [1], anchor: 1 });
});

test('selectAll は 0 から数えた全部を返し、数が無ければ空', () => {
  assert.deepEqual(rules.selectAll(3), [0, 1, 2]);
  assert.deepEqual(rules.selectAll(0), []);
});

// ---- 挿入位置（確定事項33） ----

const ONE_COLUMN = { pages: [
  { index: 0, left: 0, top: 0, width: 100, height: 100 },
  { index: 1, left: 0, top: 110, width: 100, height: 100 },
] };

test('dropIndex は 1 列なら紙の上下半分で手前か次かを決め、外側は端へ寄せる', () => {
  assert.equal(rules.dropIndex({ layout: ONE_COLUMN, x: 90, y: 40 }), 0);
  assert.equal(rules.dropIndex({ layout: ONE_COLUMN, x: 90, y: 60 }), 1);
  assert.equal(rules.dropIndex({ layout: ONE_COLUMN, x: 0, y: 500 }), 2);
  assert.equal(rules.dropIndex({ layout: ONE_COLUMN, x: 0, y: -10 }), 0);
  assert.equal(rules.dropIndex({ layout: { pages: [] }, x: 0, y: 0 }), 0);
});

test('dropIndex は多列なら紙の左右半分で決める', () => {
  const layout = { pages: [
    { index: 0, left: 0, top: 0, width: 100, height: 100 },
    { index: 1, left: 110, top: 0, width: 100, height: 100 },
  ] };
  assert.equal(rules.dropIndex({ layout, columns: 2, x: 120, y: 50 }), 1);
  assert.equal(rules.dropIndex({ layout, columns: 2, x: 190, y: 50 }), 2);
});

// ---- 端へ寄せたときのスクロール（確定事項36） ----

test('autoScrollStep は上下の端の帯の中だけ動かす', () => {
  assert.equal(rules.autoScrollStep({ y: 5, viewportHeight: 300, edge: 20, step: 12 }), -12);
  assert.equal(rules.autoScrollStep({ y: 295, viewportHeight: 300, edge: 20, step: 12 }), 12);
  assert.equal(rules.autoScrollStep({ y: 150, viewportHeight: 300, edge: 20, step: 12 }), 0);
  assert.equal(rules.autoScrollStep({ y: 5, viewportHeight: 0, edge: 20, step: 12 }), 0);
});
