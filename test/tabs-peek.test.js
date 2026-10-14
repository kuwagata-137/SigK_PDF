'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ツールモードの帯が使うタブの口（spec-2-5 確定事項D1〜D4・D8）。帯はタブを描くだけで、中身はタブから覗き、
// 並び替えはタブの並びを替える。帯への合図はタブを描き直す tabs.render() と、読み込んだ書き込みを届けるところから出す。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';

async function withTabs(t, paths = [A, B, C]) {
  const files = Object.fromEntries(paths.map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

const ids = (SigK) => SigK.tabs.list().map((tab) => tab.id);
const tabNames = (document) => [...document.querySelectorAll('#tabbar .tab .name')].map((node) => node.textContent);

test('peek は映しているタブも映していないタブも、同じ形で中身を返す（参照のまま）', async (t) => {
  const { SigK } = await withTabs(t);
  const [a, , c] = ids(SigK);
  assert.equal(SigK.tabs.activeId(), c);

  const active = SigK.tabs.peek(c);
  assert.equal(active.error, null);
  assert.equal(active.file.name, 'c.pdf');
  assert.equal(active.doc, SigK.viewer.peek().doc, '映しているタブは viewer の中身');
  assert.equal(active.plan.length, active.basePages.length);

  const hidden = SigK.tabs.peek(a);
  assert.equal(hidden.error, null);
  assert.equal(hidden.file.name, 'a.pdf');
  assert.notEqual(hidden.doc, active.doc);
  for (const key of ['savedPlan', 'annots', 'savedAnnots', 'imported', 'inserts', 'sizes'])
    assert.ok(key in hidden, key);

  SigK.tabs.activate(a);
  assert.equal(SigK.tabs.peek(a).doc, hidden.doc, '切り替えても同じ文書');
  assert.equal(SigK.tabs.peek(999), null, '無い id');
});

test('開けなかったタブの peek は理由を返す', async (t) => {
  const { SigK } = await withTabs(t, [A]);
  SigK.pdfjs.getDocument = () => ({ promise: Promise.reject(Object.assign(new Error('broken'), { name: 'InvalidPDFException' })) });
  await SigK.tabs.openSource(makeSource({ path: B }));
  const failed = ids(SigK)[1];
  const peeked = SigK.tabs.peek(failed);
  assert.match(peeked.error, /壊れている/);
  assert.equal(peeked.doc, undefined);
});

test('reorder はタブの並びを替え、映しているタブは変えない。並べ替えでなければ何もしない', async (t) => {
  const { SigK, document } = await withTabs(t);
  const [a, b, c] = ids(SigK);
  SigK.tabs.activate(b);

  assert.equal(SigK.tabs.reorder([c, a, b]), true);
  assert.deepEqual(ids(SigK), [c, a, b]);
  assert.deepEqual(tabNames(document), ['c.pdf', 'a.pdf', 'b.pdf']);
  assert.equal(SigK.tabs.activeId(), b);
  assert.equal(SigK.viewer.getState().file.name, 'b.pdf');

  for (const wrong of [[c, a], [c, a, a], [c, a, 999], [c, a, b], 'x', null])
    assert.equal(SigK.tabs.reorder(wrong), false, JSON.stringify(wrong));
  assert.deepEqual(ids(SigK), [c, a, b]);

  // 並べ替えたあとも、Ctrl+Tab の順と閉じたときの隣は新しい並びで決まる。
  SigK.tabs.cycle(1);
  assert.equal(SigK.tabs.activeId(), c, '末尾の次は先頭');
});

test('isOpening は文書を読み込んでいる間だけ真', async (t) => {
  const { SigK } = await withTabs(t, [A]);
  assert.equal(SigK.tabs.isOpening(), false);
  const pending = SigK.tabs.openSource(makeSource({ path: B }));
  assert.equal(SigK.tabs.isOpening(), true);
  assert.equal(SigK.tabs.activeId(), null, '前のタブを退かせて待っている');
  await pending;
  assert.equal(SigK.tabs.isOpening(), false);

  // 読み込みに失敗しても下ろす。
  SigK.pdfjs.getDocument = () => ({ promise: Promise.reject(new Error('broken')) });
  await SigK.tabs.openSource(makeSource({ path: C }));
  assert.equal(SigK.tabs.isOpening(), false);
});

test('タブを描き直すたび・閉じる前・読み込んだ書き込みを届けたときに、帯へ合図する', async (t) => {
  const { SigK, window } = await withTabs(t);
  const calls = [];
  window.SigK.strips = {
    sync: () => calls.push('sync'),
    forget: (id) => calls.push(`forget:${id}:${SigK.tabs.peek(id)?.doc !== undefined}`),
  };
  const [a, b] = ids(SigK);

  SigK.tabs.activate(a);
  assert.ok(calls.includes('sync'), '切り替えで描き直す');

  calls.length = 0;
  SigK.tabs.forceCloseTab(b);
  assert.equal(calls[0], `forget:${b}:true`, '文書を畳む前に手放す');
  assert.ok(calls.includes('sync'));

  calls.length = 0;
  const hidden = ids(SigK)[1];
  SigK.viewer.deliverImported(SigK.tabs.peek(hidden).doc, {});
  assert.deepEqual(calls, ['sync'], '映していないタブへ届けた');

  calls.length = 0;
  SigK.viewer.deliverImported(SigK.viewer.peek().doc, {});
  assert.ok(calls.includes('sync'), '映しているタブへ届けた');
});
