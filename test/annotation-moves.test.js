'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 書き込みを紙の座標で動かした形の値（spec-4b-3a 確定事項F・G。annotate-shape・annotate-text・annotate-note の move から移した）。
// テキストの箱の大きさは本文を測って取り直すので、画面の土台（createShell）の上で見る。

async function withMoves(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  return shell.SigK;
}

// jsdom の窓の中で作った配列は Node の配列と別の世界のものなので、値だけを比べる。
const plain = (value) => JSON.parse(JSON.stringify(value));

const SQUARE = { id: 'sigk-1', kind: 'square', rect: [100, 600, 300, 700], lineWidth: 2, quads: [[100, 700, 300, 700, 100, 600, 300, 600]] };

test('isMovable は図形・ペン・テキスト・ノートだけを動かせるとみなす', async (t) => {
  const { annotationMoves } = await withMoves(t);
  for (const kind of ['square', 'circle', 'line', 'arrow', 'ink', 'text', 'note'])
    assert.equal(annotationMoves.isMovable({ kind }), true, kind);
  for (const kind of ['highlight', 'underline', 'strikeout'])
    assert.equal(annotationMoves.isMovable({ kind }), false, kind);
  assert.equal(annotationMoves.isMovable(null), false);
});

test('四角は箱と四角群を delta だけずらし、角度を保つ', async (t) => {
  const { annotationMoves } = await withMoves(t);
  const patch = annotationMoves.movedPatch(SQUARE, [10.004, -20]);
  assert.deepEqual(plain(patch.rect), [110, 580, 310, 680]);
  assert.deepEqual(plain(patch.quads), [[110, 680, 310, 680, 110, 580, 310, 580]]);
  // 回した四角の rect は回す前の箱（spec-4b-2）。箱はずれ、四角群は回した 4 隅のまま。
  const turned = annotationMoves.movedPatch({ ...SQUARE, angle: 30 }, [5, 5]);
  assert.deepEqual(plain(turned.rect), [105, 605, 305, 705]);
  assert.deepEqual(plain(turned.quads), [[143.4, 748.3, 316.6, 648.3, 93.4, 661.7, 266.6, 561.7]]);
});

test('ペンは点列をずらして /Rect を作り直す', async (t) => {
  const { annotationMoves } = await withMoves(t);
  const ink = { id: 'sigk-2', kind: 'ink', lineWidth: 2, rect: [99, 199, 201, 301], paths: [[[100, 200], [200, 300]]], quads: [[99, 301, 201, 301, 99, 199, 201, 199]] };
  const patch = annotationMoves.movedPatch(ink, [1.5, -2.5]);
  assert.deepEqual(plain(patch.paths), [[[101.5, 197.5], [201.5, 297.5]]]);
  assert.equal(patch.rect[0], 100.5);
});

test('ノートは基準の点（左上）に足して 20×20 の箱を作り直す', async (t) => {
  const { annotationMoves } = await withMoves(t);
  const note = { id: 'sigk-3', kind: 'note', rect: [50, 680, 70, 700], quads: [[50, 700, 70, 700, 50, 680, 70, 680]] };
  const patch = annotationMoves.movedPatch(note, [30, -100]);
  assert.deepEqual(plain(patch.rect), [80, 580, 100, 600]);
  assert.deepEqual(plain(patch.quads), [[80, 600, 100, 600, 80, 580, 100, 580]]);
});

test('テキストは表示の左上をずらし、箱の大きさは本文から取り直す', async (t) => {
  const SigK = await withMoves(t);
  const text = { id: 'sigk-4', kind: 'text', text: 'あいう', fontSize: 12, rotation: 0, rect: [100, 600, 400, 700], quads: [] };
  const size = SigK.annotateText.boxOf(text.text, text.fontSize);
  const patch = SigK.annotationMoves.movedPatch(text, [10, -10]);
  assert.deepEqual(plain(patch.rect), [110, 690 - size.height, 110 + size.width, 690].map((value) => Math.round(value * 100) / 100));
  assert.equal(patch.quads.length, 1);
});

test('動かせない種類や、数でない delta なら null', async (t) => {
  const { annotationMoves } = await withMoves(t);
  assert.equal(annotationMoves.movedPatch({ ...SQUARE, kind: 'highlight' }, [1, 1]), null);
  assert.equal(annotationMoves.movedPatch(SQUARE, [1, Number.NaN]), null);
  assert.equal(annotationMoves.movedPatch(SQUARE, [1]), null);
  assert.equal(annotationMoves.movedPatch(SQUARE, null), null);
});
