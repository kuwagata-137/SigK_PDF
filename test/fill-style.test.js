'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/fill-style.js');
require('../renderer/shape-style.js');
require('../renderer/free-text-entry.js');
require('../renderer/annotation-entry-rules.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-state.js');
require('../renderer/shape-geometry.js');

// 塗りの透明度とハッチングの欄（spec-7-9 確定事項B2・B4・B5・C1〜C4）。

const SigK = globalThis.SigK;
const fill = SigK.fillStyle;
const style = SigK.shapeStyle;
const entries = SigK.annotationEntry;
const state = SigK.annotationState;

const HATCH = Object.freeze({ pattern: 'diagonal', color: '#0070c0', gap: 6, width: 1 });

function square(overrides = {}) {
  const rect = [100, 600, 240, 680];
  return { src: 0, kind: 'square', color: '#c00000', fill: '#ffd966', opacity: 1, lineWidth: 2, rect, quads: [SigK.freeTextGeometry.quadOfRect(rect)], ...overrides };
}

function polygon(closed, overrides = {}) {
  const rect = [99, 599, 201, 701];
  return { src: 0, kind: 'polygon', closed, color: '#c00000', opacity: 1, lineWidth: 2, rect, quads: [SigK.freeTextGeometry.quadOfRect(rect)],
    paths: [[[100, 600], [200, 600], [150, 700]]], ...overrides };
}

test('塗りの透明度とハッチングは、四角・丸・閉じた多角形だけが持てる', () => {
  assert.equal(style.validStyle(square({ fillOpacity: 0.3, hatch: { ...HATCH } })), true);
  assert.equal(style.validStyle({ ...square(), kind: 'circle', fillOpacity: 0.5 }), true);
  assert.equal(style.validStyle(polygon(true, { hatch: { ...HATCH, pattern: 'grid' } })), true);
  assert.equal(style.validStyle(polygon(false, { hatch: { ...HATCH } })), false);
  assert.equal(style.validStyle(polygon(false, { fillOpacity: 0.5 })), false);
  assert.equal(style.validStyle({ kind: 'line', color: '#c00000', fillOpacity: 0.5 }), false);
  assert.equal(style.validStyle({ kind: 'ink', color: '#c00000', hatch: { ...HATCH } }), false);
});

test('ハッチングの種類は 6 つ（なしは持たない）で、間隔 1〜50pt・線幅 0.25〜10pt・色は #rrggbb', () => {
  assert.deepEqual(fill.HATCH_PATTERNS, ['diagonal', 'reverse', 'cross', 'horizontal', 'vertical', 'grid']);
  for (const pattern of fill.HATCH_PATTERNS)
    assert.equal(fill.validHatch({ ...HATCH, pattern }), true, pattern);
  assert.equal(fill.validHatch({ ...HATCH, pattern: 'none' }), false);
  assert.equal(fill.validHatch({ ...HATCH, gap: 0.5 }), false);
  assert.equal(fill.validHatch({ ...HATCH, gap: 50 }), true);
  assert.equal(fill.validHatch({ ...HATCH, gap: 51 }), false);
  assert.equal(fill.validHatch({ ...HATCH, width: 0.25 }), true);
  assert.equal(fill.validHatch({ ...HATCH, width: 0.2 }), false);
  assert.equal(fill.validHatch({ ...HATCH, width: 11 }), false);
  assert.equal(fill.validHatch({ ...HATCH, color: 'red' }), false);
  assert.equal(style.validStyle(square({ hatch: null })), true);
  assert.equal(style.validStyle(square({ fillOpacity: 0 })), false);
  assert.equal(style.validStyle(square({ fillOpacity: 1.2 })), false);
});

test('fillOpacity が無い書き込みは、opacity と同じ値として扱う（確定事項B2）', () => {
  assert.equal(fill.fillOpacityOf(square({ opacity: 0.4 })), 0.4);
  assert.equal(fill.fillOpacityOf(square({ opacity: 0.4, fillOpacity: 0.8 })), 0.8);
  assert.equal(fill.fillOpacityOf({ kind: 'square' }), 1);
  // 同じ見た目なら同じ書き込みとして比べる。
  assert.equal(style.sameStyle(square({ opacity: 0.4 }), square({ opacity: 0.4, fillOpacity: 0.4 })), true);
  assert.equal(style.sameStyle(square({ fillOpacity: 0.4 }), square()), false);
  assert.equal(style.sameStyle(square({ hatch: { ...HATCH } }), square({ hatch: { ...HATCH, gap: 7 } })), false);
});

