'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
const plan = globalThis.SigK.pagePlan;

// plan の要素のモザイク mosaic（spec-4b-6b 確定事項1・2）。並べ替え・回転・削除・写しで付いて回り、未保存の判定に入る。

const MOSAIC = [{ box: [10, 20, 300, 400], block: 8 }, { box: [50, 60, 70, 80], block: 4 }];

function withMosaic(items = MOSAIC) {
  return plan.editPages(plan.createPlan(3), new Map([[1, (entry) => ({ ...entry, mosaic: items.map((item) => ({ box: [...item.box], block: item.block })) })]]));
}

test('editPages は表にある要素だけを作り替え、ほかはそのまま写す', () => {
  assert.deepEqual(withMosaic(), [{ src: 0, rotate: 0 }, { src: 1, rotate: 0, mosaic: MOSAIC }, { src: 2, rotate: 0 }]);
});

test('clonePlan は mosaic の配列も箱も新しく作る', () => {
  const before = withMosaic();
  const copy = plan.clonePlan(before);
  assert.deepEqual(copy, before);
  copy[1].mosaic[0].box[0] = 999;
  copy[1].mosaic.push({ box: [1, 2, 3, 4], block: 14 });
  assert.equal(before[1].mosaic[0].box[0], 10);
  assert.equal(before[1].mosaic.length, 2);
});

test('rotatePages・movePages・deletePages は mosaic を運ぶ', () => {
  assert.deepEqual(plan.rotatePages(withMosaic(), [1], 90)[1], { src: 1, rotate: 90, mosaic: MOSAIC });
  assert.deepEqual(plan.movePages(withMosaic(), [1], 0).plan[0], { src: 1, rotate: 0, mosaic: MOSAIC });
  assert.deepEqual(plan.deletePages(withMosaic(), [0]).plan[0], { src: 1, rotate: 0, mosaic: MOSAIC });
});

test('crop と mosaic を両方持つ要素も両方運ぶ', () => {
  const both = plan.editPages(withMosaic(), new Map([[1, (entry) => ({ ...entry, crop: [0, 0, 500, 600] })]]));
  assert.deepEqual(plan.clonePlan(both)[1], { src: 1, rotate: 0, crop: [0, 0, 500, 600], mosaic: MOSAIC });
});

test('samePlan は mosaic の箱・粗さ・並び順まで比べる', () => {
  assert.equal(plan.samePlan(withMosaic(), withMosaic()), true);
  assert.equal(plan.samePlan(withMosaic(), plan.createPlan(3)), false);
  assert.equal(plan.samePlan(withMosaic(), withMosaic([{ box: [10, 20, 300, 401], block: 8 }, MOSAIC[1]])), false);
  assert.equal(plan.samePlan(withMosaic(), withMosaic([{ ...MOSAIC[0], block: 14 }, MOSAIC[1]])), false);
  assert.equal(plan.samePlan(withMosaic(), withMosaic([MOSAIC[1], MOSAIC[0]])), false);
  assert.equal(plan.samePlan(withMosaic(), withMosaic([MOSAIC[0]])), false);
});

test('isDirty は mosaic があれば変更あり、欄を消せば変更なし', () => {
  assert.equal(plan.isDirty(withMosaic(), 3), true);
  const removed = plan.editPages(withMosaic(), new Map([[1, (entry) => { const next = { ...entry }; delete next.mosaic; return next; }]]));
  assert.equal(plan.isDirty(removed, 3), false);
});

test('cropPages は editPages と同じもの（トリミングの呼び名）', () => {
  assert.equal(plan.cropPages, plan.editPages);
});
