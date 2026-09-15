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
