'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-state.js');
require('../renderer/arrow-head.js');
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

// テキストの角度（spec-4b-4b 確定事項A1・A3・A4）。新しい形（width を持つ）だけが角度を持て、rect は回す前の箱。
function text(overrides = {}) {
  const rect = [100, 600, 220, 640];
  return {
    src: 0, kind: 'text', color: '#222a35', opacity: 1, text: '回す', fontSize: 12, rotation: 0, width: 'auto',
    rect, quads: [SigK.freeTextGeometry.quadOfRect(rect)], ...overrides,
  };
}

test('validEntry はテキストの角度を新しい形のときだけ受ける（今までの形に角度は持たせない）', () => {
  assert.equal(entries.validEntry(text({ angle: 30 })), true);
  assert.equal(entries.validEntry(text({ angle: 359 })), true);
  assert.equal(entries.validEntry(text({ angle: 360 })), false);
  const legacy = text({ angle: 30 });
  delete legacy.width;
  assert.equal(entries.validEntry(legacy), false);
  delete legacy.angle;
  assert.equal(entries.validEntry(legacy), true);
});

test('テキストの角度は写し・比較・書き換え・ワーカーへ渡す形を通る', () => {
  assert.equal(entries.copyEntry(text({ angle: 30 })).angle, 30);
  assert.equal(entries.sameEntry(text({ id: 'a', angle: 30 }), text({ id: 'a', angle: 31 })), false);
  assert.deepEqual(entries.pickPatch({ angle: 45 }, 'text'), { angle: 45 });
  assert.equal(entries.toSaveEntry(text({ angle: 30 })).angle, 30);
  assert.equal('angle' in entries.toSaveEntry(text()), false);
});

// ---- 矢印の先の形（spec-4b-5a 確定事項4） ----

test('矢印は head: open を持てて、写し・比較・保存の形に入る。ほかの種類と open 以外の値は断る', () => {
  const open = { ...line({ kind: 'arrow' }), head: 'open' };
  assert.equal(entries.validEntry(open), true);
  assert.equal(entries.validEntry({ ...open, head: 'closed' }), false);
  assert.equal(entries.validEntry({ ...line(), head: 'open' }), false);
  assert.equal(entries.validEntry({ ...square(), head: 'open' }), false);
  assert.equal(entries.copyEntry(open).head, 'open');
  assert.equal(entries.sameEntry(open, { ...open, head: undefined }), false);
  assert.equal(entries.toSaveEntry(open).head, 'open');
  assert.equal('head' in entries.toSaveEntry(line({ kind: 'arrow' })), false);
  // 画面から変える口は無い
  assert.equal(entries.pickPatch({ head: 'open' }, 'arrow'), null);
});

test('rectOfEntry は書き込みの欄（矢印の先を含む）から形を作り直し、changes を重ねる', () => {
  const geo = SigK.shapeGeometry;
  const paths = [[[100, 600], [300, 550]]];
  const closed = geo.rectOfEntry({ kind: 'arrow', paths, lineWidth: 3, rect: [0, 0, 1, 1] });
  const open = geo.rectOfEntry({ kind: 'arrow', paths, lineWidth: 3, head: 'open', rect: [0, 0, 1, 1] });
  assert.deepEqual(closed, geo.rectOfShape({ kind: 'arrow', paths, lineWidth: 3 }));
  assert.deepEqual(open, geo.rectOfShape({ kind: 'arrow', paths, lineWidth: 3, head: 'open' }));
  assert.notDeepEqual(closed.rect, open.rect);
  const wider = geo.rectOfEntry({ kind: 'arrow', paths, lineWidth: 3, head: 'open', rect: [0, 0, 1, 1] }, { lineWidth: 6 });
  assert.deepEqual(wider, geo.rectOfShape({ kind: 'arrow', paths, lineWidth: 6, head: 'open' }));
  const turned = geo.rectOfEntry({ kind: 'square', rect: [10, 10, 50, 30], lineWidth: 2, angle: 30 }, { angle: 0 });
  assert.deepEqual(turned.rect, [10, 10, 50, 30]);
});
