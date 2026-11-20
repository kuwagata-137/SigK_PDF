'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-mosaic.js');
require('../renderer/mosaic-paint.js');
const paint = globalThis.SigK.mosaicPaint;

// モザイクの塗り（spec-4b-6b 確定事項5〜7。事前調査 L）。画素を配列で持つ偽の 2D コンテキストで確かめる。

// width×height の画素（RGBA）。fill(x, y) が [r, g, b] を返す。
function fakeContext(width, height, fill = () => [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return {
    canvas: { width, height },
    data,
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1)
        out.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
      return { data: out, width: w, height: h };
    },
    putImageData(image, x, y) {
      for (let row = 0; row < image.height; row += 1)
        data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width + x) * 4);
    },
    at(x, y) {
      return [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
    },
  };
}

// 紙の高さ paperHeight の、回転 0・倍率 scale の viewport（pdf.js と同じく y を下向きにする）。
function viewport(paperHeight, scale = 1) {
  return { scale, convertToViewportPoint: (x, y) => [x * scale, (paperHeight - y) * scale] };
}

test('ブロックごとに平均色で塗る（左が黒・右が白の 8px のブロックは灰色になる）', () => {
  const ctx = fakeContext(16, 8, (x) => (x % 8 < 4 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(paint.paint(ctx, viewport(8), [{ box: [0, 0, 16, 8], block: 8 }]), true);
  assert.deepEqual(ctx.at(0, 0), [128, 128, 128]);
  assert.deepEqual(ctx.at(15, 7), [128, 128, 128]);
});

test('範囲の外は塗らず、紙の座標の区切り（範囲の左上から block ごと）で塗る', () => {
  // 紙の高さ 10・倍率 2。範囲 [2, 2, 8, 10] は画素の x 4〜16・y 0〜16。block 4pt＝8px で、右の端は 4px の半端。
  const ctx = fakeContext(20, 20, (x, y) => [x * 10, y * 10, 0]);
  paint.paint(ctx, viewport(10, 2), [{ box: [2, 2, 8, 10], block: 4 }]);
  assert.deepEqual(ctx.at(3, 3), [30, 30, 0]);
  assert.deepEqual(ctx.at(17, 3), [170, 30, 0]);
  // 最初のブロック（x 4〜11・y 0〜7）の平均は x 7.5・y 3.5。
  assert.deepEqual(ctx.at(4, 0), [75, 35, 0]);
  assert.deepEqual(ctx.at(11, 7), [75, 35, 0]);
  // 右の半端（x 12〜15）の平均は x 13.5。
  assert.deepEqual(ctx.at(12, 0), [135, 35, 0]);
  assert.deepEqual(ctx.at(4, 16), [40, 160, 0]);
});

test('base を渡すと平均を base から取り、ctx と base で色の違う画素（書き込み）は残す', () => {
  const base = fakeContext(8, 8, () => [100, 100, 100]);
  const ctx = fakeContext(8, 8, (x, y) => (x === 3 && y === 3 ? [255, 0, 0] : [100, 100, 100]));
  paint.paint(ctx, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }], { base });
  assert.deepEqual(ctx.at(3, 3), [255, 0, 0]);
  assert.deepEqual(ctx.at(0, 0), [100, 100, 100]);
  // base が無ければ、書き込みの色も混ぜて塗る（保存の画像は初めから書き込みを描かない）。
  const plain = fakeContext(8, 8, (x, y) => (x === 3 && y === 3 ? [255, 0, 0] : [100, 100, 100]));
  paint.paint(plain, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }]);
  assert.deepEqual(plain.at(3, 3), plain.at(0, 0));
  assert.notDeepEqual(plain.at(3, 3), [255, 0, 0]);
});

test('canvas の外へはみ出した範囲は内側だけ塗り、モザイクが無い・2D コンテキストが無いときは何もしない', () => {
  const ctx = fakeContext(4, 4, () => [0, 0, 0]);
  assert.equal(paint.paint(ctx, viewport(4), [{ box: [-10, -10, 20, 20], block: 8 }]), true);
  assert.deepEqual(ctx.at(3, 3), [0, 0, 0]);
  assert.equal(paint.paint(ctx, viewport(4), []), false);
  assert.equal(paint.paint(ctx, viewport(4), undefined), false);
  assert.equal(paint.paint({}, viewport(4), [{ box: [0, 0, 4, 4], block: 8 }]), false);
});

