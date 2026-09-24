'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isOpacity, textMarkOf, imageMarkOf } = require('../worker/watermark-appearance.js');

const OUTLINE = { ops: ['-100 -43.6 m', '0 -43.6 l', '0 56.4 l', 'h'], width: 200, height: 144.8, inkBox: [-100, -43.6, 0, 56.4] };

test('isOpacity は 0 より大きく 1 以下の有限数だけを受ける', () => {
  for (const value of [0.15, 0.3, 0.5, 1])
    assert.equal(isOpacity(value), true, String(value));
  for (const value of [0, -0.1, 1.01, Number.NaN, Infinity, '0.3', null, undefined])
    assert.equal(isOpacity(value), false, String(value));
});

test('textMarkOf は /GS gs → 塗りの色 → 輪郭 → f の中身を組み、素の箱を返す', () => {
  const mark = textMarkOf(OUTLINE, { color: '#808080', opacity: 0.3 });
  assert.equal(mark.content, ['/GS gs', '0.5 0.5 0.5 rg', '-100 -43.6 m', '0 -43.6 l', '0 56.4 l', 'h', 'f'].join('\n'));
  assert.equal(mark.width, 200);
  assert.equal(mark.height, 144.8);
  assert.equal(mark.opacity, 0.3);
  assert.deepEqual(mark.bbox, [-100, -72.4, 100, 72.4]);
});

test('textMarkOf の /BBox は、字形が素の箱からはみ出したらその分だけ外へ広げる（小数 2 桁で外へ丸める）', () => {
  const mark = textMarkOf({ ...OUTLINE, inkBox: [-103.214, -80.001, 99, 72.4] }, { color: '#d92c2c', opacity: 1 });
  assert.deepEqual(mark.bbox, [-103.22, -80.01, 100, 72.4]);
});

test('textMarkOf は色・不透明度・輪郭が読めなければ null', () => {
  assert.equal(textMarkOf(OUTLINE, { color: 'gray', opacity: 0.3 }), null);
  assert.equal(textMarkOf(OUTLINE, { color: '#808080', opacity: 0 }), null);
  assert.equal(textMarkOf({ ...OUTLINE, ops: [] }, { color: '#808080', opacity: 0.3 }), null);
  assert.equal(textMarkOf({ ...OUTLINE, width: 0 }, { color: '#808080', opacity: 0.3 }), null);
});

test('imageMarkOf は幅 100 の箱に縦横比で画像を置く中身を組む', () => {
  const mark = imageMarkOf({ width: 400, height: 200, opacity: 0.5 });
  assert.equal(mark.content, ['/GS gs', 'q 100 0 0 50 -50 -25 cm', '/Im Do', 'Q'].join('\n'));
  assert.deepEqual(mark.bbox, [-50, -25, 50, 25]);
  assert.equal(mark.width, 100);
  assert.equal(mark.height, 50);
  assert.equal(mark.opacity, 0.5);
});

test('imageMarkOf は縦長の画像でも幅 100 を基準にし、高さは小数 2 桁に丸めて箱と中身を揃える（置き方は小数 4 桁）', () => {
  const mark = imageMarkOf({ width: 300, height: 1000, opacity: 0.15 });
  assert.equal(mark.height, 333.33);
  assert.equal(mark.content, ['/GS gs', 'q 100 0 0 333.33 -50 -166.665 cm', '/Im Do', 'Q'].join('\n'));
  assert.deepEqual(mark.bbox, [-50, -166.665, 50, 166.665]);
});

test('imageMarkOf は画素数か不透明度が読めなければ null', () => {
  assert.equal(imageMarkOf({ width: 0, height: 10, opacity: 0.5 }), null);
  assert.equal(imageMarkOf({ width: 10, height: Number.NaN, opacity: 0.5 }), null);
  assert.equal(imageMarkOf({ width: 10, height: 10, opacity: 2 }), null);
});
