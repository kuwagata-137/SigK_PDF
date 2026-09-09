'use strict';

// 用紙の定義（spec-3-1 確定事項10〜14）。純関数なので jsdom を要さない。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/paper-size.js');

const { PAPERS, MARGINS, mmToPt, isPaper, isMargin, isOrientation, resolveOrientation, paperSize } = globalThis.SigK.paperSize;

test('4つの用紙は pt で定義され、A4 は差し込みの逃げ場と同じ値', () => {
  assert.deepEqual([PAPERS.a4.width, PAPERS.a4.height], [595.28, 841.89]);
  assert.deepEqual([PAPERS.a3.width, PAPERS.a3.height], [841.89, 1190.55]);
  assert.deepEqual([PAPERS.b5.width, PAPERS.b5.height], [515.91, 728.50]);
  assert.deepEqual([PAPERS.letter.width, PAPERS.letter.height], [612, 792]);
  assert.equal(PAPERS.image.width, undefined, '画像サイズは寸法を持たない');
});

test('mm → pt は 72 / 25.4', () => {
  assert.equal(Math.round(mmToPt(10) * 100) / 100, 28.35);
  assert.equal(Math.round(mmToPt(20) * 100) / 100, 56.69);
  assert.equal(mmToPt(0), 0);
  assert.deepEqual(Object.keys(MARGINS), ['none', 'narrow', 'normal']);
  assert.deepEqual([MARGINS.none.mm, MARGINS.narrow.mm, MARGINS.normal.mm], [0, 10, 20]);
});

test('自動は幅が高さより大きければ横、正方形は縦', () => {
  assert.equal(resolveOrientation('auto', { width: 1200, height: 800 }), 'landscape');
  assert.equal(resolveOrientation('auto', { width: 600, height: 900 }), 'portrait');
  assert.equal(resolveOrientation('auto', { width: 500, height: 500 }), 'portrait');
  assert.equal(resolveOrientation('portrait', { width: 1200, height: 800 }), 'portrait', '指定があれば従う');
  assert.equal(resolveOrientation('landscape', { width: 600, height: 900 }), 'landscape');
});

test('横なら幅と高さを入れ替える。画像サイズは null', () => {
  assert.deepEqual(paperSize('a4', 'portrait'), { width: 595.28, height: 841.89 });
  assert.deepEqual(paperSize('a4', 'landscape'), { width: 841.89, height: 595.28 });
  assert.equal(paperSize('image', 'portrait'), null);
  assert.equal(paperSize('a5', 'portrait'), null, '知らない用紙');
});

test('選べる値だけを受ける', () => {
  assert.equal(isPaper('letter'), true);
  assert.equal(isPaper('toString'), false, 'プロトタイプの名前は用紙ではない');
  assert.equal(isMargin('narrow'), true);
  assert.equal(isMargin('wide'), false);
  assert.equal(isOrientation('auto'), true);
  assert.equal(isOrientation(''), false);
});
