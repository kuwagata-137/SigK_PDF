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
  assert.deepEqual(plain(SigK.annotateTextStyle.getNextStyle()), { bold: true, italic: true, fill: null, border: null, borderWidth: 1 });
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
  assert.deepEqual(plain(SigK.annotateTextStyle.getNextStyle()), { bold: false, italic: true, fill: null, border: null, borderWidth: 1 });
  const entry = placeText(shell, 100, 600, '斜体');
  assert.equal(entry.italic, true);
  assert.equal(entry.width, 'auto');
});

test('覚えた太字・斜体は起動時に戻る', async (t) => {
  const shell = await withTextShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotTextStyle: { bold: true, italic: false } } });
  await shell.flush();
  assert.deepEqual(plain(shell.SigK.annotate.getTextStyle()), { bold: true, italic: false, fill: null, border: null, borderWidth: 1 });
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

// ---- 塗りと枠線（spec-4b-4a 確定事項G4・G5・H） ----

function row(document, id) {
  return document.getElementById(id);
}

test('テキストを選んで塗り・枠線・枠線の太さを変えると、それぞれ 1 世代で、次に置くテキストにも付く', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeText(shell, 100, 700, 'あいう');
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setFill('#fff2cc'), true);
  assert.equal(SigK.annotate.selectedEntry().fill, '#fff2cc');
  assert.equal(row(document, 'props-width-row').hidden, true, '枠線が無ければ太さの行を出さない');
  assert.equal(SigK.annotate.setBorder('#C00000'), true);
  assert.deepEqual([SigK.annotate.selectedEntry().borderColor, SigK.annotate.selectedEntry().borderWidth], ['#c00000', 1]);
  assert.equal(row(document, 'props-width-row').hidden, false);
  assert.equal(row(document, 'props-width-label').textContent, '枠線の太さ');
  assert.equal(SigK.annotate.setLineWidth(3), true);
  assert.equal(SigK.annotate.selectedEntry().borderWidth, 3);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 3);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotTextStyle: { borderWidth: 3 } });
  const next = placeText(shell, 100, 500, '次');
  assert.deepEqual([next.fill, next.borderColor, next.borderWidth, next.width], ['#fff2cc', '#c00000', 3, 'auto']);
  // 枠線を外すと太さの行も消える。
  assert.equal(SigK.annotate.setBorder(null), true);
  assert.equal('borderColor' in SigK.annotate.selectedEntry(), false);
  assert.equal(row(document, 'props-width-row').hidden, true);
});

test('テキストの道具を持つと塗りと枠線の行が出て、枠線を選ぶと枠線の太さの行が出る', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  assert.equal(row(document, 'props-fill-row').hidden, false);
  assert.equal(row(document, 'props-border-row').hidden, false);
  assert.equal(document.getElementById('props-border-name').textContent, 'なし');
  assert.equal(row(document, 'props-width-row').hidden, true);
  SigK.annotate.setBorder('#4472c4');
  assert.equal(row(document, 'props-width-row').hidden, false);
  assert.equal(row(document, 'props-width-label').textContent, '枠線の太さ');
  assert.equal(SigK.annotate.getTextStyle().border, '#4472c4');
});

test('複数選択で塗りは四角とテキストに、太さは図形の線とテキストの枠線に当たり、行の名は「線と枠線の太さ」', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const text = placeText(shell, 100, 700, 'あいう').id;
  SigK.annotate.setBorder('#c00000');
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const page = pageNode(shell);
  const mouse = (type, target, x, y) => {
    const [cx, cy] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(x, y);
    target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  };
  mouse('mousedown', page, 100, 500);
  mouse('mousemove', document.body, 150, 450);
  mouse('mousemove', document.body, 200, 400);
  mouse('mouseup', page, 200, 400);
  const square = SigK.annotate.selectedEntry().id;
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([text, square]);
  assert.equal(row(document, 'props-width-label').textContent, '線と枠線の太さ');
  assert.equal(row(document, 'props-border-label').textContent, '枠線（テキスト）');
  assert.equal(SigK.annotate.setFill('#ffff00'), true);
  assert.equal(SigK.annotate.setLineWidth(4), true);
  const [first, second] = SigK.viewer.getAnnotations().added;
  assert.deepEqual([first.fill, first.borderWidth, second.fill, second.lineWidth], ['#ffff00', 4, '#ffff00', 4]);
});

test('枠線の太さのスライダーは、動かしている間は箱ごと下見で描き、積まない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, 'あいう');
  SigK.annotate.setBorder('#c00000');
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotatePreview.update('lineWidth', 6), true);
  const drawn = SigK.annotatePreview.previewFor(SigK.annotate.selectedEntry());
  assert.equal(drawn.borderWidth, 6);
  assert.ok(drawn.rect[0] < entry.rect[0], '余白が広がって箱が外へ出る');
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  SigK.annotatePreview.cancel();
});

test('入力欄は塗りを地に出す', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('text');
  SigK.annotate.setFill('#fff2cc');
  const page = pageNode(shell);
  const [cx, cy] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(100, 700);
  for (const type of ['mousedown', 'mouseup'])
    page.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy, button: 0 }));
  const node = shell.document.querySelector('textarea.free-text-editor');
  assert.equal(node.style.background, 'rgb(255, 242, 204)');
});
