'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, pageNode, plain } = require('./text-helpers.js');

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

test('setFontSize は 8〜200・0.5 刻みでない大きさを断り、一覧に無くても刻みに合えば受ける', async (t) => {
  const shell = await withTextShell(t);
  for (const size of [13.3, 201, 7.5, '12'])
    assert.equal(shell.SigK.annotateTextStyle.setFontSize(size), false, String(size));
  assert.equal(shell.SigK.annotate.getFontSize(), 12);
  assert.equal(shell.SigK.annotateTextStyle.setFontSize(13), true);
  assert.equal(shell.SigK.annotate.getFontSize(), 13);
});

test('setFontSize は図形を選んでいれば図形を変えず、次に置く大きさだけを覚える', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const page = pageNode(shell);
  const mouse = (type, target, x, y) => {
    const [cx, cy] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(x, y);
    target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  };
  mouse('mousedown', page, 100, 700);
  mouse('mousemove', shell.document.body, 150, 700);
  mouse('mousemove', shell.document.body, 200, 600);
  mouse('mouseup', page, 200, 600);
  const shape = SigK.annotate.selectedEntry();
  assert.equal(shape?.kind, 'square');
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotateTextStyle.setFontSize(48), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  assert.equal(SigK.annotate.getFontSize(), 48);
});

test('続けて大きさを変えても 1 世代に畳む', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeText(shell, 100, 700, 'あいう');
  const at = SigK.pageEdit.getHistoryState().at;
  SigK.annotateTextStyle.setFontSize(14);
  SigK.annotateTextStyle.setFontSize(16);
  SigK.annotateTextStyle.setFontSize(18);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].fontSize, 12);
});

// ---- 太字・斜体（spec-4b-4a 確定事項G3・H・K1） ----

test('setTextFlag は選んでいるテキストに太字・斜体を付け、続けて押しても 1 世代に畳み、次に置く値として覚える', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeText(shell, 100, 700, 'あいう');
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotateTextStyle.setTextFlag('bold', true), true);
  assert.equal(SigK.annotate.selectedEntry().bold, true);
  assert.equal(SigK.annotateTextStyle.setTextFlag('bold', false), true);
  assert.equal(SigK.annotateTextStyle.setTextFlag('bold', true), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1, '同じ欄を続けて変えたら 1 世代');
  assert.equal(SigK.annotateTextStyle.setTextFlag('italic', true), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 2, '別の欄は別の世代');
  assert.deepEqual(plain(SigK.annotateTextStyle.getNextStyle()), { bold: true, italic: true });
  SigK.pageEdit.undo();
  SigK.pageEdit.undo();
  const back = SigK.viewer.getAnnotations().added[0];
  assert.equal('bold' in back || 'italic' in back, false);
});

test('setTextFlag は形の違う値を断り、テキストを選んでいなければ次に置く値だけを覚える', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  assert.equal(SigK.annotateTextStyle.setTextFlag('underline', true), false);
  assert.equal(SigK.annotateTextStyle.setTextFlag('bold', 'yes'), false);
  assert.equal(SigK.annotateTextStyle.setTextFlag('italic', true), true);
  assert.deepEqual(plain(SigK.annotateTextStyle.getNextStyle()), { bold: false, italic: true });
  const entry = placeText(shell, 100, 600, '斜体');
  assert.equal(entry.italic, true);
  assert.equal(entry.width, 'auto');
});

test('覚えた太字・斜体は起動時に戻る', async (t) => {
  const shell = await withTextShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotTextStyle: { bold: true, italic: false } } });
  await shell.flush();
  assert.deepEqual(plain(shell.SigK.annotate.getTextStyle()), { bold: true, italic: false });
});

test('複数を選んで太字にすると、テキストにだけ当たって 1 世代', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const first = placeText(shell, 100, 700, 'あいう').id;
  const second = placeText(shell, 100, 600, 'えお').id;
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([first, second]);
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setTextFlag('bold', true), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  const added = SigK.viewer.getAnnotations().added;
  assert.deepEqual(plain(added.map((entry) => entry.bold)), [true, true]);
  assert.equal(SigK.annotate.getTextStyle().bold, true);
});
