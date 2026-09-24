'use strict';

// 書き出す先の検査（docs/07 決定42・renderer/output-target.js）。
//
// 各ツールの画面テストは「断ったら何も書かない」を見る。ここは、何を断り何を通すかの規則を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const NEW = 'C:\\work\\new.pdf';

// a.pdf と b.pdf をこの順に開く。映しているのは後から開いた b.pdf。
async function withTabs(t, paths = [A, B]) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

test('1 本の出力先: タブで開いているファイルだけを断る。大文字小文字と区切りの向きは区別しない', async (t) => {
  const { SigK } = await withTabs(t);
  const { refusalFor, OPEN_IN_TAB } = SigK.outputTarget;

  assert.equal(refusalFor(NEW), null);
  assert.equal(refusalFor(A), OPEN_IN_TAB, '映していないタブ');
  assert.equal(refusalFor(B), OPEN_IN_TAB, '映しているタブ');
  assert.equal(refusalFor('c:/work/A.PDF'), OPEN_IN_TAB);
  // 透かし・フラット化（spec-4-5 確定事項42）と同じ文言にしてある。
  assert.equal(OPEN_IN_TAB, '出力先のファイルはタブで開いています。タブを閉じるか、別の名前を選んでください。');
});

test('1 本の出力先: source を渡すと元のファイルそのものも断り、そちらの文言を先に返す', async (t) => {
  const { SigK } = await withTabs(t);
  const { refusalFor, SAME_AS_SOURCE, OPEN_IN_TAB } = SigK.outputTarget;

  assert.equal(refusalFor('C:/work/B.PDF', { source: B }), SAME_AS_SOURCE);
  assert.equal(refusalFor(A, { source: B }), OPEN_IN_TAB);
  assert.equal(refusalFor(NEW, { source: B }), null);
  // 分割・PDF→画像と同じ文言。
  assert.equal(SAME_AS_SOURCE, '出力先に元のファイルと同じファイルは選べません。');
});

test('フォルダーへの出力: 開いている最初の 1 本を名指しして断る', async (t) => {
  const { SigK } = await withTabs(t);
  const { refusalForFolder } = SigK.outputTarget;

  assert.equal(refusalForFolder([NEW, 'C:\\work\\new2.pdf']), null);
  assert.equal(refusalForFolder([]), null);
  assert.equal(refusalForFolder([NEW, B, A]), '出力先の「b.pdf」はタブで開いています。タブを閉じるか、フォルダを変えてください。');
});

test('名前を付けて保存: 別のタブで開いているファイルは断り、映しているファイル自身と開いていないファイルは通す', async (t) => {
  const { SigK } = await withTabs(t);
  const { refusalForSaveAs, SAVE_AS_OPEN_IN_TAB } = SigK.outputTarget;

  assert.equal(refusalForSaveAs(A), SAVE_AS_OPEN_IN_TAB);
  assert.equal(refusalForSaveAs('c:/work/b.pdf'), null, '自分自身への保存');
  assert.equal(refusalForSaveAs(NEW), null);
  assert.equal(SAVE_AS_OPEN_IN_TAB, '保存先のファイルは別のタブで開いています。そのタブを閉じるか、別の名前を選んでください。');
});

test('タブが 1 枚も無ければ何も断らない', async (t) => {
  const { SigK } = await withTabs(t, []);
  assert.equal(SigK.outputTarget.refusalFor(A), null);
  assert.equal(SigK.outputTarget.refusalForFolder([A, B]), null);
  assert.equal(SigK.outputTarget.refusalForSaveAs(A), null);
});
