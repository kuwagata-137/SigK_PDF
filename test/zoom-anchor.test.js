'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/zoom-anchor.js');

// 倍率を変えてもマウスの下の紙の点を保つ（spec-4b-3b 確定事項C4）。並べ直す前に、点が乗っているページ（乗っていなければ一番近い
// ページ）とその中の割合を控え、並べ直した後の同じページの同じ割合の点を返す。座標は #view-pages の中の CSS px。

const { capture, place } = globalThis.SigK.zoomAnchor;

// 縦に 2 ページ（幅 600・高さ 800、間 16px、上の余白 16px、左の余白 20px）。
const BEFORE = [
  { index: 0, left: 20, top: 16, width: 600, height: 800 },
  { index: 1, left: 20, top: 832, width: 600, height: 800 },
];
// 1.5 倍に並べ直した後（間と余白は倍率に依らない）。
const AFTER = [
  { index: 0, left: 20, top: 16, width: 900, height: 1200 },
  { index: 1, left: 20, top: 1232, width: 900, height: 1200 },
];

test('ページの上の点は、そのページと割合を控える', () => {
  assert.deepEqual(capture(BEFORE, [320, 416]), { index: 0, fx: 0.5, fy: 0.5 });
  assert.deepEqual(capture(BEFORE, [20, 1632]), { index: 1, fx: 0, fy: 1 });
});

test('並べ直した後の同じページの同じ割合の点を返す', () => {
  assert.deepEqual(place(AFTER, { index: 0, fx: 0.5, fy: 0.5 }), [470, 616]);
  assert.deepEqual(place(AFTER, { index: 1, fx: 0.25, fy: 0.75 }), [245, 2132]);
});

test('ページの間や外の点は、一番近いページの割合（0〜1 の外になる）で控える', () => {
  const gap = capture(BEFORE, [320, 824]);
  assert.equal(gap.index, 0);
  assert.equal(gap.fx, 0.5);
  assert.equal(gap.fy, 1.01);
  const left = capture(BEFORE, [0, 900]);
  assert.equal(left.index, 1);
  assert.ok(left.fx < 0);
});

test('控えた点を同じ並びで戻すと元の点になる', () => {
  for (const point of [[320, 416], [100, 1000], [619, 17]]) {
    const back = place(BEFORE, capture(BEFORE, point));
    assert.ok(Math.abs(back[0] - point[0]) < 1e-9 && Math.abs(back[1] - point[1]) < 1e-9, String(point));
  }
});

test('ページが無い・大きさが 0・控えたページが無ければ null', () => {
  assert.equal(capture([], [10, 10]), null);
  assert.equal(capture([{ index: 0, left: 0, top: 0, width: 0, height: 0 }], [10, 10]), null);
  assert.equal(place(AFTER, { index: 5, fx: 0, fy: 0 }), null);
  assert.equal(place(AFTER, null), null);
});
