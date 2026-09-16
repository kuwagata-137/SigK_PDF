'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/annotation-state.js');

// 注釈の状態（spec-4-1 確定事項16・17・19）。plan と同じく「ファイルとの差分」で持つ。

const state = globalThis.SigK.annotationState;

const QUAD = [48, 753, 232, 753, 48, 743, 232, 743];

function entry(overrides = {}) {
  return { src: 0, kind: 'highlight', color: '#ffe45a', quads: [QUAD], rect: [48, 743, 232, 753], text: 'abc', ...overrides };
}

function imported(overrides = {}) {
  return { ref: '86R', src: 0, kind: 'underline', color: '#d92c2c', opacity: 1, quads: [QUAD], rect: [48, 743, 232, 753], ...overrides };
}

test('createAnnots は空の差分を作る', () => {
  assert.deepEqual(state.createAnnots(), { added: [], removed: [] });
  assert.equal(state.isEmpty(state.createAnnots()), true);
});

test('addAnnot は id を振り、不透明度の既定を 1 にし、元を変えない', () => {
  const base = state.createAnnots();
  const next = state.addAnnot(base, entry());
  assert.equal(base.added.length, 0);
  assert.equal(next.added.length, 1);
  assert.match(next.added[0].id, /^sigk-[0-9a-z]+-\d+$/);
  assert.equal(next.added[0].opacity, 1);
  assert.equal(next.added[0].text, 'abc');
  assert.equal(state.isEmpty(next), false);
});

test('addAnnot は形の違うものを黙って捨てる', () => {
  const base = state.createAnnots();
  assert.equal(state.addAnnot(base, entry({ kind: 'note' })).added.length, 0);
  assert.equal(state.addAnnot(base, entry({ quads: [] })).added.length, 0);
  assert.equal(state.addAnnot(base, entry({ quads: [[1, 2, 3]] })).added.length, 0);
  assert.equal(state.addAnnot(base, entry({ src: -1 })).added.length, 0);
});

test('newId は呼ぶたびに違う', () => {
  assert.notEqual(state.newId(), state.newId());
});

test('removeAnnot は自前のものを added から外す', () => {
  const one = state.addAnnot(state.createAnnots(), entry());
  const next = state.removeAnnot(one, { id: one.added[0].id });
  assert.equal(next.added.length, 0);
  assert.equal(next.removed.length, 0);
  assert.equal(one.added.length, 1);
});

test('removeAnnot は読み込んだものを removed に足し、二重には足さない', () => {
  const next = state.removeAnnot(state.removeAnnot(state.createAnnots(), imported()), imported());
  assert.deepEqual(next.removed, ['86R']);
});

test('recolorAnnot は自前のものの色を書き換える', () => {
  const one = state.addAnnot(state.createAnnots(), entry());
  const next = state.recolorAnnot(one, { id: one.added[0].id }, '#8ce99a');
  assert.equal(next.added[0].color, '#8ce99a');
  assert.equal(next.added[0].id, one.added[0].id);
  assert.equal(one.added[0].color, '#ffe45a');
});

test('recolorAnnot は読み込んだものを消して写しを足す（確定事項17）', () => {
  const next = state.recolorAnnot(state.createAnnots(), imported(), '#2c5cd9');
  assert.deepEqual(next.removed, ['86R']);
  assert.equal(next.added.length, 1);
  assert.equal(next.added[0].color, '#2c5cd9');
  assert.equal(next.added[0].kind, 'underline');
  assert.equal(next.added[0].ref, undefined);
  assert.match(next.added[0].id, /^sigk-/);
});

test('recolorAnnot は色が文字列でなければ何もしない', () => {
  const one = state.addAnnot(state.createAnnots(), entry());
  assert.equal(state.recolorAnnot(one, { id: one.added[0].id }, null), one);
});

test('sameAnnots は付けて消したら元と同じと見なす', () => {
  const base = state.createAnnots();
  const one = state.addAnnot(base, entry());
  assert.equal(state.sameAnnots(base, one), false);
  assert.equal(state.sameAnnots(base, state.removeAnnot(one, { id: one.added[0].id })), true);
});

test('sameAnnots は色の違いと removed の違いを見る', () => {
  const one = state.addAnnot(state.createAnnots(), entry());
  assert.equal(state.sameAnnots(one, state.cloneAnnots(one)), true);
  assert.equal(state.sameAnnots(one, state.recolorAnnot(one, { id: one.added[0].id }, '#8ce99a')), false);
  assert.equal(state.sameAnnots(one, state.removeAnnot(one, imported())), false);
});

