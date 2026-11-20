'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-plan.js');
require('../renderer/page-mosaic.js');
const mosaic = globalThis.SigK.pageMosaic;

// モザイクの純関数（spec-4b-6b 確定事項1・3・4・5・18）。箱は [x1, y1, x2, y2]（紙の座標・回す前・pt）。

const VIEW = [0, 0, 595, 842];

test('粗さは 細かい 4pt・ふつう 8pt・粗い 14pt で、既定はふつう', () => {
  assert.deepEqual(mosaic.BLOCKS, { fine: 4, normal: 8, coarse: 14 });
  assert.equal(mosaic.DEFAULT_BLOCK, 8);
  assert.equal(mosaic.isBlock(14), true);
  assert.equal(mosaic.isBlock(10), false);
});

test('withMosaic は置いた順に足した写しを返し、元の要素は変えない', () => {
  const entry = { src: 0, rotate: 0 };
  const once = mosaic.withMosaic(entry, [10, 20, 110, 70], 8, VIEW);
  assert.deepEqual(once, { src: 0, rotate: 0, mosaic: [{ box: [10, 20, 110, 70], block: 8 }] });
  const twice = mosaic.withMosaic(once, [300.004, 400, 200, 300], 14, VIEW);
  assert.deepEqual(twice.mosaic, [{ box: [10, 20, 110, 70], block: 8 }, { box: [200, 300, 300, 400], block: 14 }]);
  assert.equal(entry.mosaic, undefined);
  assert.equal(once.mosaic.length, 1);
  twice.mosaic[0].box[0] = 999;
  assert.equal(once.mosaic[0].box[0], 10);
});

test('withMosaic は見える範囲に収め、収まらない・差し込んだページ・粗さが違うときは null', () => {
  const crop = [100, 100, 400, 500];
  assert.deepEqual(mosaic.withMosaic({ src: 1, rotate: 0, crop }, [50, 450, 200, 600], 4, crop).mosaic, [{ box: [100, 450, 200, 500], block: 4 }]);
  assert.equal(mosaic.withMosaic({ src: 1, rotate: 0 }, [600, 0, 700, 10], 8, VIEW), null);
  assert.equal(mosaic.withMosaic({ insert: 0, rotate: 0 }, [10, 10, 50, 50], 8, VIEW), null);
  assert.equal(mosaic.withMosaic({ src: 0, rotate: 0 }, [10, 10, 50, 50], 10, VIEW), null);
});

test('withoutMosaic は欄を消し、countOf は数を返す', () => {
  const entry = { src: 0, rotate: 90, mosaic: [{ box: [1, 2, 3, 4], block: 8 }] };
  assert.equal(mosaic.countOf(entry), 1);
  assert.deepEqual(mosaic.withoutMosaic(entry), { src: 0, rotate: 90 });
  assert.equal(mosaic.countOf(mosaic.withoutMosaic(entry)), 0);
  assert.equal(mosaic.countOf(undefined), 0);
});

test('gridOf は範囲の左上から block ごとに区切り、右と下の端は半端', () => {
  assert.deepEqual(mosaic.gridOf([10, 20, 30, 35], 8), { xs: [10, 18, 26, 30], ys: [35, 27, 20] });
  // ちょうど割り切れるときに幅 0 の半端を作らない。
  assert.deepEqual(mosaic.gridOf([0, 0, 16, 8], 8), { xs: [0, 8, 16], ys: [8, 0] });
  // 浮動小数でも足し算の誤差をためない。
  const grid = mosaic.gridOf([0.1, 0.2, 12.1, 12.2], 4);
  const near = (actual, expected) => actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < 1e-9);
  assert.ok(near(grid.xs, [0.1, 4.1, 8.1, 12.1]), String(grid.xs));
  assert.ok(near(grid.ys, [12.2, 8.2, 4.2, 0.2]), String(grid.ys));
  assert.equal(mosaic.gridOf([0, 0, 0, 10], 8), null);
  assert.equal(mosaic.gridOf([0, 0, 10, 10], 0), null);
});

