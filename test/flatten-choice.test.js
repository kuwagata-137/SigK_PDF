'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-range.js');
require('../renderer/flatten-choice.js');
const { GROUPS, KEYS, pagesOf, tally, createChoices } = globalThis.SigK.flattenChoice;

// フラット化で焼き込む書き込みの選び方（spec-2-5 確定事項E5。決定80 ㉞）。ワーカーのページごとの数を、チェックした種類と
// 選んだページの分だけ足し合わせる。

const KEEP0 = { functional: 0, noAppearance: 0, hidden: 0 };
const page = (bake, keep = {}) => ({ bake: { markup: 0, text: 0, shape: 0, note: 0, other: 0, ...bake }, keep: { ...KEEP0, ...keep } });
const RESULT = { pages: [page({ markup: 2, note: 1 }, { functional: 1 }), page({ shape: 3, note: 1 }, { hidden: 2 }), page({})] };

test('まとまりはワーカーと同じ 5 つで、吹き出しはテキストのまとまりに入る', () => {
  assert.deepEqual([...KEYS], ['markup', 'text', 'shape', 'note', 'other']);
  assert.equal(GROUPS[1].label, 'テキスト・吹き出し');
});

test('pagesOf は［すべて］なら null、範囲なら 0 始まりのページ、誤りは error。空の範囲は全部', () => {
  assert.deepEqual(pagesOf({ mode: 'all', range: '9' }, 3), { pages: null });
  assert.deepEqual(pagesOf({ mode: 'range', range: '2-3' }, 3), { pages: [1, 2] });
  assert.match(pagesOf({ mode: 'range', range: '9' }, 3).error, /3ページまで/);
  assert.deepEqual(pagesOf({ mode: 'range', range: '' }, 3), { pages: [0, 1, 2] });
});

test('tally はチェックした種類と選んだページの分を足し、ファイルにある種類と選ばなかった件数も返す', () => {
  const all = tally(RESULT, { kinds: new Set(KEYS), pages: null });
  assert.deepEqual([...all.present], ['markup', 'shape', 'note']);
  assert.equal(all.baked, 7);
  assert.equal(all.notes, 2);
  assert.deepEqual(all.keep, { functional: 1, noAppearance: 0, hidden: 2 });
  assert.equal(all.unchosen, 0);

  const some = tally(RESULT, { kinds: new Set(['shape', 'note']), pages: [1] });
  assert.deepEqual(some.counts, { markup: 0, text: 0, shape: 3, note: 1, other: 0 });
  assert.equal(some.baked, 4);
  assert.equal(some.notes, 1);
  assert.deepEqual(some.keep, { functional: 0, noAppearance: 0, hidden: 2 }, '残すものも選んだページの分');
  assert.equal(some.unchosen, 3);
  assert.equal(tally(RESULT, { kinds: new Set(['markup']), pages: null }).notes, 0, 'ノートを焼かなければノートの注意は 0');
});

test('ページごとの数が無い古い結果は、1 ページとして足す', () => {
  const old = { bake: { markup: 1, text: 0, shape: 0, note: 0, other: 0 }, keep: KEEP0 };
  assert.equal(tally(old, { kinds: new Set(KEYS), pages: null }).baked, 1);
});

test('createChoices は既定で全部チェック・［すべて］。知らない種類と形は受けず、reset で戻る', () => {
  const picks = createChoices();
  assert.deepEqual(picks.current(), { kinds: [...KEYS], mode: 'all', range: '' });
  assert.equal(picks.setKind('note', false), true);
  assert.equal(picks.setKind('xyz', false), false);
  assert.equal(picks.setPageMode('range'), true);
  assert.equal(picks.setPageMode('some'), false);
  picks.setRange('1-2');
  assert.deepEqual(picks.current(), { kinds: ['markup', 'text', 'shape', 'other'], mode: 'range', range: '1-2' });
  picks.reset();
  assert.deepEqual(picks.current(), { kinds: [...KEYS], mode: 'all', range: '' });
});
