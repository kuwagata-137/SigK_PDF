'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/shape-style.js');

// 図形の見た目（線の色・塗り・線種・破線の間隔・雲形の強さ。spec-4b-1b 確定事項16〜21・32・33・35）。

const style = globalThis.SigK.shapeStyle;

const square = (fields = {}) => ({ kind: 'square', color: '#c00000', lineWidth: 2, ...fields });
const line = (fields = {}) => ({ kind: 'line', color: '#c00000', lineWidth: 2, ...fields });

test('線種は、四角・丸が実線・破線・雲形、直線・矢印が実線・破線、ほかは実線だけ', () => {
  assert.deepEqual(style.lineStylesOf('square'), ['solid', 'dashed', 'cloudy']);
  assert.deepEqual(style.lineStylesOf('circle'), ['solid', 'dashed', 'cloudy']);
  assert.deepEqual(style.lineStylesOf('line'), ['solid', 'dashed']);
  assert.deepEqual(style.lineStylesOf('arrow'), ['solid', 'dashed']);
  for (const kind of ['ink', 'text', 'note', 'highlight'])
    assert.deepEqual(style.lineStylesOf(kind), ['solid'], kind);
  assert.deepEqual(style.DEFAULT_DASH, [3, 2]);
  assert.equal(style.DEFAULT_CLOUD_INTENSITY, 1);
});

// 線と塗りを両方なしにはできない（確定事項4・16）。
test('線なし（color が null）は四角・丸で塗りがあるときだけ', () => {
  assert.equal(style.validStyle(square()), true);
  assert.equal(style.validStyle(square({ color: null, fill: '#ffd966' })), true);
  assert.equal(style.validStyle(square({ color: null })), false);
  assert.equal(style.validStyle(square({ color: null, fill: null })), false);
  assert.equal(style.validStyle({ kind: 'circle', color: null, fill: '#a9ce91' }), true);
  assert.equal(style.validStyle(line({ color: null })), false);
  assert.equal(style.validStyle({ kind: 'highlight', color: null }), false);
  assert.equal(style.validStyle({ kind: 'text', color: '#222a35' }), true);
});

test('塗りは四角・丸だけが #rrggbb か null で持てる', () => {
  assert.equal(style.validStyle(square({ fill: '#FFD966' })), true);
  assert.equal(style.validStyle(square({ fill: null })), true);
  assert.equal(style.validStyle(square({ fill: 'yellow' })), false);
  assert.equal(style.validStyle(line({ fill: '#ffd966' })), false);
  assert.equal(style.validStyle({ kind: 'ink', color: '#c00000', fill: '#ffd966' }), false);
  assert.equal(style.fillOf(square()), null);
});

test('線種は種類で選べるものだけ。間隔は破線のとき、強さは雲形のときだけ持てる', () => {
  assert.equal(style.validStyle(square({ lineStyle: 'cloudy' })), true);
  assert.equal(style.validStyle(line({ lineStyle: 'cloudy' })), false);
  assert.equal(style.validStyle({ kind: 'ink', color: '#c00000', lineStyle: 'dashed' }), false);
  assert.equal(style.validStyle({ kind: 'ink', color: '#c00000', lineStyle: 'solid' }), true);
  assert.equal(style.validStyle(line({ lineStyle: 'dashed', dash: [4, 2] })), true);
  assert.equal(style.validStyle(line({ lineStyle: 'solid', dash: [4, 2] })), false);
  assert.equal(style.validStyle(square({ lineStyle: 'cloudy', cloudIntensity: 2 })), true);
  assert.equal(style.validStyle(square({ lineStyle: 'cloudy', cloudIntensity: 2.5 })), false);
  assert.equal(style.validStyle(square({ lineStyle: 'cloudy', cloudIntensity: 0 })), false);
  assert.equal(style.validStyle(square({ lineStyle: 'dashed', cloudIntensity: 1 })), false);
  assert.equal(style.validStyle(square({ lineStyle: 'wavy' })), false);
});

// 読み込んだ間隔の受け取れる範囲（確定事項21）: 1〜8 個の数で、どれも 0 以上 100 以下、和が 0.1 以上。
test('間隔の倍数は 1〜8 個で、どれも 0〜100、和が 0.1 以上', () => {
  for (const dash of [[3], [3, 2], [6, 3, 1, 3], [0, 2], Array(8).fill(1), [100, 0.1]])
    assert.equal(style.validDash(dash), true, JSON.stringify(dash));
  for (const dash of [[], Array(9).fill(1), [-1, 2], [101], [0, 0], [0.05, 0.04], ['3'], [NaN], null])
    assert.equal(style.validDash(dash), false, JSON.stringify(dash));
});

