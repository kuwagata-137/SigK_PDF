'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, plain } = require('./text-helpers.js');

// 右パネルのテキストの行（spec-4b-4a 確定事項G1・G2・G5）。「文字の大きさ」は数値の欄（8〜200、0.5 刻み）と、よく使う大きさの一覧。

function sizeRow(document) {
  return {
    row: document.getElementById('props-size-row'),
    label: document.getElementById('props-size-label'),
    number: document.getElementById('props-size'),
    list: document.getElementById('props-size-list'),
  };
}

function enter(shell, node, value) {
  node.focus();
  node.value = value;
  node.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

test('render は大きさがあれば行を出して値を入れ、null なら隠す。そろっていなければ数値の欄を空にして「–」', async (t) => {
  const { SigK, document } = await withTextShell(t);
  const { row, label, number } = sizeRow(document);
  assert.equal(SigK.annotationTextRows.render(18), true);
  assert.equal(row.hidden, false);
  assert.equal(number.value, '18');
  assert.equal(label.textContent, '文字の大きさ');
  SigK.annotationTextRows.render({ value: 24, mixed: true, label: '文字の大きさ（テキスト）' });
  assert.equal(number.value, '');
  assert.equal(number.placeholder, '–');
  assert.equal(label.textContent, '文字の大きさ（テキスト）');
  SigK.annotationTextRows.render(null);
  assert.equal(row.hidden, true);
});

test('数値の欄は 8〜200・0.5 刻みで、よく使う大きさの一覧は 18 段（先頭は見えない空の選択肢）', async (t) => {
  const { SigK, document } = await withTextShell(t);
  const { number, list } = sizeRow(document);
  assert.equal(number.type, 'number');
  assert.deepEqual([number.min, number.max, number.step], ['8', '200', '0.5']);
  const options = [...list.options];
  assert.equal(options[0].value, '');
  assert.equal(options[0].hidden, true);
  assert.deepEqual(options.slice(1).map((option) => Number(option.value)), [...SigK.annotationPresets.FONT_SIZES]);
  assert.equal(options.at(-1).textContent, '200 pt');
});

test('一覧で選ぶと annotate.setFontSize へ流れ、一覧は空の選択肢に戻る', async (t) => {
  const { SigK, document, window } = await withTextShell(t);
  const { list } = sizeRow(document);
  SigK.annotate.setTool('text');
  list.value = '36';
  list.dispatchEvent(new window.Event('change'));
  assert.equal(SigK.annotate.getFontSize(), 36);
  assert.equal(list.value, '');
  assert.equal(document.getElementById('props-size').value, '36');
});

test('数値の欄は Enter で当て、半端は 0.5 刻みに、範囲の外は 8〜200 に丸める', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const { number } = sizeRow(document);
  SigK.annotate.setTool('text');
  enter(shell, number, '13.3');
  assert.equal(SigK.annotate.getFontSize(), 13.5);
  assert.equal(number.value, '13.5');
  enter(shell, number, '500');
  assert.equal(SigK.annotate.getFontSize(), 200);
  enter(shell, number, '2');
  assert.equal(SigK.annotate.getFontSize(), 8);
});

test('数値の欄が空か数でなければ当てずに今の値へ戻し、欄を離れたとき（change）も当てる', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document, window } = shell;
  const { number } = sizeRow(document);
  SigK.annotate.setTool('text');
  enter(shell, number, '');
  assert.equal(SigK.annotate.getFontSize(), 12);
  assert.equal(number.value, '12');
  number.value = '64';
  number.dispatchEvent(new window.Event('change'));
  assert.equal(SigK.annotate.getFontSize(), 64);
});

test('選んでいるテキストの大きさを数値の欄で変えると、そのテキストが変わって 1 世代積む', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeText(shell, 100, 700, 'あいう');
  const at = SigK.pageEdit.getHistoryState().at;
  enter(shell, sizeRow(document).number, '150');
  assert.equal(SigK.annotate.selectedEntry().fontSize, 150);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
});

// ---- 書式の行（spec-4b-4a 確定事項G3・G5） ----

function formatRow(document) {
  return {
    row: document.getElementById('props-format-row'),
    label: document.getElementById('props-format-label'),
    bold: document.querySelector('#props-format button[data-format="bold"]'),
    italic: document.querySelector('#props-format button[data-format="italic"]'),
  };
}

test('renderFormat は付いている書式のボタンを押した形にし、混在なら押していない形（aria-pressed は mixed）にする', async (t) => {
  const { SigK, document } = await withTextShell(t);
  const { row, label, bold, italic } = formatRow(document);
  SigK.annotationTextRows.renderFormat({ bold: { value: true, mixed: false }, italic: { value: false, mixed: false }, label: '書式' });
  assert.equal(row.hidden, false);
  assert.equal(label.textContent, '書式');
  assert.deepEqual([bold.classList.contains('on'), bold.getAttribute('aria-pressed')], [true, 'true']);
  assert.deepEqual([italic.classList.contains('on'), italic.getAttribute('aria-pressed')], [false, 'false']);
  SigK.annotationTextRows.renderFormat({ bold: { value: true, mixed: true }, italic: { value: false, mixed: false }, label: '書式（テキスト）' });
  assert.deepEqual([bold.classList.contains('on'), bold.getAttribute('aria-pressed')], [false, 'mixed']);
  assert.equal(label.textContent, '書式（テキスト）');
  SigK.annotationTextRows.renderFormat(null);
  assert.equal(row.hidden, true);
});

test('テキストの道具を持つと書式の行が出て、B を押すと次に置くテキストが太字になり、もう一度押すと外れる', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  const { row, bold } = formatRow(document);
  assert.equal(row.hidden, false);
  bold.click();
  assert.equal(SigK.annotate.getTextStyle().bold, true);
  assert.equal(bold.classList.contains('on'), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotTextStyle: { bold: true } });
  const entry = placeText(shell, 100, 700, '太字');
  assert.equal(entry.bold, true);
  // 選んでいる太字のテキストで B を押すと外れる。
  formatRow(document).bold.click();
  assert.equal('bold' in SigK.annotate.selectedEntry(), false);
  assert.equal(SigK.annotate.getTextStyle().bold, false);
});
