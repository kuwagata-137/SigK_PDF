'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');
const { placeText } = require('./text-helpers.js');

// 2 件以上を選んでいるときの見た目の設定（spec-4b-3a 確定事項I。モック screenshots/phase4b-3-multi.png）。
// 当てる値と出す形の計算そのものは annotation-style-patch.test.js が見る。

const A = 'C:\\work\\a.pdf';

// 1 ページ目に読み込んだハイライト（12R）と四角（40R）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '40R', subtype: 'Square', rect: [399, 199, 501, 301], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 2 }, hasAppearance: true },
  ],
};

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.annotationImport.settled();
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

const pageNode = (shell) => shell.document.querySelector('.pdf-page[data-page="1"]');
const px = (shell, point) => shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
}

function draw(shell, tool, kind, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool(tool);
  if (kind !== null)
    SigK.annotate.setShapeKind(kind);
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, [(from[0] + to[0]) / 2, from[1]]));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

// 四角・矢印・ペンを描いて、ハイライト（12R）と一緒に選ぶ。
function drawSet(shell) {
  const square = draw(shell, 'shape', 'square', [100, 700], [200, 600]);
  const arrow = draw(shell, 'shape', 'arrow', [300, 700], [400, 600]);
  const ink = draw(shell, 'pen', null, [100, 500], [200, 450]);
  shell.SigK.annotate.selectKeys(['12R', square, arrow, ink]);
  return { square, arrow, ink };
}

const entry = (shell, key) => shell.SigK.annotationState.findAnnot(shell.SigK.viewer.getAnnotations(), shell.SigK.viewer.getImported(), key);

test('複数を選んで線の色を変えると、表示のみ以外の全部に当たり、1 世代で、選択はそのまま（確定事項I2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { square, arrow, ink } = drawSet(shell);
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setColor('#00aa00'), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  const keys = [...SigK.annotate.getSelection()];
  assert.equal(keys.length, 4);
  for (const key of keys)
    assert.equal(entry(shell, key).color, '#00aa00');
  assert.ok(!keys.includes('12R'), '読み込んだハイライトは写しに替わり、新しい鍵で選び直す');
  assert.deepEqual(keys.slice(1), [square, arrow, ink]);
  SigK.pageEdit.undo();
  assert.equal(entry(shell, square).color === '#00aa00', false);
  assert.deepEqual([...SigK.annotate.getSelection()], ['12R', square, arrow, ink]);
});

test('塗り・線種・太さ・不透明度は、その欄を持てる書き込みにだけ当たる（確定事項I2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { square, arrow, ink } = drawSet(shell);
  SigK.annotate.setFill('#ffee00');
  assert.equal(entry(shell, square).fill, '#ffee00');
  assert.equal(entry(shell, arrow).fill ?? null, null);
  SigK.annotate.setLineStyle('dashed');
  assert.equal(entry(shell, square).lineStyle, 'dashed');
  assert.equal(entry(shell, arrow).lineStyle, 'dashed');
  assert.equal(entry(shell, ink).lineStyle ?? 'solid', 'solid');
  SigK.annotate.setLineWidth(9);
  assert.deepEqual([square, arrow, ink].map((key) => entry(shell, key).lineWidth), [9, 9, 9]);
  SigK.annotate.setOpacity(0.4);
  assert.deepEqual([square, arrow, ink].map((key) => entry(shell, key).opacity), [0.4, 0.4, 0.4]);
  assert.equal(entry(shell, SigK.annotate.getSelection()[0]).opacity, 1, 'ハイライトは不透明度を持てない');
});

test('線なしは、塗りのある四角・丸にだけ当たる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { square, arrow } = drawSet(shell);
  assert.equal(SigK.annotate.setStrokeNone(), false, '塗りのある四角・丸が無ければ断る');
  SigK.annotate.setFill('#ffee00');
  assert.equal(SigK.annotate.setStrokeNone(), true);
  assert.equal(entry(shell, square).color, null);
  assert.notEqual(entry(shell, arrow).color, null);
});

test('複数に当てた値は、当てた種類ごとに次に付ける値になる（確定事項I4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const square = draw(shell, 'shape', 'square', [100, 700], [200, 600]);
  const ink = draw(shell, 'pen', null, [100, 500], [200, 450]);
  const before = { ...SigK.annotate.getColors() };
  SigK.annotate.selectKeys([square, ink]);
  SigK.annotate.setColor('#123456');
  SigK.annotate.setOpacity(0.6);
  const after = SigK.annotate.getColors();
  assert.equal(after.shape, '#123456');
  assert.equal(after.pen, '#123456');
  assert.equal(after.text, before.text, 'テキストの色は変わらない');
  assert.equal(SigK.annotate.getOpacity('ink'), 0.6);
  assert.equal(SigK.annotate.getOpacity('text'), SigK.annotationPresets.DEFAULT_OPACITIES.text);
});

test('複数を選んでいるとき、太さのスライダーの下見は太さを持てる全部に当たり、Esc で捨てる（確定事項I3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { square, ink } = drawSet(shell);
  assert.equal(SigK.annotatePreview.update('lineWidth', 12), true);
  assert.equal(SigK.annotatePreview.previewFor(entry(shell, square)).lineWidth, 12);
  assert.equal(SigK.annotatePreview.previewFor(entry(shell, ink)).lineWidth, 12);
  const highlight = entry(shell, '12R');
  assert.equal(SigK.annotatePreview.previewFor(highlight), highlight);
  SigK.annotate.escape();
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(entry(shell, square).lineWidth, 2);
});

