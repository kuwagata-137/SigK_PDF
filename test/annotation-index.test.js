'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-presets.js');
require('../renderer/annotation-entry.js');
require('../renderer/annotation-state.js');
require('../renderer/annotation-index.js');

// 注釈一覧の行を組む純粋層（spec-4-4 確定事項28）。

const index = globalThis.SigK.annotationIndex;
const state = globalThis.SigK.annotationState;

function quadOfRect([x1, y1, x2, y2]) {
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

function own(overrides = {}) {
  const rect = overrides.rect ?? [100, 680, 120, 700];
  return { id: 'sigk-1', src: 0, kind: 'note', color: '#ffe45a', opacity: 1, rect, quads: [quadOfRect(rect)], text: 'メモ', author: '総務', ...overrides };
}

const IMPORTED = {
  0: [
    { ref: '12R', src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, rect: [48, 743, 232, 753], quads: [quadOfRect([48, 743, 232, 753])] },
    { ref: '17R', src: 0, kind: 'other', subtype: 'Line', color: '#ff0000', opacity: 1, rect: [298, 698, 502, 762], quads: [quadOfRect([298, 698, 502, 762])], text: 'other line', author: '', readonly: true },
  ],
  2: [
    { ref: '30R', src: 2, kind: 'square', color: '#2c5cd9', opacity: 1, lineWidth: 2, rect: [100, 100, 200, 200], quads: [quadOfRect([100, 100, 200, 200])] },
  ],
};

const PLAN = [{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }, { src: 2, rotate: 0 }];

test('rowsOf はいまの並びの順にページを回し、紙の上から下・左から右に並べる', () => {
  let annots = state.addAnnot(state.createAnnots(), own({ id: 'a', rect: [100, 680, 120, 700] }));
  annots = state.addAnnot(annots, own({ id: 'b', src: 2, rect: [300, 500, 320, 520], text: '' }));
  annots = state.addAnnot(annots, own({ id: 'c', rect: [300, 680, 320, 700], text: '右' }));
  annots = state.addAnnot(annots, own({ id: 'd', src: 1, kind: 'ink', color: '#2f9e5a', lineWidth: 2, rect: [50, 50, 150, 100], quads: [quadOfRect([50, 50, 150, 100])], paths: [[[50, 50], [150, 100]]], text: '' }));
  const rows = index.rowsOf(annots, IMPORTED, PLAN);
  // 1 ページ目: 直線（y2 762）→ ハイライト（753）→ ノート a と c（700。左から右）
  assert.deepEqual(rows.map((row) => [row.key, row.page]), [
    ['17R', 1], ['12R', 1], ['a', 1], ['c', 1],
    ['d', 2],
    ['b', 3], ['30R', 3],
  ]);
  const first = rows[2];
  assert.deepEqual(first, { key: 'a', kind: 'note', subtype: undefined, readonly: false, page: 1, src: 0, title: 'メモ', label: 'ノート', icon: 'note', color: '#ffe45a' });
  assert.equal(rows[0].readonly, true);
  assert.equal(rows[0].label, '直線');
  assert.equal(rows[0].icon, 'shapeLine');
  assert.equal(rows[0].title, 'other line');
  assert.equal(rows[1].label, 'ハイライト');
  assert.equal(rows[1].title, '');
  assert.equal(rows[4].icon, 'pen');
  assert.equal(rows[4].label, 'ペン');
  assert.equal(rows[5].title, '');
});

test('rowsOf はページを並べ替えると表示の位置に追従し、消した読み込みは出さない', () => {
  const annots = state.removeAnnot(state.addAnnot(state.createAnnots(), own()), { ref: '12R' });
  const rows = index.rowsOf(annots, IMPORTED, [{ src: 2, rotate: 0 }, { src: 0, rotate: 90 }]);
  assert.deepEqual(rows.map((row) => [row.key, row.page]), [['30R', 1], ['17R', 2], ['sigk-1', 2]]);
  assert.deepEqual(index.rowsOf(null, {}, []), []);
  assert.deepEqual(index.rowsOf(state.createAnnots(), null, PLAN), []);
});

test('titleOf は本文の先頭行を空白を詰めて返し、無ければ空', () => {
  assert.equal(index.titleOf({ text: '  検収の期間 \n2 行目' }), '検収の期間');
  assert.equal(index.titleOf({ text: '\n\n二行目から' }), '二行目から');
  assert.equal(index.titleOf({ text: '' }), '');
  assert.equal(index.titleOf({}), '');
  assert.equal(index.titleOf({ text: 'a'.repeat(300) }).length, index.TITLE_MAX + 1);
});

test('labelOf と iconOf は種類ごとの名前とアイコン', () => {
  assert.equal(index.labelOf({ kind: 'highlight' }), 'ハイライト');
  assert.equal(index.labelOf({ kind: 'arrow' }), '矢印');
  assert.equal(index.labelOf({ kind: 'other', subtype: 'Stamp', readonly: true }), 'スタンプ');
  assert.equal(index.labelOf({ kind: 'other', subtype: 'Foo', readonly: true }), 'Foo');
  assert.equal(index.iconOf({ kind: 'highlight' }), 'highlight');
  assert.equal(index.iconOf({ kind: 'square' }), 'shapeSquare');
  assert.equal(index.iconOf({ kind: 'circle' }), 'shapeCircle');
  assert.equal(index.iconOf({ kind: 'arrow' }), 'shapeArrow');
  assert.equal(index.iconOf({ kind: 'text' }), 'text');
  assert.equal(index.iconOf({ kind: 'other', subtype: 'FreeText' }), 'text');
  assert.equal(index.iconOf({ kind: 'other', subtype: 'Polygon' }), 'shapeSquare');
  assert.equal(index.iconOf({ kind: 'other', subtype: 'Stamp' }), 'modeAnnot');
  assert.equal(index.iconOf({ kind: 'other', subtype: 'Ink' }), 'pen');
});
