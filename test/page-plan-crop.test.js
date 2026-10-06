'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
const plan = globalThis.SigK.pagePlan;

// plan の要素の切った範囲 crop（spec-4b-6a 確定事項1〜3）。並べ替え・回転・削除・写しで付いて回り、未保存の判定に入る。
// （差し込んだページの回転は PR #39 のテストが見る。）

const CROP = [10, 20, 300, 400];

function cropped() {
  return plan.cropPages(plan.createPlan(3), new Map([[1, (entry) => ({ ...entry, crop: [...CROP] })]]));
}

test('cropPages は表にある要素だけを作り替え、ほかはそのまま写す', () => {
  assert.deepEqual(cropped(), [{ src: 0, rotate: 0 }, { src: 1, rotate: 0, crop: CROP }, { src: 2, rotate: 0 }]);
});

test('clonePlan は crop を新しい配列で写す', () => {
  const before = cropped();
  const copy = plan.clonePlan(before);
  assert.deepEqual(copy, before);
  copy[1].crop[0] = 999;
  assert.equal(before[1].crop[0], 10);
});

test('rotatePages は回したページの crop を落とさない', () => {
  const after = plan.rotatePages(cropped(), [1], 90);
  assert.deepEqual(after[1], { src: 1, rotate: 90, crop: CROP });
});

test('movePages・deletePages も crop を運ぶ', () => {
  const moved = plan.movePages(cropped(), [1], 0).plan;
  assert.deepEqual(moved[0], { src: 1, rotate: 0, crop: CROP });
  const deleted = plan.deletePages(cropped(), [0]).plan;
  assert.deepEqual(deleted[0], { src: 1, rotate: 0, crop: CROP });
});

test('samePlan は crop も比べる', () => {
  assert.equal(plan.samePlan(cropped(), cropped()), true);
  assert.equal(plan.samePlan(cropped(), plan.createPlan(3)), false);
  const other = plan.cropPages(plan.createPlan(3), new Map([[1, (entry) => ({ ...entry, crop: [10, 20, 300, 401] })]]));
  assert.equal(plan.samePlan(cropped(), other), false);
});

test('isDirty は crop があれば変更あり、欄を消せば変更なし', () => {
  assert.equal(plan.isDirty(cropped(), 3), true);
  const removed = plan.cropPages(cropped(), new Map([[1, (entry) => { const next = { ...entry }; delete next.crop; return next; }]]));
  assert.equal(plan.isDirty(removed, 3), false);
});
