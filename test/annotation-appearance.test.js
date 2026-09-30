'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { num, colorNum, colorOps, parseColor, appearanceOf } = require('../worker/annotation-appearance.js');

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
  assert.equal(ap.content, ['/GS gs', '1 0.894 0.353 rg', '48 743 184 10 re f'].join('\n'));
});

test('下線は下辺の少し上、取り消し線は中央に線を引く', () => {
  const underline = appearanceOf({ kind: 'underline', quads: [QUAD], rect: RECT, color: '#d92c2c' });
  assert.equal(underline.subtype, 'Underline');
  assert.equal(underline.blend, null);
  // 高さ 10 → 太さ 0.71（10/14）。下線は y3 + 太さ。
  assert.equal(underline.content, ['/GS gs', '0.851 0.173 0.173 RG', '0.71 w 48 743.71 m 232 743.71 l S'].join('\n'));
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

// 色の成分は小数 3 桁で書く（spec-4b-1a 確定事項34）。pdf.js はテキストの色を外観の rg から読み、0〜255 へ四捨五入する
// ので、2 桁では保存のたびに 1 段ずれた（事前調査 A: #d92c2c → #d92b2b）。3 桁なら誤差は最大 0.13 で、どの段も往復する。
test('colorNum は 8bit の色の 256 段すべてを往復させ、末尾の 0 は落とす', () => {
  for (let value = 0; value <= 255; value += 1)
    assert.equal(Math.round(Number(colorNum(value / 255)) * 255), value, `${value} が往復しない`);
  // 2 桁（座標の書き方）では往復しない段がある。
  assert.equal(Math.round(Number(num(44 / 255)) * 255), 43);
  assert.equal(colorNum(1), '1');
  assert.equal(colorNum(0), '0');
  assert.equal(colorNum(0.5), '0.5');
  assert.equal(colorOps(parseColor('#d92c2c')), '0.851 0.173 0.173');
});
