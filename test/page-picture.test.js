'use strict';

// 前の絵を表示し続けるための構成要素（renderer/page-picture.js。docs/07 決定99 ②）。
// 回転・トリミングで向きと範囲が変わったページでは、前の絵を描いた時の viewport から今の枠の viewport への変換を当てて表示する。
// 変換が正しいかは、本物の pdf.js（legacy の build）の viewport で、紙の上の点が前の絵の上から移した先と、新しい枠の上の位置で
// 一致するかで確かめる。紙は test/fixtures/page-boxes.pdf（1〜4 ページ目が /Rotate 0・90・180・270、5 ページ目が CropBox 付き）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

require('../renderer/page-plan.js');
require('../renderer/page-crop.js');
require('../renderer/page-viewbox.js');
require('../renderer/page-picture.js');

const { pagePicture, pageViewbox } = globalThis.SigK;
const FIXTURE = path.join(__dirname, 'fixtures', 'page-boxes.pdf');
// 倍率 100% の CSS px（viewer-layout.js の CSS_UNITS）。
const SCALE = 96 / 72;

let docPromise = null;
function openFixture() {
  docPromise ??= (async () => {
    const entry = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    const lib = await import(pathToFileURL(entry).href);
    return lib.getDocument({ data: new Uint8Array(fs.readFileSync(FIXTURE)), isEvalSupported: false, verbosity: 0 }).promise;
  })();
  return docPromise;
}