test('cloneAnnots は四角まで別の配列にする', () => {
  const one = state.addAnnot(state.createAnnots(), entry());
  const copy = state.cloneAnnots(one);
  copy.added[0].quads[0][0] = 999;
  assert.equal(one.added[0].quads[0][0], 48);
});

test('annotsOnPage は読み込んだもの（消したものを除く）の後ろに自前のものを並べる', () => {
  const importedByPage = { 0: [imported(), imported({ ref: '90R' })], 1: [imported({ ref: '91R', src: 1 })] };
  let annots = state.addAnnot(state.createAnnots(), entry({ src: 0 }));
  annots = state.addAnnot(annots, entry({ src: 1 }));
  annots = state.removeAnnot(annots, { ref: '90R' });
  const page0 = state.annotsOnPage(annots, importedByPage, 0);
  assert.deepEqual(page0.map((a) => a.ref ?? 'own'), ['86R', 'own']);
  assert.deepEqual(state.annotsOnPage(annots, importedByPage, 1).map((a) => a.ref ?? 'own'), ['91R', 'own']);
  assert.deepEqual(state.annotsOnPage(annots, importedByPage, 5), []);
  assert.deepEqual(state.annotsOnPage(annots, null, 0).map((a) => a.ref ?? 'own'), ['own']);
});

test('findAnnot は id と ref で引き、消した読み込みは引けない', () => {
  const importedByPage = { 0: [imported()] };
  const one = state.addAnnot(state.createAnnots(), entry());
  assert.equal(state.findAnnot(one, importedByPage, one.added[0].id).text, 'abc');
  assert.equal(state.findAnnot(one, importedByPage, '86R').ref, '86R');
  assert.equal(state.findAnnot(state.removeAnnot(one, imported()), importedByPage, '86R'), null);
  assert.equal(state.findAnnot(one, importedByPage, 'nothing'), null);
});

test('toSaveSpec は id と text を落とし、removed をそのまま渡す（確定事項22）', () => {
  let annots = state.addAnnot(state.createAnnots(), entry());
  annots = state.removeAnnot(annots, imported());
  const spec = state.toSaveSpec(annots);
  assert.deepEqual(Object.keys(spec.add[0]).sort(), ['color', 'kind', 'opacity', 'quads', 'rect', 'src']);
  assert.deepEqual(spec.remove, ['86R']);
  spec.add[0].quads[0][0] = 0;
  assert.equal(annots.added[0].quads[0][0], 48);
});

// ---- テキスト注釈（spec-4-2 確定事項15〜18） ----

require('../renderer/free-text-geometry.js');
const { quadOfRect } = globalThis.SigK.freeTextGeometry;

const TEXT_RECT = [100, 700, 200, 720.5];

function textEntry(overrides = {}) {
  return {
    src: 0, kind: 'text', color: '#1c2430', quads: [quadOfRect(TEXT_RECT)], rect: TEXT_RECT,
    text: 'こんにちは', fontSize: 12, rotation: 0, ...overrides,
  };
}

test('KINDS は text を含み、MARKUP_KINDS は 3 種のまま', () => {
  assert.deepEqual(state.KINDS, ['highlight', 'underline', 'strikeout', 'text']);
  assert.deepEqual(state.MARKUP_KINDS, ['highlight', 'underline', 'strikeout']);
  assert.equal(state.isKind('text'), true);
  assert.equal(state.isMarkupKind('text'), false);
  assert.equal(state.isMarkupKind('underline'), true);
});

test('addAnnot はテキストの本文・大きさ・回転を写す', () => {
  const next = state.addAnnot(state.createAnnots(), textEntry());
  assert.equal(next.added.length, 1);
  const added = next.added[0];
  assert.equal(added.text, 'こんにちは');
  assert.equal(added.fontSize, 12);
  assert.equal(added.rotation, 0);
  assert.equal(added.opacity, 1);
  assert.deepEqual(added.quads, [[100, 720.5, 200, 720.5, 100, 700, 200, 700]]);
  // マークアップの写しには fontSize・rotation が付かない
  const markup = state.addAnnot(state.createAnnots(), entry()).added[0];
  assert.equal('fontSize' in markup, false);
  assert.equal('rotation' in markup, false);
});

