'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-style.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-state.js');
require('../renderer/shape-geometry.js');
require('../renderer/shape-rotation.js');

// 書き込みの角度（spec-4b-2 確定事項1〜5）。四角・丸だけが angle（画面で時計回りの度。0 は持たない）を持て、
// rect は回す前の箱、quads は回した 4 隅。

const SigK = globalThis.SigK;
const entries = SigK.annotationEntry;
const state = SigK.annotationState;

function square(overrides = {}) {
  const rect = [100, 600, 240, 680];
  return { src: 0, kind: 'square', color: '#c00000', opacity: 1, lineWidth: 2, rect, quads: [SigK.freeTextGeometry.quadOfRect(rect)], ...overrides };
}

function line(overrides = {}) {
  return { src: 0, kind: 'line', color: '#c00000', opacity: 1, lineWidth: 2, rect: [99, 599, 201, 701], quads: [[99, 701, 201, 701, 99, 599, 201, 599]], paths: [[[100, 600], [200, 700]]], ...overrides };
}

test('validEntry は四角・丸の角度を 0 以上 360 未満の数で受け、ほかの種類の角度は断る', () => {
  assert.equal(entries.validEntry(square({ angle: 30 })), true);
  assert.equal(entries.validEntry(square({ kind: 'circle', angle: 359.5 })), true);
  assert.equal(entries.validEntry(square({ angle: 0 })), true);
  assert.equal(entries.validEntry(square({ angle: 360 })), false);
  assert.equal(entries.validEntry(square({ angle: -1 })), false);
  assert.equal(entries.validEntry(square({ angle: Number.NaN })), false);
  assert.equal(entries.validEntry(square({ angle: '30' })), false);
  assert.equal(entries.validEntry(line({ angle: 30 })), false);
  assert.equal(entries.validEntry({ src: 0, kind: 'highlight', color: '#ffe45a', quads: [[0, 1, 1, 1, 0, 0, 1, 0]], rect: [0, 0, 1, 1], angle: 30 }), false);
});

test('copyEntry は角度を写し、0 は写さない', () => {
  assert.equal(entries.copyEntry(square({ angle: 30 })).angle, 30);
  assert.equal('angle' in entries.copyEntry(square({ angle: 0 })), false);
  assert.equal('angle' in entries.copyEntry(square()), false);
});

test('sameEntry は角度の違いを見て、無いものと 0 を同じとみなす', () => {
  assert.equal(entries.sameEntry(square({ id: 'a', angle: 30 }), square({ id: 'a', angle: 31 })), false);
  assert.equal(entries.sameEntry(square({ id: 'a' }), square({ id: 'a', angle: 0 })), true);
  assert.equal(entries.sameEntry(square({ id: 'a', angle: 45 }), square({ id: 'a', angle: 45 })), true);
});

test('toSaveEntry は 0 でない角度だけを載せる', () => {
  assert.equal(entries.toSaveEntry(square({ angle: 30 })).angle, 30);
  assert.equal('angle' in entries.toSaveEntry(square()), false);
  assert.equal('angle' in entries.toSaveEntry(square({ angle: 0 })), false);
});

test('pickPatch は四角・丸の角度を受け、直線の角度と範囲の外は断る', () => {
  assert.deepEqual(entries.pickPatch({ angle: 45 }, 'square'), { angle: 45 });
  assert.equal(entries.pickPatch({ angle: 45 }, 'line'), null);
  assert.equal(entries.pickPatch({ angle: 400 }, 'circle'), null);
  assert.ok(entries.PATCH_FIELDS.includes('angle'));
});

test('applyPatch は角度 0 を持たない形にする', () => {
  const turned = entries.applyPatch(square({ angle: 30 }), { angle: 0 });
  assert.equal('angle' in turned, false);
  assert.equal(entries.applyPatch(square(), { angle: 90 }).angle, 90);
});

test('updateAnnot は読み込んだ四角の写しにも角度を残し、角度を変えられる', () => {
  const imported = { 0: [square({ ref: '12R', angle: 30 })] };
  const annots = state.createAnnots();
  const colored = state.updateAnnot(annots, imported[0][0], { color: '#1e8e3e' });
  assert.equal(colored.added[0].angle, 30);
  assert.deepEqual(colored.removed, ['12R']);
  const own = state.addAnnot(state.createAnnots(), square({ angle: 30 }));
  const turned = state.updateAnnot(own, own.added[0], { angle: 120 });
  assert.equal(turned.added[0].angle, 120);
});

test('rectOfShape は回した四角・丸の箱を回す前のまま、四角を回した 4 隅にする', () => {
  const rect = [100, 600, 240, 680];
  const turned = SigK.shapeGeometry.rectOfShape({ kind: 'square', rect, angle: 30 });
  assert.deepEqual(turned.rect, rect);
  assert.deepEqual(turned.quads, [SigK.shapeRotation.quadOf(rect, 30)]);
  const plain = SigK.shapeGeometry.rectOfShape({ kind: 'circle', rect });
  assert.deepEqual(plain.quads, [SigK.freeTextGeometry.quadOfRect(rect)]);
});
