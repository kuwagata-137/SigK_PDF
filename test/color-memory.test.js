'use strict';

// 最近使用した色と直前の色（spec-7-2 確定事項A4・B2・D5）。

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-palette.js');
require('../renderer/color-memory.js');
const { ANNOT_DEFAULTS } = require('../annotation-settings.js');

const SigK = globalThis.SigK;
const memory = SigK.colorMemory;

function withPersist(t) {
  const patches = [];
  SigK.shell = { persist: (patch) => patches.push(patch) };
  memory.reset();
  t.after(() => {
    delete SigK.shell;
    memory.reset();
  });
  return patches;
}

test('直前の色の既定は settings.json の既定と同じ', () => {
  assert.deepEqual({ ...memory.DEFAULT_LAST }, ANNOT_DEFAULTS.annotLastColors);
});

test('最近使用した色は一覧に無い色だけを新しい順に 10 色まで足し、settings.json に書く', (t) => {
  const patches = withPersist(t);
  assert.equal(memory.pushRecent('#4472c4'), false, '一覧の色は足さない');
  assert.equal(memory.pushRecent('#2E75B6'), true);
  assert.equal(memory.pushRecent('#123456'), true);
  assert.equal(memory.pushRecent('#2e75b6'), true, '同じ色は先頭へ移す');
  assert.equal(memory.pushRecent('#2e75b6'), false, '並びが変わらなければ書かない');
  assert.deepEqual(memory.recent(), ['#2e75b6', '#123456']);
  for (let i = 0; i < 12; i++)
    memory.pushRecent(`#0101${String(i).padStart(2, '0')}`);
  assert.equal(memory.recent().length, 10);
  assert.deepEqual(patches.at(-1), { annotRecentColors: memory.recent() });
  assert.equal(memory.pushRecent('x'), false);
});

test('直前の色は役割ごとに覚え、塗り以外の［なし］や形の違う値は覚えない', (t) => {
  const patches = withPersist(t);
  assert.equal(memory.setLast('fill', '#FFD966'), true);
  assert.equal(memory.lastOf('fill'), '#ffd966');
  assert.equal(memory.setLast('fill', '#ffd966'), false, '同じ色なら書かない');
  assert.equal(memory.setLast('line', null), false, '線の［なし］は覚えない');
  assert.equal(memory.setLast('other', '#000000'), false);
  assert.equal(memory.setLastStyle(15), true);
  assert.equal(memory.setLastStyle(21), false);
  assert.deepEqual(patches, [{ annotLastColors: { fill: '#ffd966' } }, { annotLastColors: { style: 15 } }]);
});

// 質問 SH6 案B「塗りなしを選んだ後は、カラーバーも黒枠に中身は白にする。バケツのボタンをクリックすると、塗りつぶしなしを当てる。」
test('塗りの［塗りなし］（null）は直前の色として覚え、settings.json に書き、起動時に戻す', (t) => {
  const patches = withPersist(t);
  assert.deepEqual([...memory.NONE_ROLES], ['fill']);
  assert.equal(memory.setLast('fill', null), true);
  assert.equal(memory.lastOf('fill'), null);
  assert.equal(memory.setLast('fill', null), false, '同じなら書かない');
  assert.deepEqual(patches, [{ annotLastColors: { fill: null } }]);
  memory.reset();
  assert.equal(memory.apply({ lastColors: { fill: null, line: null } }).last.fill, null);
  assert.equal(memory.lastOf('line'), '#ed7d31', '線の null は捨てる');
});

test('起動時に settings.json の値を戻す。形の違う値は捨てる', (t) => {
  withPersist(t);
  const result = memory.apply({ recentColors: ['#ABCDEF', 'bad', '#abcdef', '#111111'], lastColors: { line: '#010203', font: 'red', style: 3 } });
  assert.deepEqual(result.recent, ['#abcdef', '#111111']);
  assert.deepEqual(result.last, { line: '#010203', fill: '#5b9bd5', font: '#ff0000', mark: '#ffff00', style: 3 });
  memory.apply({});
  assert.deepEqual(memory.recent(), ['#abcdef', '#111111'], '値が無ければ今のまま');
});