test('validEntry はテキストの本文・大きさ・回転・四角の数を見る', () => {
  const base = state.createAnnots();
  assert.equal(state.addAnnot(base, textEntry({ text: '' })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ text: '   ' })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ fontSize: 0 })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ fontSize: Infinity })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ rotation: 45 })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ quads: [QUAD, QUAD] })).added.length, 0);
  assert.equal(state.addAnnot(base, textEntry({ rotation: 270 })).added.length, 1);
});

test('updateAnnot は自前のものの渡された欄だけを書き換える', () => {
  const one = state.addAnnot(state.createAnnots(), textEntry());
  const id = one.added[0].id;
  const rect = [110, 700, 210, 720.5];
  const next = state.updateAnnot(one, { id }, { text: 'さようなら', fontSize: 14, rect, quads: [quadOfRect(rect)] });
  assert.equal(next.added[0].id, id);
  assert.equal(next.added[0].text, 'さようなら');
  assert.equal(next.added[0].fontSize, 14);
  assert.deepEqual(next.added[0].rect, rect);
  assert.deepEqual(next.added[0].quads[0], quadOfRect(rect));
  assert.equal(next.added[0].color, '#1c2430');
  assert.equal(next.added[0].rotation, 0);
  // 元は変わらない。知らない欄は無視する
  assert.equal(one.added[0].text, 'こんにちは');
  assert.equal(state.updateAnnot(one, { id }, { rotation: 90, src: 3 }).added[0].rotation, 0);
});

test('updateAnnot は読み込んだものを消して写しを足す', () => {
  const loaded = { ref: '120R', ...textEntry({ opacity: 1 }) };
  const next = state.updateAnnot(state.createAnnots(), loaded, { text: '直した' });
  assert.deepEqual(next.removed, ['120R']);
  assert.equal(next.added.length, 1);
  assert.equal(next.added[0].text, '直した');
  assert.equal(next.added[0].ref, undefined);
  assert.equal(next.added[0].fontSize, 12);
  assert.match(next.added[0].id, /^sigk-/);
});

test('updateAnnot は空のパッチや形の崩れる値なら何もしない', () => {
  const one = state.addAnnot(state.createAnnots(), textEntry());
  const id = one.added[0].id;
  assert.equal(state.updateAnnot(one, { id }, {}), one);
  assert.equal(state.updateAnnot(one, { id }, null), one);
  assert.equal(state.updateAnnot(one, { id }, { text: '' }), one);
  assert.equal(state.updateAnnot(one, { id }, { fontSize: -1 }), one);
  assert.equal(state.updateAnnot(one, { id: 'nothing' }, { text: 'x' }).added[0].text, 'こんにちは');
});

test('recolorAnnot は updateAnnot の色だけの形', () => {
  const one = state.addAnnot(state.createAnnots(), textEntry());
  assert.equal(state.recolorAnnot(one, { id: one.added[0].id }, '#d92c2c').added[0].color, '#d92c2c');
});

test('sameAnnots は本文・大きさ・回転・四角の違いを見る（確定事項17）', () => {
  const one = state.addAnnot(state.createAnnots(), textEntry());
  const id = one.added[0].id;
  assert.equal(state.sameAnnots(one, state.cloneAnnots(one)), true);
  assert.equal(state.sameAnnots(one, state.updateAnnot(one, { id }, { text: 'x' })), false);
  assert.equal(state.sameAnnots(one, state.updateAnnot(one, { id }, { fontSize: 14 })), false);
  const moved = [101, 700, 201, 720.5];
  assert.equal(state.sameAnnots(one, state.updateAnnot(one, { id }, { rect: moved, quads: [quadOfRect(moved)] })), false);
  // 同じ値に更新しても同じ
  assert.equal(state.sameAnnots(one, state.updateAnnot(one, { id }, { text: 'こんにちは' })), true);
});

test('toSaveSpec はテキストを rect・text・fontSize・rotation で渡し、quads は落とす', () => {
  let annots = state.addAnnot(state.createAnnots(), textEntry());
  annots = state.addAnnot(annots, entry());
  const spec = state.toSaveSpec(annots);
  assert.deepEqual(spec.add[0], { src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: TEXT_RECT, text: 'こんにちは', fontSize: 12, rotation: 0 });
  assert.deepEqual(Object.keys(spec.add[1]).sort(), ['color', 'kind', 'opacity', 'quads', 'rect', 'src']);
  spec.add[0].rect[0] = 0;
  assert.equal(annots.added[0].rect[0], 100);
});