const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// 前の絵を置く要素（from の大きさ）の 4 隅を、変換で移した先の外接矩形。
function placedRect(m, from) {
  const corners = [[0, 0], [from.width, 0], [0, from.height], [from.width, from.height]].map((point) => apply(m, point));
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function assertClose(actual, expected, label, tolerance = 0.01) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}: ${actual} が ${expected} と違う`));
}

// page（pdf.js）の before の向きと範囲で描いた絵を、after の向きと範囲の枠に置く変換を作り、紙の上の点がずれないことを確かめる。
// 返すのは、枠の座標での前の絵の外接矩形。rotation はページ自身の /Rotate を含む絶対角度。
function placeAndCheck(page, before, after, label) {
  const from = pageViewbox.viewportFor(page, { scale: SCALE, rotation: before.rotation, box: before.box ?? null });
  const to = pageViewbox.viewportFor(page, { scale: SCALE, rotation: after.rotation, box: after.box ?? null });
  const m = pagePicture.transformBetween(from, to);
  const [x1, y1, x2, y2] = page.view;
  const points = [[x1 + 100, y1 + 120], [x2 - 100, y2 - 70], [(x1 + x2) / 2, (y1 + y2) / 2], [x1, y2]];
  for (const point of points)
    assertClose(apply(m, apply(from.transform, point)), apply(to.transform, point), `${label} の点 ${point}`);
  return { rect: placedRect(m, from), to, from };
}

test('回転（90・180・270）と回転の取り消しで、前の絵が新しい枠にちょうど重なる', async () => {
  const page = await (await openFixture()).getPage(1);
  for (const [label, before, after] of [
    ['右回転', 0, 90],
    ['2 回の回転', 0, 180],
    ['左回転', 0, 270],
    ['回転の取り消し', 90, 0],
    ['270 から 180', 270, 180],
  ]) {
    const { rect, to } = placeAndCheck(page, { rotation: before }, { rotation: after }, label);
    assertClose(rect, [0, 0, to.width, to.height], `${label} の外接矩形`);
  }
});

test('ページ自身の /Rotate があるページでも、並びの回転を適用した前の絵が新しい枠に重なる', async () => {
  const doc = await openFixture();
  for (const number of [2, 3, 4]) {
    const page = await doc.getPage(number);
    const own = page.rotate;
    const { rect, to } = placeAndCheck(page, { rotation: own }, { rotation: own + 90 }, `/Rotate ${own} のページの右回転`);
    assertClose(rect, [0, 0, to.width, to.height], `/Rotate ${own} の外接矩形`);
  }
});

test('トリミングでは、前の絵の切った範囲が新しい枠にちょうど重なり、外側は枠からはみ出す', async () => {
  const page = await (await openFixture()).getPage(1);
  const [x1, y1, x2, y2] = page.view;
  const crop = [x1 + 60, y1 + 100, x2 - 80, y2 - 40];
  const { rect, to } = placeAndCheck(page, { rotation: 0 }, { rotation: 0, box: crop }, 'トリミング');
  // 切った範囲の左上（紙の左・上）が枠の左上に来る。前の絵は枠を覆う。
  assertClose(rect, [-60 * SCALE, -40 * SCALE, to.width + 80 * SCALE, to.height + 100 * SCALE], 'トリミングの外接矩形');
});

test('トリミングの取り消しでは、前の絵（切った範囲）が新しい枠の切った範囲の位置に置かれる', async () => {
  const page = await (await openFixture()).getPage(1);
  const [x1, y1, x2, y2] = page.view;
  const crop = [x1 + 60, y1 + 100, x2 - 80, y2 - 40];
  const { rect, to } = placeAndCheck(page, { rotation: 0, box: crop }, { rotation: 0 }, 'トリミングの取り消し');
  // 前の絵は切った範囲だけなので、枠の余白（切った範囲の外）は覆わない。決定99 ② では、余白は切る前の絵の控えで覆う。
  const [left, top] = to.convertToViewportPoint(crop[0], crop[3]);
  const [right, bottom] = to.convertToViewportPoint(crop[2], crop[1]);
  assertClose(rect, [left, top, right, bottom], 'トリミングの取り消しの外接矩形');
  assert.ok(rect[0] > 0 && rect[1] > 0 && rect[2] < to.width && rect[3] < to.height, '前の絵が枠いっぱいになっている');
});

test('回転したページのトリミングと、CropBox のあるページのトリミングでも、紙の上の点がずれない', async () => {
  const doc = await openFixture();
  const page = await doc.getPage(1);
  const [x1, y1, x2, y2] = page.view;
  const crop = [x1 + 60, y1 + 100, x2 - 80, y2 - 40];
  placeAndCheck(page, { rotation: 90 }, { rotation: 90, box: crop }, '右回転したページのトリミング');
  placeAndCheck(page, { rotation: 0, box: crop }, { rotation: 270, box: crop }, '切ったページの左回転');
  const boxed = await doc.getPage(5);
  const [bx1, by1, bx2, by2] = boxed.view;
  placeAndCheck(boxed, { rotation: 0 }, { rotation: 180, box: [bx1 + 20, by1 + 30, bx2 - 40, by2 - 50] }, 'CropBox のあるページ');
});

test('絵を置く要素は、前の絵の大きさにして変換を適用し、開き直した時は枠いっぱいに伸ばす', async () => {
  const { document } = new JSDOM('').window;
  const canvas = document.createElement('canvas');
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.setAttribute('class', 'annot-layer');
  layer.setAttribute('width', '600');
  layer.setAttribute('height', '800');
  const box = pagePicture.wrap(document, canvas, layer);

  assert.equal(box.className, 'pdf-held');
  assert.deepEqual([...box.children], [canvas, layer]);
  // 書き込みの層は描いた時の座標のまま、要素いっぱいに伸ばす（倍率を変えた時の 2026-10-23 の直しと同じ）。
  assert.equal(layer.getAttribute('viewBox'), '0 0 600 800');
  assert.equal(layer.getAttribute('width'), '100%');
  assert.equal(layer.getAttribute('preserveAspectRatio'), 'none');

  const page = await (await openFixture()).getPage(1);
  const from = pageViewbox.viewportFor(page, { scale: SCALE, rotation: 0 });
  const to = pageViewbox.viewportFor(page, { scale: SCALE, rotation: 90 });
  pagePicture.fit(box, from, to);
  assert.equal(box.style.width, `${from.width}px`);
  assert.equal(box.style.height, `${from.height}px`);
  assert.equal(box.style.transform, `matrix(${pagePicture.transformBetween(from, to).join(',')})`);

  pagePicture.fit(box);
  assert.equal(box.style.width, '100%');
  assert.equal(box.style.height, '100%');
  assert.equal(box.style.transform, '');
});

test('同じページかは文書とページ番号で、見た目が同じかは回転・トリミング・モザイクで比べる', () => {
  const doc = {};
  assert.equal(pagePicture.sameSource({ doc, number: 2 }, { doc, number: 2 }), true);
  assert.equal(pagePicture.sameSource({ doc, number: 2 }, { doc: {}, number: 2 }), false);
  assert.equal(pagePicture.sameSource({ doc, number: 2 }, null), false);

  // 差し込んだページ（insert）と元のファイルのページ（src）の違いは、見た目の比較では見ない。
  assert.equal(pagePicture.sameLook({ src: 3, rotate: 90 }, { insert: 0, rotate: 90 }), true);
  assert.equal(pagePicture.sameLook({ src: 3, rotate: 90 }, { src: 3, rotate: 0 }), false);
  assert.equal(pagePicture.sameLook({ src: 3, rotate: 0, crop: [0, 0, 10, 10] }, { src: 3, rotate: 0 }), false);
  assert.equal(pagePicture.sameLook({ src: 3, rotate: 0, mosaic: [{ box: [0, 0, 5, 5], block: 4 }] }, { src: 3, rotate: 0, mosaic: [{ box: [0, 0, 5, 5], block: 4 }] }), true);
});

test('控えは見た目が同じ絵を優先して返し、画素数の合計が上限を超えたら古い絵から破棄する', () => {
  const doc = {};
  const keeper = pagePicture.createKeeper({ budget: 100 });
  const record = (number, rotate, pixels) => ({ source: { doc, number }, plan: { src: number - 1, rotate }, pixels });
  const turned = record(1, 90, 30);
  const plain = record(1, 0, 30);
  assert.equal(keeper.add(plain), true);
  assert.equal(keeper.add(turned), true);
  assert.equal(keeper.find({ doc, number: 1 }, { src: 0, rotate: 0 }), plain);
  // 見た目が同じ絵が無ければ、最後に追加した絵を返す。
  assert.equal(keeper.find({ doc, number: 1 }, { src: 0, rotate: 180 }), turned);
  assert.equal(keeper.find({ doc, number: 2 }, { src: 1, rotate: 0 }), null);

  // 1 枚で上限を超える絵は、縮められなければ（canvas が無い）持たない。
  assert.equal(keeper.add(record(3, 0, 101)), false);
  // 合計 130 になるので、いちばん古い plain を破棄する。
  keeper.add(record(2, 0, 70));
  assert.equal(keeper.size(), 2);
  assert.equal(keeper.pixels(), 100);
  assert.equal(keeper.find({ doc, number: 1 }, { src: 0, rotate: 0 }), turned);

  keeper.remove(turned);
  assert.equal(keeper.pixels(), 70);
  keeper.clear();
  assert.equal(keeper.size(), 0);
  assert.equal(keeper.pixels(), 0);
});

test('控えの上限を 1 枚で超える絵は、画素数を上限の半分に縮めた絵にして、絵を置く要素の中の絵も入れ替える', () => {
  const { window } = new JSDOM('');
  const draws = [];
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  const canvas = window.document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const box = pagePicture.wrap(window.document, canvas);
  const keeper = pagePicture.createKeeper({ budget: 30000 });
  const doc = {};

  assert.equal(keeper.add({ box, canvas, source: { doc, number: 1 }, plan: { src: 0, rotate: 0 }, pixels: pagePicture.pixelsOf(canvas) }), true);

  const kept = keeper.find({ doc, number: 1 }, { src: 0, rotate: 0 });
  assert.notEqual(kept.canvas, canvas);
  assert.ok(kept.pixels <= 15000, `縮めた絵の画素数 ${kept.pixels}`);
  assert.equal(Math.round((kept.canvas.width / kept.canvas.height) * 100), Math.round((400 / 300) * 100), '縦横の比が変わった');
  assert.deepEqual(draws, [[canvas, 0, 0, kept.canvas.width, kept.canvas.height]]);
  assert.equal(kept.box, box);
  assert.deepEqual([...box.children], [kept.canvas]);
  assert.equal(keeper.pixels(), kept.pixels);
});
