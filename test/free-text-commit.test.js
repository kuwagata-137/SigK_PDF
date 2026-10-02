'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, clickAt, typeText } = require('./text-helpers.js');

// 入力欄の下書きをテキストの書き込みにする（spec-4b-4a。annotate-text.js から移した確定）。

test('空の下書きは作らず、打った下書きは 1 件の書き込みになって選ばれる', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('text');
  clickAt(shell, 100, 700);
  typeText(shell, '   ');
  SigK.freeTextEditor.finish();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  clickAt(shell, 100, 700);
  typeText(shell, 'メモ\n');
  SigK.freeTextEditor.finish();
  const added = SigK.viewer.getAnnotations().added;
  assert.equal(added.length, 1);
  // 末尾の改行と空白は落とす。
  assert.equal(added[0].text, 'メモ');
  assert.equal(SigK.annotate.getSelected(), added[0].id);
});

test('文書を閉じたあとの下書きは何もしない', async (t) => {
  const shell = await withTextShell(t);
  assert.equal(shell.SigK.freeTextCommit.commitDraft({ entry: null, text: 'x', origin: [100, 700], fontSize: 12, color: '#222a35', rotation: 0, src: 0, index: 0 }), true);
  await shell.SigK.tabs.forceCloseTab(shell.SigK.tabs.list()[0].id);
  assert.equal(shell.SigK.freeTextCommit.commitDraft({ entry: null, text: 'x', origin: [100, 700], fontSize: 12, color: '#222a35', rotation: 0, src: 0, index: 0 }), false);
});
