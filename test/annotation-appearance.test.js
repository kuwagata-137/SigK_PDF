'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { num, parseColor, appearanceOf } = require('../worker/annotation-appearance.js');

// 外観（/AP /N）の中身（spec-4-1 確定事項25・26）。pdf-lib を知らない純粋層。

const QUAD = [48, 753, 232, 753, 48, 743, 232, 743];
const RECT = [48, 743, 232, 753];

test('num は固定小数で書き、末尾の 0 を落とす', () => {
  assert.equal(num(48), '48');
  assert.equal(num(752.35), '752.35');
  assert.equal(num(0.5), '0.5');
  assert.equal(num(1e-7), '0');
  assert.equal(num(0.9), '0.9');
});

test('parseColor は #rrggbb を 0〜1 の RGB にする', () => {
  assert.deepEqual(parseColor('#ff0000'), [1, 0, 0]);
  assert.deepEqual(parseColor('#000000'), [0, 0, 0]);
  assert.equal(parseColor('red'), null);
  assert.equal(parseColor(undefined), null);
});

test('ハイライトは multiply の塗りになる', () => {
  const ap = appearanceOf({ kind: 'highlight', quads: [QUAD], rect: RECT, color: '#ffe45a' });
  assert.equal(ap.subtype, 'Highlight');
  assert.equal(ap.blend, 'Multiply');
  assert.equal(ap.opacity, 1);
  assert.deepEqual(ap.bbox, RECT);
  assert.equal(ap.content, ['/GS gs', '1 0.89 0.35 rg', '48 743 184 10 re f'].join('\n'));
});

test('下線は下辺の少し上、取り消し線は中央に線を引く', () => {
  const underline = appearanceOf({ kind: 'underline', quads: [QUAD], rect: RECT, color: '#d92c2c' });
  assert.equal(underline.subtype, 'Underline');
  assert.equal(underline.blend, null);
  // 高さ 10 → 太さ 0.71（10/14）。下線は y3 + 太さ。
  assert.equal(underline.content, ['/GS gs', '0.85 0.17 0.17 RG', '0.71 w 48 743.71 m 232 743.71 l S'].join('\n'));
  const strike = appearanceOf({ kind: 'strikeout', quads: [QUAD], rect: RECT, color: '#000000' });
  assert.equal(strike.subtype, 'StrikeOut');
  assert.equal(strike.content, ['/GS gs', '0 0 0 RG', '0.71 w 48 748 m 232 748 l S'].join('\n'));
});

test('線の太さは 0.5pt を下回らない', () => {
  const tiny = [0, 3, 10, 3, 0, 0, 10, 0];
  const ap = appearanceOf({ kind: 'underline', quads: [tiny], rect: [0, 0, 10, 3], color: '#000000' });
  assert.match(ap.content, /^0\.5 w /m);
});

test('四角が複数なら操作も複数になる', () => {
  const second = [48, 740, 300, 740, 48, 730, 300, 730];
  const ap = appearanceOf({ kind: 'highlight', quads: [QUAD, second], rect: [48, 730, 300, 753], color: '#8ce99a', opacity: 0.6 });
  assert.equal(ap.content.split('\n').length, 4);
  assert.equal(ap.opacity, 0.6);
});

test('不透明度は 0〜1 に丸め、数でなければ 1', () => {
  assert.equal(appearanceOf({ kind: 'highlight', quads: [QUAD], rect: RECT, color: '#ffe45a', opacity: 2 }).opacity, 1);
  assert.equal(appearanceOf({ kind: 'highlight', quads: [QUAD], rect: RECT, color: '#ffe45a', opacity: 'x' }).opacity, 1);
});

test('形が違えば null', () => {
  assert.equal(appearanceOf({ kind: 'stamp', quads: [QUAD], rect: RECT, color: '#ffe45a' }), null);
  assert.equal(appearanceOf({ kind: 'highlight', quads: [], rect: RECT, color: '#ffe45a' }), null);
  assert.equal(appearanceOf({ kind: 'highlight', quads: [[1, 2]], rect: RECT, color: '#ffe45a' }), null);
  assert.equal(appearanceOf({ kind: 'highlight', quads: [QUAD], rect: RECT, color: 'yellow' }), null);
  assert.equal(appearanceOf({ kind: 'highlight', quads: [QUAD], rect: [1], color: '#ffe45a' }), null);
});