test('分けて描くのは、ハッチングがあるか、塗りつぶしと枠線の不透明度が違う時だけ（確定事項B4・B5）', () => {
  assert.equal(fill.paintsApart(square()), false);
  assert.equal(fill.paintsApart(square({ opacity: 0.5, fillOpacity: 0.5 })), false);
  assert.equal(fill.paintsApart(square({ opacity: 0.5 })), false);
  assert.equal(fill.paintsApart(square({ fillOpacity: 0.5 })), true);
  // 塗りつぶしもハッチングも無ければ、内側に描くものが無いので分けない（見た目は同じ）。
  assert.equal(fill.paintsApart(square({ fill: null, opacity: 0.5, fillOpacity: 1 })), false);
  assert.equal(fill.paintsApart(square({ hatch: { ...HATCH } })), true);
  assert.equal(fill.paintsApart({ kind: 'line', color: '#c00000', opacity: 0.5 }), false);
});

test('写し・保存の形は、持っている欄だけを載せる', () => {
  const entry = square({ id: 'a1', text: '', fillOpacity: 0.3, hatch: { ...HATCH } });
  const copy = entries.copyEntry(entry);
  assert.deepEqual(copy.hatch, HATCH);
  assert.notEqual(copy.hatch, entry.hatch);
  assert.equal(copy.fillOpacity, 0.3);
  assert.equal(entries.sameEntry(entry, copy), true);
  const saved = entries.toSaveEntry(entry);
  assert.equal(saved.fillOpacity, 0.3);
  assert.deepEqual(saved.hatch, HATCH);
  const plain = entries.toSaveEntry(square({ id: 'a2' }));
  assert.equal('fillOpacity' in plain, false);
  assert.equal('hatch' in plain, false);
});

test('updateAnnot で塗りの透明度とハッチングを変え、ハッチングなし（null）は欄を消す', () => {
  const base = { added: [square({ id: 'a1' })], removed: [] };
  const hatched = state.updateAnnot(base, base.added[0], { fillOpacity: 0.25, hatch: { ...HATCH } });
  assert.notEqual(hatched, base);
  assert.equal(hatched.added[0].fillOpacity, 0.25);
  assert.deepEqual(hatched.added[0].hatch, HATCH);
  const cleared = state.updateAnnot(hatched, hatched.added[0], { hatch: null });
  assert.equal('hatch' in cleared.added[0], false);
  // 直線には当てられない。
  assert.equal(entries.pickPatch({ hatch: { ...HATCH } }, 'line'), null);
  assert.equal(entries.pickPatch({ fillOpacity: 0.5 }, 'arrow'), null);
  assert.deepEqual(entries.pickPatch({ fillOpacity: 0.5 }, 'polygon'), { fillOpacity: 0.5 });
});

test('枠線の不透明度を変える時は、持っていない塗りつぶしの不透明度を今の値で残す（確定事項B2）', () => {
  assert.deepEqual(fill.keepFillOpacity(square({ opacity: 0.6 })), { fillOpacity: 0.6 });
  assert.deepEqual(fill.keepFillOpacity(square({ fillOpacity: 0.3 })), {});
  assert.deepEqual(fill.keepFillOpacity({ kind: 'line', opacity: 0.6 }), {});
});

test('ハッチングの一部を当てる: 種類なしで消え、なしの時に種類以外を当てても、なしのまま', () => {
  const memo = { pattern: 'grid', color: '#00B050', gap: 8, width: 2 };
  assert.deepEqual(fill.mergeHatch(null, { pattern: 'cross' }, memo), { pattern: 'cross', color: '#00b050', gap: 8, width: 2 });
  assert.equal(fill.mergeHatch(null, { color: '#ffffff' }, memo), null);
  assert.equal(fill.mergeHatch({ ...HATCH }, { pattern: 'none' }, memo), null);
  assert.deepEqual(fill.mergeHatch({ ...HATCH }, { gap: 12 }, memo), { ...HATCH, gap: 12 });
});
