'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/annotation-palette.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/shape-tool-memory.js');

// 図形の書き込みツールごとの、次に追加する書き込みの値（renderer/shape-tool-memory.js。決定102 ⑨・質問 SH7 案B）。

const SigK = globalThis.SigK;
const memory = SigK.shapeToolMemory;

function withPersist(t) {
  const calls = [];
  SigK.shell = { persist: (patch) => calls.push(patch) };
  memory.reset();
  t.after(() => {
    delete SigK.shell;
    memory.reset();
  });
  return calls;
}

test('種類ごとに記憶して settings.json に書き、変わらない値と受け取れない値は書かない', (t) => {
  const calls = withPersist(t);
  assert.equal(memory.set('square', 'lineWidth', 8), true);
  assert.equal(memory.set('square', 'lineWidth', 8), false);
  assert.equal(memory.set('square', 'lineWidth', 41), false);
  assert.equal(memory.set('square', 'color', '#0070C0'), true);
  assert.equal(memory.set('ink', 'color', '#0070c0'), false, '図形でない種類は記憶しない');
  assert.deepEqual([memory.get('square', 'lineWidth'), memory.get('circle', 'lineWidth'), memory.get('square', 'color')], [8, 2, '#0070c0']);
  assert.equal(memory.setHatch('circle', { gap: 9, width: 99 }), true, '受け取れる欄だけを重ねる');
  assert.deepEqual(memory.get('circle', 'hatch'), { pattern: 'none', color: '#ff0000', gap: 9, width: 1 });
  assert.deepEqual(calls, [
    { annotShapeStyles: { square: { lineWidth: 8 } } },
    { annotShapeStyles: { square: { color: '#0070c0' } } },
    { annotShapeStyles: { circle: { hatch: { gap: 9 } } } },
  ]);
});

test('起動時に種類ごとの値を戻し、種類の値が無い欄は版 1.4.0 までの共有の値を転記する', (t) => {
  withPersist(t);
  memory.apply({
    annotColors: { shape: '#00B050' }, annotLineWidth: 7, annotOpacity: { shape: 0.5 }, annotHatch: { shape: { pattern: 'grid' } },
    annotShapeStyles: { circle: { color: '#0070c0', lineWidth: 3, fill: '#ffff00', strokeNone: true }, line: { lineWidth: 99 } },
  });
  assert.deepEqual([memory.get('square', 'color'), memory.get('square', 'lineWidth'), memory.get('square', 'opacity')], ['#00b050', 7, 0.5]);
  assert.deepEqual([memory.get('circle', 'color'), memory.get('circle', 'lineWidth'), memory.get('circle', 'strokeNone')], ['#0070c0', 3, true]);
  assert.equal(memory.get('line', 'lineWidth'), 7, '受け取れない値は共有の値にする');
  assert.equal(memory.get('polygon', 'hatch').pattern, 'grid');
});
