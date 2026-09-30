'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/annotation-palette.js');
require('../renderer/shape-style.js');
require('../renderer/annotate-next-style.js');

// 次に付ける見た目（色・塗り・線なし・線種）の置き場（spec-4b-1b 確定事項22〜25・28）。書き込みに当てるのは
// annotate-color.test.js が見る。

const SigK = globalThis.SigK;
const next = SigK.annotateNextStyle;

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
  assert.deepEqual(next.nextStyleOf('square'), { color: '#c00000', fill: null, lineStyle: 'solid' });
  assert.deepEqual(next.nextStyleOf('highlight'), { color: '#ffd966', fill: null, lineStyle: 'solid' });
  assert.equal(next.colorOf('ink'), '#c00000');
  assert.equal(next.colorOf('text'), '#222a35');
});

test('起動時の値は形を確かめてから当て、色は小文字にそろえる', (t) => {
  withPersist(t);
  next.applyColors({ text: '#4472C4', shape: 'red', note: '#a9ce91' });
  assert.deepEqual([next.colorOf('text'), next.colorOf('square'), next.colorOf('note')], ['#4472c4', '#c00000', '#a9ce91']);
  next.applyFills({ shape: '#FFFF00' });
  next.applyStrokeNone({ shape: true });
  next.applyLineStyles({ shape: 'dashed' });
  assert.deepEqual(next.nextStyleOf('circle'), { color: null, fill: '#ffff00', lineStyle: 'dashed' });
  // 範囲の外は捨てる。直線・矢印は塗りと線なしを持たない。
  next.applyFills({ shape: 'yellow' });
  next.applyStrokeNone({ shape: 'yes' });
  next.applyLineStyles({ shape: 'wavy' });
  assert.deepEqual(next.nextStyleOf('square'), { color: null, fill: '#ffff00', lineStyle: 'dashed' });
  assert.deepEqual(next.nextStyleOf('arrow'), { color: '#c00000', fill: null, lineStyle: 'dashed' });
});

test('線なしは塗りがあるときだけで、直線・矢印の雲形は実線として返す', (t) => {
  withPersist(t);
  next.applyStrokeNone({ shape: true });
  assert.equal(next.strokeNoneOf('square'), false, '塗りが無ければ線なしにしない');
  next.applyLineStyles({ shape: 'cloudy' });
  assert.equal(next.lineStyleOf('circle'), 'cloudy');
  assert.equal(next.lineStyleOf('line'), 'solid');
  assert.equal(next.lineStyleOf('ink'), 'solid');
});

test('覚えるときだけ settings.json へ書き、変わらなければ書かない', (t) => {
  const calls = withPersist(t);
  assert.equal(next.rememberColor('square', '#4472C4'), true);
  assert.equal(next.rememberColor('ink', 'blue'), false);
  assert.equal(next.rememberColor('other', '#4472c4'), false, '道具の無い種類は覚えない');
  next.rememberShape('fills', '#ffff00');
  next.rememberShape('fills', '#ffff00');
  next.rememberShape('strokeNone', false);
  assert.deepEqual(calls, [{ annotColors: { shape: '#4472c4' } }, { annotFills: { shape: '#ffff00' } }]);
});