test('needsPaint は並びが 1 つ以上あるときだけ true', () => {
  assert.equal(paint.needsPaint([{ box: [0, 0, 1, 1], block: 4 }]), true);
  assert.equal(paint.needsPaint([]), false);
  assert.equal(paint.needsPaint(null), false);
});

test('paintOver は 2D コンテキストの無い canvas（jsdom）では何もしない', async () => {
  const canvas = { width: 10, height: 10, getContext: () => null };
  const page = { render: () => { throw new Error('描かない'); } };
  assert.equal(await paint.paintOver({}, canvas, page, viewport(10), [{ box: [0, 0, 5, 5], block: 4 }]), false);
  assert.equal(await paint.paintOver({}, canvas, page, viewport(10), null), false);
});

// コードの点検で足したもの。
test('重ねて置いた範囲は、下見（base あり・書き込み無し）と保存（base なし）で同じ画素になる。書き込みの画素は下見で残る', () => {
  const fill = (x, y) => [(x * 37 + y * 11) % 256, (x * 5 + y * 53) % 256, (x * y) % 256];
  const mosaic = [{ box: [0, 0, 16, 16], block: 2 }, { box: [2, 2, 14, 14], block: 7 }];
  const saved = fakeContext(16, 16, fill);
  paint.paint(saved, viewport(16), mosaic);
  const base = fakeContext(16, 16, fill);
  const preview = fakeContext(16, 16, fill);
  paint.paint(preview, viewport(16), mosaic, { base });
  assert.deepEqual([...preview.data], [...saved.data]);
  // 書き込み（base と違う色の画素）は、重なった所でも残る。
  const annotated = fakeContext(16, 16, (x, y) => (x === 8 && y === 8 ? [255, 0, 0] : fill(x, y)));
  paint.paint(annotated, viewport(16), mosaic, { base: fakeContext(16, 16, fill) });
  assert.deepEqual(annotated.at(8, 8), [255, 0, 0]);
  assert.deepEqual(annotated.at(3, 3), saved.at(3, 3));
});

function fakeDoc(width, height, fill) {
  const made = [];
  return {
    made,
    createElement: () => {
      const ctx = fakeContext(width, height, fill);
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      made.push(canvas);
      return canvas;
    },
  };
}

test('paintOver は書き込みを描かない絵をもう 1 枚描いて（task を track に渡す）塗り、描き終えたら手放す', async () => {
  const doc = fakeDoc(8, 8, () => [100, 100, 100]);
  const ctx = fakeContext(8, 8, (x, y) => (x === 1 && y === 1 ? [0, 0, 255] : [100, 100, 100]));
  const canvas = { width: 8, height: 8, getContext: () => ctx };
  const tracked = [];
  const page = { render: (options) => ({ promise: Promise.resolve(), options }) };
  assert.equal(await paint.paintOver(doc, canvas, page, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }], { track: (task) => tracked.push(task) }), true);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].options.viewport.scale, 1);
  assert.deepEqual(ctx.at(1, 1), [0, 0, 255], '書き込みは残る');
  assert.deepEqual(ctx.at(5, 5), [100, 100, 100]);
  assert.equal(doc.made[0].width, 0, '2 枚目は手放す');
});

test('2 枚目の描画が取り消されたら、2 枚目を手放して例外をそのまま返す', async () => {
  const doc = fakeDoc(8, 8, () => [0, 0, 0]);
  const canvas = { width: 8, height: 8, getContext: () => fakeContext(8, 8) };
  const page = { render: () => ({ promise: Promise.reject(new Error('RenderingCancelledException')) }) };
  await assert.rejects(paint.paintOver(doc, canvas, page, viewport(8), [{ box: [0, 0, 8, 8], block: 8 }]), /RenderingCancelled/);
  assert.equal(doc.made[0].width, 0);
  assert.equal(doc.made[0].height, 0);
});
