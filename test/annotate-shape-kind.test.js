'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/annotate-shape-kind.js');

// 線の太さと図形の種類（spec-4-3 確定事項7・19・27・29）。annotate-shape.js から移した（spec-4b-5a a0）。
// 選んだ図形への当て方は annotate-shape.test.js が画面ごと見る。ここは覚える値と道具の段・設定への知らせだけを見る。

const SigK = globalThis.SigK;
const kinds = SigK.annotateShapeKind;

function stub() {
  const calls = { persist: [], sync: [], refresh: 0 };
  SigK.shell = { persist: (patch) => calls.persist.push(patch) };
  SigK.editBar = { sync: (tool, kind) => calls.sync.push([tool, kind]) };
  SigK.annotationProps = { refresh: () => { calls.refresh += 1; } };
  SigK.annotate = { getTool: () => 'shape' };
  return calls;
}

test('太さと種類は、覚えていなければ既定の値', () => {
  stub();
  assert.equal(kinds.getLineWidth(), SigK.annotationPresets.DEFAULT_LINE_WIDTH);
  assert.equal(kinds.getShapeKind(), SigK.annotationPresets.DEFAULT_SHAPE_KIND);
});

test('applyLineWidth は 1〜40 の整数だけを受け、設定へは書かない', () => {
  const calls = stub();
  assert.equal(kinds.applyLineWidth(5), 5);
  assert.equal(kinds.applyLineWidth(0.5), 5);
  assert.equal(kinds.applyLineWidth(41), 5);
  assert.deepEqual(calls.persist, []);
});

test('rememberLineWidth は覚えて設定へ書き、範囲の外は断る', () => {
  const calls = stub();
  assert.equal(kinds.rememberLineWidth(7), true);
  assert.equal(kinds.getLineWidth(), 7);
  assert.equal(kinds.rememberLineWidth(0), false);
  assert.deepEqual(calls.persist, [{ annotLineWidth: 7 }]);
});

test('setShapeKind は図形の種類だけを受け、設定へ書いて道具の段の印を揃える', () => {
  const calls = stub();
  assert.equal(kinds.setShapeKind('note'), false);
  assert.equal(kinds.setShapeKind('circle'), true);
  assert.equal(kinds.getShapeKind(), 'circle');
  assert.deepEqual(calls.persist, [{ annotShapeKind: 'circle' }]);
  assert.deepEqual(calls.sync, [['shape', 'circle']]);
  assert.equal(kinds.applyShapeKind('line'), 'line');
  assert.deepEqual(calls.persist, [{ annotShapeKind: 'circle' }]);
});
