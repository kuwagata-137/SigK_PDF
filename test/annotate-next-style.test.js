'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/annotation-palette.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/shape-tool-memory.js');
require('../renderer/annotate-next-style.js');

// 次に付ける見た目（色・塗り・線なし・線種）の置き場（spec-4b-1b 確定事項22〜25・28）。図形は書き込みツールごとに記憶する
// （決定102 ⑨・質問 SH7 案B。shape-tool-memory.js）。書き込みに当てるのは annotate-color.test.js が見る。

const SigK = globalThis.SigK;
const next = SigK.annotateNextStyle;
const memory = SigK.shapeToolMemory;

// settings.json へ書いた差分を控える。
function withPersist(t) {
  const calls = [];
  SigK.shell = { persist: (patch) => calls.push(patch) };
  next.reset();
  t.after(() => {
    delete SigK.shell;
    next.reset();
  });
  return calls;
}

test('既定は道具ごとのパレットの色・塗りなし・線あり・実線', (t) => {
  withPersist(t);
  assert.deepEqual(next.nextStyleOf('square'), { color: '#ff0000', fill: null, lineStyle: 'solid' });
  assert.deepEqual(next.nextStyleOf('highlight'), { color: '#ffd966', fill: null, lineStyle: 'solid' });
  assert.equal(next.colorOf('ink'), '#c00000');
  assert.equal(next.colorOf('text'), '#222a35');
});

test('起動時の値は形を確かめてから当て、色は小文字にそろえる。図形は書き込みツールごとの値を戻す', (t) => {
  withPersist(t);
  next.applyColors({ text: '#4472C4', note: '#a9ce91' });
  assert.deepEqual([next.colorOf('text'), next.colorOf('note')], ['#4472c4', '#a9ce91']);
  memory.apply({ annotShapeStyles: { circle: { color: '#0070C0', fill: '#FFFF00', strokeNone: true, lineStyle: 'dashed' }, square: { fill: 'yellow', lineStyle: 'wavy' } } });
  assert.deepEqual(next.nextStyleOf('circle'), { color: null, fill: '#ffff00', lineStyle: 'dashed' });
  assert.equal(next.colorOf('circle'), '#0070c0');
  assert.deepEqual(next.nextStyleOf('square'), { color: '#ff0000', fill: null, lineStyle: 'solid' }, '範囲の外は捨てる');
});

test('起動時に種類の値が無い欄は、版 1.4.0 までの共有の値（annotColors.shape など）を転記する', (t) => {
  withPersist(t);
  memory.apply({ annotColors: { shape: '#00B050' }, annotFills: { shape: '#ffff00' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'dashed' },
    annotShapeStyles: { circle: { color: '#0070c0' } } });
  assert.deepEqual(next.nextStyleOf('square'), { color: null, fill: '#ffff00', lineStyle: 'dashed' });
  assert.equal(next.colorOf('square'), '#00b050');
  assert.equal(next.colorOf('circle'), '#0070c0', '種類の値があればそちら');
  assert.deepEqual(next.nextStyleOf('arrow'), { color: '#00b050', fill: null, lineStyle: 'dashed' }, '直線・矢印は塗りと線なしを持たない');
});

test('線なしは塗りがあるときだけで、直線・矢印の雲形は実線として返す', (t) => {
  withPersist(t);
  next.rememberShape('strokeNone', true, 'square');
  assert.equal(next.strokeNoneOf('square'), false, '塗りが無ければ線なしにしない');
  next.rememberShape('lineStyles', 'cloudy', 'circle');
  next.rememberShape('lineStyles', 'cloudy', 'line');
  assert.equal(next.lineStyleOf('circle'), 'cloudy');
  assert.equal(next.lineStyleOf('square'), 'solid', 'ほかの書き込みツールの線種は変えない');
  assert.equal(next.lineStyleOf('line'), 'solid');
  assert.equal(next.lineStyleOf('ink'), 'solid');
});

test('覚えるときだけ settings.json へ書き、変わらなければ書かない。図形は書き込みツールごとに書く', (t) => {
  const calls = withPersist(t);
  assert.equal(next.rememberColor('square', '#4472C4'), true);
  assert.equal(next.colorOf('circle'), '#ff0000', '丸の色は変えない');
  assert.equal(next.rememberColor('ink', 'blue'), false);
  assert.equal(next.rememberColor('other', '#4472c4'), false, '道具の無い種類は覚えない');
  assert.equal(next.rememberColor('ink', '#0070c0'), true);
  next.rememberShape('fills', '#ffff00', 'square');
  next.rememberShape('fills', '#ffff00', 'square');
  next.rememberShape('strokeNone', false, 'square');
  assert.deepEqual(calls, [
    { annotShapeStyles: { square: { color: '#4472c4' } } },
    { annotColors: { pen: '#0070c0' } },
    { annotShapeStyles: { square: { fill: '#ffff00' } } },
  ]);
});
