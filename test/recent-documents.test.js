'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RECENT,
  pathKey,
  normalizeEntry,
  normalizeList,
  addRecent,
  removeRecent,
} = require('../recent-documents.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

test('pathKey は Windows の流儀で揃える', () => {
  assert.equal(pathKey('C:/Work/A.PDF'), 'c:\\work\\a.pdf');
  assert.equal(pathKey('C:\\Work\\A.PDF'), 'c:\\work\\a.pdf');
});

test('normalizeEntry は名前が欠けていればパスから作る', () => {
  assert.deepEqual(normalizeEntry({ path: A }), { path: A, name: 'a.pdf', openedAt: null });
  assert.deepEqual(
    normalizeEntry({ path: A, name: '別名.pdf', openedAt: '2026-08-31T03:00:00.000Z' }),
    { path: A, name: '別名.pdf', openedAt: '2026-08-31T03:00:00.000Z' },
  );
});

test('normalizeEntry はパスが無いものを捨てる', () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry(42), null);
  assert.equal(normalizeEntry({}), null);
  assert.equal(normalizeEntry({ path: '' }), null);
  assert.equal(normalizeEntry({ path: 7 }), null);
});

test('normalizeList は壊れた入力でも必ず配列を返す', () => {
  assert.deepEqual(normalizeList(undefined), []);
  assert.deepEqual(normalizeList('nope'), []);
  assert.deepEqual(normalizeList({ 0: { path: A } }), []);
  assert.deepEqual(normalizeList([null, 3, { path: '' }, { path: A }]).map((e) => e.path), [A]);
});

test('normalizeList は大文字小文字と区切りの違いを同じものとして畳む', () => {
  const list = normalizeList([{ path: A }, { path: 'C:/WORK/A.PDF' }, { path: B }]);
  assert.deepEqual(list.map((e) => e.path), [A, B]);
});

test('normalizeList は 10 件で打ち切る', () => {
  const many = Array.from({ length: 15 }, (_unused, i) => ({ path: `C:\\work\\${i}.pdf` }));
  const list = normalizeList(many);
  assert.equal(list.length, MAX_RECENT);
  // 先頭から数えて 10 件。あふれた古いほうを捨てる。
  assert.equal(list.at(-1).path, 'C:\\work\\9.pdf');
});

test('addRecent は新しいものを先頭へ置く', () => {
  const list = addRecent(addRecent([], { path: A }), { path: B });
  assert.deepEqual(list.map((e) => e.path), [B, A]);
});

test('addRecent は同じファイルを2件にしない', () => {
  let list = addRecent([], { path: A, name: 'a.pdf' });
  list = addRecent(list, { path: B });
  list = addRecent(list, { path: 'c:/work/a.pdf', name: 'a.pdf' });

  assert.equal(list.length, 2);
  // 開き直したものが先頭に来る。
  assert.equal(list[0].path, 'c:/work/a.pdf');
  assert.equal(list[1].path, B);
});

test('addRecent は 11 件目で最も古いものを押し出す', () => {
  let list = [];
  for (let i = 0; i < 12; i += 1)
    list = addRecent(list, { path: `C:\\work\\${i}.pdf` });

  assert.equal(list.length, MAX_RECENT);
  assert.equal(list[0].path, 'C:\\work\\11.pdf');
  assert.equal(list.at(-1).path, 'C:\\work\\2.pdf');
});

test('addRecent は使えない入力を無視して元のリストを返す', () => {
  const list = addRecent([{ path: A }], { path: '' });
  assert.deepEqual(list.map((e) => e.path), [A]);
});

test('removeRecent はパスの表記が違っても消せる', () => {
  const list = removeRecent([{ path: A }, { path: B }], 'C:/WORK/A.PDF');
  assert.deepEqual(list.map((e) => e.path), [B]);
});

test('removeRecent は無い項目を指定しても壊れない', () => {
  assert.deepEqual(removeRecent([{ path: A }], B).map((e) => e.path), [A]);
  assert.deepEqual(removeRecent([{ path: A }], null).map((e) => e.path), [A]);
});
