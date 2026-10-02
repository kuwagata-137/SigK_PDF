'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/free-text-wrap.js');
require('../renderer/free-text-layout.js');

// テキストの箱の組み立て（spec-4b-4a 確定事項B。annotate-text.js から移した箱の大きさ・四隅・紙の中への寄せ方）。

const layout = globalThis.SigK.freeTextLayout;

// 全角 1em・半角 0.5em で測る見積もり。
const widthOf = (size) => (line) => [...line].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0) * size;

test('boxOf は最長行の幅と行数の高さに四方 2pt の余白を足す', () => {
  assert.deepEqual(layout.boxOf('あいう\nab', 12, widthOf(12)), { width: 40, height: 34 });
  assert.deepEqual(layout.boxOf('', 10, widthOf(10)), { width: 4, height: 16.5 });
});

test('frameOf は表示の左上と大きさから、回転ごとの /Rect と四角を作る', () => {
  assert.deepEqual(layout.frameOf([100, 700], { width: 40, height: 20 }, 0), { rect: [100, 680, 140, 700], quads: [[100, 700, 140, 700, 100, 680, 140, 680]] });
  assert.deepEqual(layout.frameOf([100, 700], { width: 40, height: 20 }, 90).rect, [100, 700, 120, 740]);
});

test('fitOrigin は右端・下端をはみ出す箱を紙の中へ寄せ、viewport が無ければそのまま', () => {
  // 倍率 1・回転 0 の A4（紙の座標の y は上向き、画面の y は下向き）。
  const viewport = {
    width: 595, height: 842, scale: 1,
    convertToViewportPoint: (x, y) => [x, 842 - y],
    convertToPdfPoint: (x, y) => [x, 842 - y],
  };
  assert.deepEqual(layout.fitOrigin([580, 20], { width: 40, height: 30 }, viewport), [555, 30]);
  assert.deepEqual(layout.fitOrigin([100, 700], { width: 40, height: 30 }, viewport), [100, 700]);
  assert.deepEqual(layout.fitOrigin([580, 20], { width: 40, height: 30 }, null), [580, 20]);
});

// ---- 新しい形の余白・斜体の分・自動の幅・行と箱（spec-4b-4a 確定事項B・C） ----

const text = (fields = {}) => ({ kind: 'text', text: 'あいう', fontSize: 10, rotation: 0, ...fields });
// 送り幅（em）の見積もり。
const advanceOf = (unit) => (unit.charCodeAt(0) < 128 ? 0.5 : 1);
const lineWidthOf = widthOf(10);

test('paddingOf は飾りが無ければ 2、塗りか枠線があれば max(2, 大きさ×0.3 の四捨五入)＋枠線の太さ', () => {
  assert.equal(layout.paddingOf(text()), 2);
  assert.equal(layout.paddingOf(text({ fill: null, borderColor: null })), 2);
  assert.equal(layout.paddingOf(text({ fill: '#ffff00' })), 3);
  assert.equal(layout.paddingOf(text({ fontSize: 5, fill: '#ffff00' })), 2);
  assert.equal(layout.paddingOf(text({ fontSize: 48, fill: '#ffff00' })), 14);
  assert.equal(layout.paddingOf(text({ borderColor: '#c00000', borderWidth: 1.5 })), 4.5);
  assert.equal(layout.paddingOf(text({ fill: '#ffff00', borderColor: '#c00000', borderWidth: 4 })), 7);
});

test('insetOf は斜体なら左に 0.08em・右に 0.25em を足す', () => {
  assert.deepEqual(layout.insetOf(text()), { padding: 2, left: 2, top: 2, horizontal: 4, vertical: 4 });
  const italic = layout.insetOf(text({ italic: true, fontSize: 20 }));
  assert.equal(italic.left, 2 + 1.6);
  assert.equal(italic.horizontal, 4 + 1.6 + 5);
  assert.equal(italic.vertical, 4);
});

test('autoWidthOf は全角 12 字で、紙の長さから余白と斜体の分を引いた幅で抑え、下限は 1 字', () => {
  assert.equal(layout.autoWidthOf(text()), 120);
  assert.equal(layout.autoWidthOf(text(), 595), 120);
  assert.equal(layout.autoWidthOf(text({ fontSize: 200 }), 595), 591);
  assert.equal(layout.autoWidthOf(text({ fontSize: 200, italic: true }), 595), 595 - 4 - 16 - 50);
  assert.equal(layout.autoWidthOf(text({ fontSize: 100 }), 50), 100);
});

test('wrapWidthOf は今までの形なら null、自動なら自動の幅、固定なら下限 1 字の幅', () => {
  assert.equal(layout.wrapWidthOf(text()), null);
  assert.equal(layout.wrapWidthOf(text({ width: 'auto' }), 595), 120);
  assert.equal(layout.wrapWidthOf(text({ width: 33.5 })), 33.5);
  assert.equal(layout.wrapWidthOf(text({ width: 4 })), 10);
});

test('layoutOf は今までの形なら折り返さず、箱は今までどおり最長行に合わせる', () => {
  const result = layout.layoutOf(text({ text: 'あいうえおかきくけこさしすせそ\nab' }), { advanceOf, lineWidthOf, pageLength: 595 });
  assert.deepEqual(result.lines, ['あいうえおかきくけこさしすせそ', 'ab']);
  assert.deepEqual(result.size, { width: 154, height: 29 });
  assert.equal(result.padding, 2);
  assert.equal(result.contentWidth, 150);
});

test('layoutOf は自動の幅で 12 字ごとに折り返し、箱は最長行に縮む', () => {
  const long = layout.layoutOf(text({ text: 'あいうえおかきくけこさしすせそ', width: 'auto' }), { advanceOf, lineWidthOf, pageLength: 595 });
  assert.deepEqual(long.lines, ['あいうえおかきくけこさし', 'すせそ']);
  assert.deepEqual(long.size, { width: 124, height: 29 });
  assert.equal(long.contentWidth, 120);
  const short = layout.layoutOf(text({ text: 'あい', width: 'auto' }), { advanceOf, lineWidthOf, pageLength: 595 });
  assert.deepEqual(short.size, { width: 24, height: 16.5 });
});

test('layoutOf は固定の幅で折り返し、箱は短い文でも固定の幅', () => {
  const result = layout.layoutOf(text({ text: 'あいうえ', width: 25 }), { advanceOf, lineWidthOf });
  assert.deepEqual(result.lines, ['あい', 'うえ']);
  assert.deepEqual(result.size, { width: 29, height: 29 });
  const short = layout.layoutOf(text({ text: 'a', width: 25 }), { advanceOf, lineWidthOf });
  assert.equal(short.size.width, 29);
});

test('layoutOf は斜体・飾りの余白も箱に入れる', () => {
  const result = layout.layoutOf(text({ text: 'あい', width: 'auto', italic: true, fill: '#ffff00' }), { advanceOf, lineWidthOf });
  // 中身 20 ＋ 余白 3×2 ＋ 斜体 0.8＋2.5。高さは 1 行 12.5 ＋ 余白 3×2。
  assert.deepEqual(result.size, { width: 29.3, height: 18.5 });
  assert.equal(result.padding, 3);
});