test('写しは持っている欄だけを写し、間隔は別の配列にする', () => {
  const source = square({ fill: '#ffd966', lineStyle: 'dashed', dash: [4, 2] });
  const copy = style.copyStyle(source, {});
  assert.deepEqual(copy, { fill: '#ffd966', lineStyle: 'dashed', dash: [4, 2] });
  assert.notEqual(copy.dash, source.dash);
  assert.deepEqual(style.copyStyle(square(), {}), {});
  assert.deepEqual(style.copyStyle(square({ lineStyle: 'cloudy', cloudIntensity: 2 }), {}), { lineStyle: 'cloudy', cloudIntensity: 2 });
});

test('見た目の比べ方: 無い欄は既定として比べ、間隔・塗り・雲形の強さの違いを見る', () => {
  assert.equal(style.sameStyle(square(), square({ lineStyle: 'solid', fill: null })), true);
  assert.equal(style.sameStyle(square(), square({ fill: '#ffd966' })), false);
  assert.equal(style.sameStyle(square({ lineStyle: 'dashed' }), square({ lineStyle: 'dashed', dash: [3, 2] })), false, '持っている間隔と既定は別');
  assert.equal(style.sameStyle(line({ lineStyle: 'dashed', dash: [4, 2] }), line({ lineStyle: 'dashed', dash: [4, 2] })), true);
  assert.equal(style.sameStyle(square({ lineStyle: 'cloudy' }), square({ lineStyle: 'cloudy', cloudIntensity: 1 })), true);
  assert.equal(style.sameStyle(square({ lineStyle: 'cloudy', cloudIntensity: 2 }), square({ lineStyle: 'cloudy' })), false);
});

// 線種を替えたら、読み込んだ間隔と強さは捨て、雲形にしたときの強さは 1（確定事項18）。
test('線種を替えると間隔と強さを整え、同じ線種なら残す', () => {
  const dashed = square({ lineStyle: 'dashed', dash: [4, 2] });
  assert.deepEqual(style.restyle(dashed, 'solid'), square({ lineStyle: 'solid' }));
  assert.deepEqual(style.restyle(dashed, 'cloudy'), square({ lineStyle: 'cloudy', cloudIntensity: 1 }));
  assert.deepEqual(style.restyle(dashed, 'dashed'), dashed);
  const cloudy = square({ lineStyle: 'cloudy', cloudIntensity: 2 });
  assert.deepEqual(style.restyle(cloudy, 'cloudy'), cloudy);
  assert.deepEqual(style.restyle(cloudy, 'dashed'), square({ lineStyle: 'dashed' }));
  assert.equal(dashed.dash.length, 2, '元は変えない');
});

// 保存の形には既定と違う欄だけを載せる（塗りなし・実線は載せない。確定事項35）。
test('保存する見た目の欄は既定と違うものだけ', () => {
  assert.deepEqual(style.saveStyle(square()), {});
  assert.deepEqual(style.saveStyle(square({ lineStyle: 'solid', fill: null })), {});
  assert.deepEqual(style.saveStyle(square({ color: null, fill: '#ffd966' })), { fill: '#ffd966' });
  assert.deepEqual(style.saveStyle(line({ lineStyle: 'dashed' })), { lineStyle: 'dashed' });
  assert.deepEqual(style.saveStyle(line({ lineStyle: 'dashed', dash: [4, 2] })), { lineStyle: 'dashed', dash: [4, 2] });
  assert.deepEqual(style.saveStyle(square({ lineStyle: 'cloudy' })), { lineStyle: 'cloudy', cloudIntensity: 1 });
  assert.deepEqual(style.saveStyle(square({ lineStyle: 'cloudy', cloudIntensity: 2 })), { lineStyle: 'cloudy', cloudIntensity: 2 });
});

// 描く破線の間隔は倍数に線の太さを掛けたもの（確定事項32）。
test('破線の間隔は倍数に線の太さを掛ける。破線でなければ null', () => {
  assert.equal(style.dashOf(square()), null);
  assert.equal(style.dashOf(square({ lineStyle: 'cloudy' })), null);
  assert.deepEqual(style.dashOf(square({ lineStyle: 'dashed', lineWidth: 4 })), [12, 8]);
  assert.deepEqual(style.dashOf(line({ lineStyle: 'dashed', dash: [4, 2], lineWidth: 1.5 })), [6, 3]);
});