test('右パネルは、そろっていない色を「混在」、太さを空の数値欄で出し、そろっている値はそのまま出す（確定事項I1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { square, arrow } = drawSet(shell);
  SigK.annotate.selectKeys([square, arrow]);
  SigK.annotate.setColor('#ff0000');
  SigK.annotate.select(square);
  SigK.annotate.setColor('#0000ff');
  SigK.annotate.selectKeys([square, arrow]);
  assert.equal(document.getElementById('props-color-name').textContent, '混在');
  assert.equal(document.querySelector('#props-color .sw').classList.contains('mixed'), true);
  assert.equal(document.getElementById('props-fill-row').hidden, false);
  assert.equal(document.getElementById('props-fill-name').textContent, 'なし');
  assert.equal(document.getElementById('props-width').value, '2', 'そろっていれば値');
  SigK.annotate.select(arrow);
  SigK.annotate.setLineWidth(5);
  SigK.annotate.selectKeys([square, arrow]);
  assert.equal(document.getElementById('props-width').value, '');
  assert.equal(document.getElementById('props-width').placeholder, '–');
  assert.equal(document.getElementById('props-width-range').value, '5', 'スライダーは主の値');
  const pressed = [...document.querySelectorAll('#props-style button')].filter((button) => button.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1, '線種はそろっているので押してある');
});

test('ハイライトだけを選んでいれば、塗り・線種・太さ・不透明度の行は出さない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const base = entry(shell, '12R');
  const annots = SigK.annotationState.addAnnot(SigK.viewer.getAnnotations(), { ...base, ref: undefined, id: undefined });
  SigK.pageEdit.commitAnnots(annots);
  SigK.annotate.selectKeys(['12R', SigK.viewer.getAnnotations().added.at(-1).id]);
  for (const id of ['props-fill-row', 'props-style-row', 'props-width-row', 'props-opacity-row'])
    assert.equal(document.getElementById(id).hidden, true, id);
  assert.equal(document.getElementById('props-color-row').hidden, false);
});

test('混在の色のチップを押すと、どの色にも印の無いパレットが開き、選んだ色が全部に当たる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { square, arrow } = drawSet(shell);
  SigK.annotate.select(arrow);
  SigK.annotate.setColor('#0000ff');
  SigK.annotate.selectKeys([square, arrow]);
  document.getElementById('props-color').click();
  assert.equal(SigK.colorPopover.isOpen(), true);
  assert.equal(document.querySelectorAll('.color-pop .cell.on').length, 0);
  const cell = document.querySelector('.color-pop .cell');
  cell.click();
  assert.equal(entry(shell, square).color, cell.dataset.color);
  assert.equal(entry(shell, arrow).color, cell.dataset.color);
});

// 文字の大きさは、複数を選んでいてもテキストにだけ当てる（spec-4b-4a 確定事項G5。spec-4b-3a 確定事項I5 を改めた）。
test('複数を選んでいてもテキストが無ければ、文字の大きさの行を出さず、何も変えない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  drawSet(shell);
  assert.equal(document.getElementById('props-size-row').hidden, true);
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setFontSize(20), false);
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
});

test('複数を選んで文字の大きさを変えると、テキストにだけ当たり、1 世代で、行の名に「（テキスト）」が付く', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { square } = drawSet(shell);
  const first = placeText(shell, 300, 450, 'あいう').id;
  const second = placeText(shell, 300, 380, 'えお').id;
  SigK.annotate.setTool(null);
  SigK.annotate.select(second);
  SigK.annotate.setFontSize(18);
  SigK.annotate.selectKeys([square, first, second]);
  assert.equal(document.getElementById('props-size-row').hidden, false);
  assert.equal(document.getElementById('props-size-label').textContent, '文字の大きさ（テキスト）');
  assert.equal(document.getElementById('props-size').value, '', '12 と 18 でそろっていないので空');
  const squareBefore = JSON.stringify(entry(shell, square));
  const at = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.setFontSize(24), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  assert.equal(entry(shell, first).fontSize, 24);
  assert.equal(entry(shell, second).fontSize, 24);
  assert.equal(JSON.stringify(entry(shell, square)), squareBefore, '四角は変えない');
  assert.equal(document.getElementById('props-size').value, '24');
  assert.equal(SigK.annotate.getFontSize(), 24, '次に置く大きさとしても覚える');
  // 続けて変えても 1 世代。戻せば、それぞれの元の大きさと選択に戻る。
  SigK.annotate.setFontSize(36);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  SigK.pageEdit.undo();
  assert.equal(entry(shell, first).fontSize, 12);
  assert.equal(entry(shell, second).fontSize, 18);
  assert.deepEqual([...SigK.annotate.getSelection()], [square, first, second]);
});

test('テキストだけを複数選んでいれば、行の名は「文字の大きさ」のまま', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const first = placeText(shell, 300, 450, 'あいう').id;
  const second = placeText(shell, 300, 380, 'えお').id;
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([first, second]);
  assert.equal(document.getElementById('props-size-label').textContent, '文字の大きさ');
  assert.equal(document.getElementById('props-size').value, '12');
});
