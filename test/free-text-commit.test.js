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

// 回したテキスト（spec-4b-4b 確定事項B2・D2）。文字を足して箱が大きくなっても、回した箱の左上の角は紙の上で動かない。
test('回したテキストを直して確定すると、回した箱の左上の角を保つ', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('text');
  clickAt(shell, 100, 700);
  typeText(shell, 'メモ');
  SigK.freeTextEditor.finish();
  const placed = SigK.viewer.getAnnotations().added[0];
  SigK.annotateTransform.commit(placed, SigK.freeTextTurn.anglePatch(placed, 30));
  const turned = SigK.viewer.getAnnotations().added[0];
  assert.equal(turned.angle, 30);
  const before = SigK.freeTextTurn.cornerOf(turned);
  SigK.annotateText.beginEdit(turned.id);
  typeText(shell, 'メモを長く書き足して二行にする');
  SigK.freeTextEditor.finish();
  const edited = SigK.viewer.getAnnotations().added[0];
  assert.notDeepEqual(JSON.parse(JSON.stringify(edited.rect)), JSON.parse(JSON.stringify(turned.rect)));
  const after = SigK.freeTextTurn.cornerOf(edited);
  assert.ok(Math.abs(after[0] - before[0]) < 0.01 && Math.abs(after[1] - before[1]) < 0.01, `${before} → ${after}`);
  assert.equal(edited.angle, 30);
});
