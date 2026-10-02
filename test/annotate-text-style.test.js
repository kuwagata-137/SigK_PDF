'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText } = require('./text-helpers.js');

// テキストの書式を当てる指揮（spec-4b-4a。annotate-text.js から移した文字の大きさの変更）。

test('setFontSize は選んでいるテキストの大きさと箱を変えて 1 世代積み、次に置く大きさとして覚える', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, 'あいう');
  assert.equal(entry.fontSize, 12);
  assert.equal(SigK.annotateTextStyle.setFontSize(24), true);
  const changed = SigK.annotate.selectedEntry();
  assert.equal(changed.fontSize, 24);
  // 箱は表示の左上を保ったまま、本文を測り直した大きさ（全角 3 字 × 24 ＋ 余白 4）。
  assert.equal(changed.rect[0], entry.rect[0]);
  assert.equal(changed.rect[3], entry.rect[3]);
  assert.equal(changed.rect[2] - changed.rect[0], 76);
  assert.equal(SigK.annotate.getFontSize(), 24);
  // 1 世代だけ積んだので、1 回戻せば置いたときの大きさに戻る。
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].fontSize, 12);
});

test('setFontSize は一覧に無い大きさを断る', async (t) => {
  const shell = await withTextShell(t);
  assert.equal(shell.SigK.annotateTextStyle.setFontSize(13), false);
  assert.equal(shell.SigK.annotate.getFontSize(), 12);
});
