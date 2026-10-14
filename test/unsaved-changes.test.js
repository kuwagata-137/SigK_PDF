'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-plan.js');
// 書き込みが同じかの比べ方は annotation-entry.js の sameEntry（図形の線種などの部品に頼る）。ここでは数え方だけを見るので、欄を全部比べる代わりを置く。
globalThis.SigK.annotationEntry = { sameEntry: (a, b) => JSON.stringify(a) === JSON.stringify(b) };
require('../renderer/unsaved-changes.js');
const { count, describe, messageFor } = globalThis.SigK.unsavedChanges;
const { createPlan } = globalThis.SigK.pagePlan;

// 保存していない変更の数え方と確認の文（spec-2-5 確定事項F1・F4）。

function viewOf({ pages = 4, plan = null, annots = { added: [], removed: [] }, savedAnnots = { added: [], removed: [] }, imported = {} } = {}) {
  return {
    basePages: Array.from({ length: pages }, () => ({ width: 595, height: 842 })),
    plan: plan ?? createPlan(pages),
    savedPlan: createPlan(pages),
    annots,
    savedAnnots,
    imported,
  };
}

const ZERO = { reorder: 0, remove: 0, rotate: 0, insert: 0, crop: 0, mosaic: 0, annot: 0 };

test('変更が無ければ全部 0', () => {
  assert.deepEqual(count(viewOf()), ZERO);
  assert.equal(count(null), null);
});

test('削除・差し込み・回転・切り取り・モザイクを数える', () => {
  const plan = [
    { src: 0, rotate: 90 },
    { insert: 0, rotate: 0 },
    { insert: 1, rotate: 0 },
    { src: 2, rotate: 0, crop: [0, 0, 100, 100] },
    { src: 3, rotate: 0, mosaic: [{ box: [0, 0, 10, 10], block: 8 }, { box: [20, 20, 30, 30], block: 8 }] },
  ];
  assert.deepEqual(count(viewOf({ plan })), { ...ZERO, remove: 1, rotate: 1, insert: 2, crop: 1, mosaic: 2 });
});

test('並べ替えは、動いたページの数（両方にあるページの数 − 最長増加部分列）', () => {
  const order = (srcs) => srcs.map((src) => ({ src, rotate: 0 }));
  assert.equal(count(viewOf({ plan: order([1, 0, 2, 3]) })).reorder, 1, '2 枚を入れ替えた');
  assert.equal(count(viewOf({ plan: order([3, 0, 1, 2]) })).reorder, 1, '末尾を先頭へ');
  assert.equal(count(viewOf({ plan: order([3, 2, 1, 0]) })).reorder, 3, '逆順');
  assert.equal(count(viewOf({ plan: order([0, 2, 3]) })).reorder, 0, '削除だけなら並べ替えに数えない');
});

test('書き込みは、ページごとに足した数と消した数の多い方を足す', () => {
  const entry = (id, src, x = 10) => ({ id, src, kind: 'shape', shape: 'square', rect: [x, 10, x + 50, 60], color: '#ff0000', opacity: 1, width: 2 });
  const imported = { 0: [{ ref: '10R', kind: 'highlight' }], 1: [{ ref: '11R', kind: 'note' }, { ref: '12R', kind: 'note' }] };
  const annots = {
    added: [entry('a', 0), entry('b', 0), entry('c', 1)],
    removed: ['10R', '11R', '12R'],
  };
  // 0 ページ: 足した 2・消した 1 → 2。1 ページ: 足した 1・消した 2 → 2。
  assert.equal(count(viewOf({ annots, imported })).annot, 4);

  // 保存したあとのものは数えない。直したものは数える。
  const savedAnnots = { added: [entry('a', 0), entry('b', 0)], removed: ['10R'] };
  const moved = { added: [entry('a', 0), entry('b', 0, 200)], removed: ['10R'] };
  assert.equal(count(viewOf({ annots: moved, savedAnnots, imported })).annot, 1);
});

test('describe は決まった順に「N 件」でつなぎ、どれも 0 なら「保存していない変更」', () => {
  assert.equal(describe({ ...ZERO, annot: 3, remove: 1, reorder: 2 }), 'ページの並べ替え 2 件・ページの削除 1 件・書き込み 3 件');
  assert.equal(describe(ZERO), '保存していない変更');
  assert.equal(describe(null), '保存していない変更');
});

test('messageFor は 1 本なら F1 の文、2 本以上なら 5 個まで並べて「ほか N 個」', () => {
  const one = messageFor([{ name: '会議資料.pdf', counts: { ...ZERO, remove: 1, annot: 3 } }]);
  assert.equal(one.lead, '「会議資料.pdf」には、保存していない変更（ページの削除 1 件・書き込み 3 件）があります。ツールはファイルに保存してある中身を使うので、このまま実行すると、その変更は結果に入りません。');
  assert.deepEqual(one.items, []);
  assert.equal(messageFor([{ name: 'a.pdf', counts: ZERO }]).lead.startsWith('「a.pdf」には、保存していない変更があります。'), true);

  const many = messageFor(Array.from({ length: 7 }, (_unused, index) => ({ name: `${index + 1}.pdf`, counts: index === 0 ? { ...ZERO, rotate: 2 } : ZERO })));
  assert.equal(many.lead, '次の 7 個のファイルには、保存していない変更があります。ツールはファイルに保存してある中身を使うので、このまま実行すると、その変更は結果に入りません。');
  assert.deepEqual(many.items, ['「1.pdf」（ページの回転 2 件）', '「2.pdf」', '「3.pdf」', '「4.pdf」', '「5.pdf」']);
  assert.equal(many.more, 2);
});