test('indicesOf はモザイクのあるページの位置、pagesLabel は 4 ページまで名指しする', () => {
  const plan = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0, mosaic: [{ box: [1, 2, 3, 4], block: 8 }] }, { insert: 0, rotate: 0 }, { src: 2, rotate: 0, mosaic: [{ box: [1, 2, 3, 4], block: 4 }] }];
  assert.deepEqual(mosaic.indicesOf(plan), [1, 3]);
  assert.equal(mosaic.pagesLabel([1, 3]), '2・4 ページ目');
  assert.equal(mosaic.pagesLabel([0, 1, 2, 3, 4]), '1・2・3・4 ページ目ほか');
  assert.deepEqual(mosaic.indicesOf(undefined), []);
});

// 2026-11-17 の不具合（モザイクを配置するたびに画面がホワイトアウトする）の修正で、viewer.applyPlan がページ枠を作り直すかを決めるのに使う。
test('changedPages は、違いがモザイク欄だけなら、モザイクが違うページ位置を返し、ほかの欄も違えば null を返す', () => {
  const item = (block) => ({ box: [1, 2, 3, 4], block });
  const base = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0, mosaic: [item(8)] }, { src: 2, rotate: 0, crop: [0, 0, 100, 100] }];
  const placed = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0, mosaic: [item(8), item(4)] }, { src: 2, rotate: 0, crop: [0, 0, 100, 100], mosaic: [item(14)] }];
  assert.deepEqual(mosaic.changedPages(base, placed), [1, 2]);
  assert.deepEqual(mosaic.changedPages(placed, base), [1, 2]);
  assert.deepEqual(mosaic.changedPages(base, base.map((entry) => ({ ...entry }))), []);
  // 回転・トリミング範囲・並び順・ページ数・差し込んだページが違えば、ページ枠から作り直す。
  assert.equal(mosaic.changedPages(base, [{ src: 0, rotate: 90 }, base[1], base[2]]), null);
  assert.equal(mosaic.changedPages(base, [base[0], base[1], { src: 2, rotate: 0, crop: [0, 0, 50, 50] }]), null);
  assert.equal(mosaic.changedPages(base, [base[1], base[0], base[2]]), null);
  assert.equal(mosaic.changedPages(base, base.slice(0, 2)), null);
  assert.equal(mosaic.changedPages(base, [{ insert: 0, rotate: 0 }, base[1], base[2]]), null);
  assert.equal(mosaic.changedPages(null, base), null);
});

// 決定99 ①: viewer.applyPlan が、ページを描き直さずに増えた範囲だけを塗るか（mosaic-paint.js の paintAppended）を決めるのに使う。
test('appendedItem は、違いが「モザイクの並びの末尾に 1 つ増えただけ」なら増えた範囲を返し、ほかの違いがあれば null を返す', () => {
  const first = { box: [10, 20, 110, 70], block: 8 };
  const second = { box: [200, 300, 300, 400], block: 14 };
  const page = { src: 1, rotate: 90, crop: [0, 0, 400, 500] };
  const once = { ...page, mosaic: [first] };
  const twice = { ...page, mosaic: [{ box: [...first.box], block: 8 }, second] };
  assert.equal(mosaic.appendedItem(page, once), first);
  assert.equal(mosaic.appendedItem(once, twice), second);
  // 欄が空の配列でも、欄が無いのと同じに数える。
  assert.equal(mosaic.appendedItem({ ...page, mosaic: [] }, once), first);
  // 減った・途中が違う・2 つ以上増えた・増えていない。
  assert.equal(mosaic.appendedItem(twice, once), null);
  assert.equal(mosaic.appendedItem({ ...page, mosaic: [{ ...first, block: 4 }] }, twice), null);
  assert.equal(mosaic.appendedItem(page, twice), null);
  assert.equal(mosaic.appendedItem(once, { ...once }), null);
  // 元ページ・回転・トリミング範囲も違う。
  assert.equal(mosaic.appendedItem(once, { ...twice, rotate: 0 }), null);
  assert.equal(mosaic.appendedItem(once, { ...twice, crop: [0, 0, 400, 400] }), null);
  assert.equal(mosaic.appendedItem(once, { ...twice, src: 2 }), null);
  assert.equal(mosaic.appendedItem(undefined, once), null);
  assert.equal(mosaic.appendedItem(page, undefined), null);
});
