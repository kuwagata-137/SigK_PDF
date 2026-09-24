'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FLAGS, GROUPS, decide, emptyCensus, count, summarize } = require('../worker/flatten-selection.js');

const visible = { flags: 4, hasAppearance: true, hasRect: true };

test('焼く種類はまとまりごとに分かれる', () => {
  const expected = {
    Highlight: 'markup', Underline: 'markup', StrikeOut: 'markup', Squiggly: 'markup',
    FreeText: 'text',
    Square: 'shape', Circle: 'shape', Line: 'shape', Polygon: 'shape', PolyLine: 'shape', Ink: 'shape',
    Text: 'note',
    Stamp: 'other', Caret: 'other', Watermark: 'other',
  };
  assert.deepEqual({ ...GROUPS }, expected);
  for (const [subtype, group] of Object.entries(expected))
    assert.deepEqual(decide({ subtype, ...visible }), { action: 'bake', group }, subtype);
});

test('働きを持つ注釈と知らない種類は焼かずに残す（墨消しの指定も）', () => {
  for (const subtype of ['Link', 'Widget', 'FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D', 'Redact', 'PrinterMark', 'TrapNet', 'Unknown', '', 'toString'])
    assert.deepEqual(decide({ subtype, ...visible }), { action: 'keep', reason: 'functional' }, subtype);
});

test('Popup は親に従う（ここでは数えない）', () => {
  assert.deepEqual(decide({ subtype: 'Popup', ...visible }), { action: 'popup' });
});

test('非表示・画面に出さない・Invisible の注釈は注釈のまま残す（pdf.js の表示の判定と同じ）', () => {
  assert.deepEqual(FLAGS, { INVISIBLE: 1, HIDDEN: 2, PRINT: 4, NO_ZOOM: 8, NO_ROTATE: 16, NO_VIEW: 32 });
  for (const flags of [1, 2, 32, 2 | 4, 32 | 4, 1 | 28])
    assert.deepEqual(decide({ subtype: 'Square', flags, hasAppearance: true, hasRect: true }), { action: 'keep', reason: 'hidden', group: 'shape' }, String(flags));
});

test('印刷の指定が無くても、見えていれば焼く', () => {
  assert.deepEqual(decide({ subtype: 'Stamp', flags: 0, hasAppearance: true, hasRect: true }), { action: 'bake', group: 'other' });
});

test('外観の無いノートは付箋を描き起こし、ほかの外観の無い注釈は残す', () => {
  assert.deepEqual(decide({ subtype: 'Text', flags: 28, hasAppearance: false, hasRect: true }), { action: 'draw-note', group: 'note' });
  assert.deepEqual(decide({ subtype: 'Line', flags: 0, hasAppearance: false, hasRect: true }), { action: 'keep', reason: 'noAppearance', group: 'shape' });
  assert.deepEqual(decide({ subtype: 'FreeText', flags: 0, hasAppearance: false, hasRect: true }), { action: 'keep', reason: 'noAppearance', group: 'text' });
  // /Rect が読めなければノートも描けない。
  assert.deepEqual(decide({ subtype: 'Text', flags: 28, hasAppearance: false, hasRect: false }), { action: 'keep', reason: 'noAppearance', group: 'note' });
  assert.deepEqual(decide({ subtype: 'Square', flags: 4, hasAppearance: true, hasRect: false }), { action: 'keep', reason: 'noAppearance', group: 'shape' });
});

test('count と summarize は、焼くもの・残すもの・焼くノートの数をまとめる', () => {
  const census = emptyCensus();
  const decisions = [
    { action: 'bake', group: 'markup' }, { action: 'bake', group: 'markup' }, { action: 'bake', group: 'note' },
    { action: 'draw-note', group: 'note' }, { action: 'bake', group: 'other' },
    { action: 'keep', reason: 'functional' }, { action: 'keep', reason: 'noAppearance', group: 'shape' },
    { action: 'keep', reason: 'hidden', group: 'shape' }, { action: 'popup' }, { action: 'skip' },
  ];
  decisions.forEach((decision) => count(census, decision));
  assert.deepEqual(summarize(census), {
    baked: 5,
    kept: 3,
    notes: 2,
    bake: { markup: 2, text: 0, shape: 0, note: 2, other: 1 },
    keep: { functional: 1, noAppearance: 1, hidden: 1 },
  });
});
