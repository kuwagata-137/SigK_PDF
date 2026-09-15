'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/markup-quads.js');

// 選択範囲の矩形と QuadPoints の行き来（spec-4-1 確定事項11〜13・事前調査 D）。

const quads = globalThis.SigK.markupQuads;

// pdf.js の PageViewport と同じ変換を持つ偽物。viewBox は [x0 y0 x1 y1]。
function fakeViewport({ scale = 1, rotation = 0, viewBox = [0, 0, 595.28, 841.89] } = {}) {
  const [x0, y0, x1, y1] = viewBox;
  let transform;
  if (rotation === 90)
    transform = [0, scale, scale, 0, -y0 * scale, -x0 * scale];
  else if (rotation === 180)
    transform = [-scale, 0, 0, scale, x1 * scale, -y0 * scale];
  else if (rotation === 270)
    transform = [0, -scale, -scale, 0, y1 * scale, x1 * scale];
  else
    transform = [scale, 0, 0, -scale, -x0 * scale, y1 * scale];
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  return {
    rotation,
    scale,
    convertToViewportPoint: (x, y) => [a * x + c * y + e, b * x + d * y + f],
    convertToPdfPoint: (px, py) => [
      (d * (px - e) - c * (py - f)) / det,
      (-b * (px - e) + a * (py - f)) / det,
    ],
  };
}

const CSS = 96 / 72;

test('normalizeQuad は 4 点を UL・UR・LL・LR に並べ直す', () => {
  const quad = quads.normalizeQuad([[10, 20], [50, 20], [10, 5], [50, 5]]);
  assert.deepEqual(quad, [10, 20, 50, 20, 10, 5, 50, 5]);
  // 回転したページでは CSS の左上が PDF の右上に来る。順序が違っても同じ四角になる。
  assert.deepEqual(quads.normalizeQuad([[50, 5], [10, 5], [50, 20], [10, 20]]), quad);
});

test('cssRectToQuad は倍率を戻して pt にする（回転 0）', () => {
  const viewport = fakeViewport({ scale: 1.5 * CSS });
  const rect = { left: 48 * 2, top: (841.89 - 753) * 2, right: 232 * 2, bottom: (841.89 - 743) * 2 };
  const quad = quads.cssRectToQuad(rect, viewport);
  assert.deepEqual(quad, [48, 753, 232, 753, 48, 743, 232, 743]);
});

test('cssRectToQuad は回転したページでも同じ pt の四角を返す（事前調査 D）', () => {
  const upright = quads.cssRectToQuad({ left: 48, top: 841.89 - 753, right: 232, bottom: 841.89 - 743 }, fakeViewport());
  // 90 度: CSS の x は pt の y から、CSS の y は pt の x から来る。
  const rotated = quads.cssRectToQuad({ left: 743, top: 48, right: 753, bottom: 232 }, fakeViewport({ rotation: 90 }));
  assert.deepEqual(rotated, upright);
  const flipped = quads.cssRectToQuad({ left: 595.28 - 232, top: 743, right: 595.28 - 48, bottom: 753 }, fakeViewport({ rotation: 180 }));
  assert.deepEqual(flipped, upright);
});

test('cssRectToQuad は CropBox のずれを pt に含める', () => {
  const viewport = fakeViewport({ viewBox: [40, 60, 555, 800] });
  const quad = quads.cssRectToQuad({ left: 8, top: 47, right: 192, bottom: 57 }, viewport);
  assert.deepEqual(quad, [48, 753, 232, 753, 48, 743, 232, 743]);
});

test('quadFromItem は横を四角から、縦をフォントから作る（確定事項12）', () => {
  const quad = [48, 756, 232, 756, 48, 743, 232, 743];
  const item = { transform: [9, 0, 0, 9, 48, 745.89], fontName: 'g_d0_f1' };
  const made = quads.quadFromItem(quad, item, { ascent: 0.718, descent: -0.207 });
  assert.deepEqual(made, [48, 752.35, 232, 752.35, 48, 744.03, 232, 744.03]);
});

test('quadFromItem は ascent/descent が無ければ既定を使う', () => {
  const quad = [0, 20, 100, 20, 0, 0, 100, 0];
  const made = quads.quadFromItem(quad, { transform: [10, 0, 0, 10, 0, 10] }, {});
  assert.deepEqual(made, [0, 18, 100, 18, 0, 8, 100, 8]);
  assert.deepEqual(quads.quadFromItem(quad, { transform: [10, 0, 0, 10, 0, 10] }, { ascent: 0, descent: 0 }), made);
});

test('quadFromItem は回った文字・縦書き・transform 無しでは四角をそのまま返す', () => {
  const quad = [0, 20, 100, 20, 0, 0, 100, 0];
  assert.equal(quads.quadFromItem(quad, { transform: [0, 10, -10, 0, 0, 10] }, {}), quad);
  assert.equal(quads.quadFromItem(quad, { transform: [10, 0, 0, 10, 0, 10] }, { vertical: true }), quad);
  assert.equal(quads.quadFromItem(quad, {}, {}), quad);
  assert.equal(quads.quadFromItem(quad, { transform: [0, 0, 0, 0, 0, 0] }, {}), quad);
});

test('unionRect は四角群の外接を左下・右上で返す', () => {
  const rect = quads.unionRect([[48, 753, 232, 753, 48, 743, 232, 743], [48, 740, 300, 740, 48, 730, 300, 730]]);
  assert.deepEqual(rect, [48, 730, 300, 753]);
});

test('hitTest は四角のどれかに入る点を拾う', () => {
  const list = [[48, 753, 232, 753, 48, 743, 232, 743], [48, 740, 300, 740, 48, 730, 300, 730]];
  assert.equal(quads.hitTest(list, [100, 750]), true);
  assert.equal(quads.hitTest(list, [280, 735]), true);
  assert.equal(quads.hitTest(list, [280, 750]), false);
  assert.equal(quads.hitTest(list, [10, 10]), false);
});

test('quadToViewport は pt の四角を CSS px の 4 点にする', () => {
  const points = quads.quadToViewport([48, 753, 232, 753, 48, 743, 232, 743], fakeViewport({ scale: 2 }));
  assert.deepEqual(points.map((p) => p.map((v) => Math.round(v * 100) / 100)), [
    [96, 177.78], [464, 177.78], [96, 197.78], [464, 197.78],
  ]);
});

test('lineEndpoints は下線を下辺の近く、取り消し線を中央に置く', () => {
  const points = [[0, 0], [100, 0], [0, 14], [100, 14]];
  const underline = quads.lineEndpoints(points, 'underline');
  assert.deepEqual(underline.map((p) => p.map((v) => Math.round(v * 100) / 100)), [[0, 13.02], [100, 13.02]]);
  assert.deepEqual(quads.lineEndpoints(points, 'strikeout'), [[0, 7], [100, 7]]);
  assert.equal(quads.lineWidth(points), 1);
  assert.equal(quads.lineWidth([[0, 0], [100, 0], [0, 28], [100, 28]]), 2);
});
