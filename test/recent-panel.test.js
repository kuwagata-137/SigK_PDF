'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

const RECENT = [
  { path: A, name: 'a.pdf', openedAt: '2026-08-31T02:00:00.000Z' },
  { path: B, name: 'b.pdf', openedAt: '2026-08-30T02:00:00.000Z' },
];

async function withShell(t, options = {}) {
  const shell = await createShell({
    recent: RECENT,
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

function items(document) {
  return [...document.querySelectorAll('#view-recent .recent-item')];
}

test('文書が無いときは最近使ったファイルが並ぶ', async (t) => {
  const { document } = await withShell(t);

  assert.equal(document.getElementById('view-recent').hidden, false);
  assert.deepEqual(
    items(document).map((el) => el.querySelector('.recent-name').textContent),
    ['a.pdf', 'b.pdf'],
  );
  // 場所も出す。同じ名前のファイルを見分けられるようにするため。
  assert.equal(items(document)[0].querySelector('.recent-path').textContent, A);
});

test('履歴が空なら一覧そのものを出さない', async (t) => {
  const { document } = await withShell(t, { recent: [] });

  assert.equal(document.getElementById('view-recent').hidden, true);
  assert.equal(items(document).length, 0);
});

test('クリックするとその文書を開く', async (t) => {
  const shell = await withShell(t);

  items(shell.document)[1].dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.name, 'b.pdf');
});

test('文書を開いている間は一覧を隠す', async (t) => {
  const shell = await withShell(t);

  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  assert.equal(shell.document.getElementById('view-recent').hidden, true);

  // 全部閉じたら、また出す。
  shell.SigK.tabs.closeTab(shell.SigK.tabs.list()[0].id);
  await shell.flush();
  assert.equal(shell.document.getElementById('view-recent').hidden, false);
});

test('開いたファイルが一覧の先頭へ来る', async (t) => {
  const shell = await withShell(t);

  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  shell.SigK.tabs.closeTab(shell.SigK.tabs.list()[0].id);
  await shell.flush();

  assert.deepEqual(
    items(shell.document).map((el) => el.querySelector('.recent-name').textContent),
    ['b.pdf', 'a.pdf'],
  );
});

test('開けなかったファイルは一覧から消える', async (t) => {
  const shell = await withShell(t, {
    recent: [...RECENT, { path: 'C:\\work\\消えた.pdf', name: '消えた.pdf', openedAt: null }],
    files: { [A]: makeSource({ path: A }) },
  });
  assert.equal(items(shell.document).length, 3);

  await shell.SigK.tabs.openPath('C:\\work\\消えた.pdf');
  await shell.flush();

  assert.deepEqual(
    items(shell.document).map((el) => el.querySelector('.recent-name').textContent),
    ['a.pdf', 'b.pdf'],
  );
});

test('履歴の API が無くても画面は立ち上がる', async (t) => {
  const shell = await createShell({ withApis: false });
  t.after(() => shell.cleanup());
  await shell.flush();

  assert.equal(shell.document.getElementById('view-recent').hidden, true);
  assert.deepEqual([...shell.SigK.recentPanel.entries()], []);
});
