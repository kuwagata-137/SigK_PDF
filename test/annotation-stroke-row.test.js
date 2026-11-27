'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 見出し「枠線」のラジオボタン「あり」「なし」（docs/spec-7-10-shape-tools.md。決定102 ④）。データと保存の形（color: null・/C を書かない）は
// 今までの［線なし］と同じなので、保存と読み戻しは shape-roundtrip.test.js が見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

// 図形の書き込みツールで kind を描く。描いた書き込みは選択したまま。
function draw(shell, kind, from, to) {
  const { SigK, document } = shell;
  const node = document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind(kind);
  mouse(shell, 'mousedown', node, px(from));
  mouse(shell, 'mousemove', document.body, px(to));
  mouse(shell, 'mouseup', node, px(to));
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

function radios(document) {
  const row = document.getElementById('props-stroke-on-row');
  return { row, on: row.querySelector('input[value="on"]'), off: row.querySelector('input[value="off"]') };
}

function choose(shell, input) {
  input.checked = true;
  input.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

function entryOf(shell, id) {
  return shell.SigK.viewer.getAnnotations().added.find((entry) => entry.id === id);
}

test('四角の書き込みツールでは、見出し「枠線」のすぐ下に「あり」「なし」を表示し、線の色の一覧に［線なし］を表示しない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const { row, on, off } = radios(document);
  assert.equal(row.hidden, false);
  assert.equal(document.getElementById('props-stroke-head').nextElementSibling, row);
  assert.deepEqual([...row.querySelectorAll('label')].map((label) => label.textContent), ['あり', 'なし']);
  assert.deepEqual([on.checked, off.checked], [true, false]);
  assert.equal(off.disabled, true, '塗りつぶしがなしの時は「なし」をクリックできない');
  document.getElementById('props-color').click();
  assert.equal(document.querySelector('#color-pop .item.none'), null, '［線なし］は削除した');
});

// 世代の積み方は、今までの線の色の一覧と同じ（同じ欄を続けて変えたら 1 世代に畳む。spec-4b-3a 確定事項J）。
test('塗りつぶしのある四角で「なし」を選ぶと枠線を消して 1 世代積み、続けて「あり」を選ぶと元の線の色で戻して同じ世代に畳む', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  const id = draw(shell, 'square', [100, 700], [200, 600]);
  const { on, off } = radios(document);
  assert.equal(off.disabled, false);
  choose(shell, off);
  assert.equal(entryOf(shell, id).color, null);
  assert.deepEqual([on.checked, off.checked], [false, true]);
  assert.equal(SigK.pageEdit.getHistoryState().at, 2);
  choose(shell, on);
  assert.equal(entryOf(shell, id).color, SigK.annotate.colorOf('square'));
  assert.deepEqual([on.checked, off.checked], [true, false]);
  assert.equal(SigK.pageEdit.getHistoryState().at, 1, '描いた直後と同じ状態に戻ったので、世代は残らない');
  choose(shell, off);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).color, '#ff0000');
  assert.deepEqual([on.checked, off.checked], [true, false], '元に戻すとラジオボタンも戻る');
});

test('書き込みを選択していない時は、次に描く四角の枠線のあり・なしを記憶する', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  choose(shell, radios(document).off);
  assert.equal(shell.uiCalls.some((patch) => patch.annotShapeStyles?.square?.strokeNone === true), true);
  const id = draw(shell, 'square', [100, 700], [200, 600]);
  assert.equal(entryOf(shell, id).color, null);
  SigK.annotate.select(null);
  choose(shell, radios(document).on);
  const next = draw(shell, 'square', [300, 700], [400, 600]);
  assert.equal(entryOf(shell, next).color, '#ff0000');
});

test('複数選択で枠線のあるものとないものが混ざる時は、どちらも選択しない。「あり」は枠線のないものだけに線の色を当てる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  SigK.annotate.setColor('#0070c0');
  SigK.annotate.select(null);
  const b = draw(shell, 'square', [300, 700], [400, 600]);
  SigK.annotate.setStrokeNone();
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([a, b]);
  const { on, off } = radios(document);
  assert.deepEqual([on.checked, off.checked], [false, false]);
  choose(shell, on);
  assert.equal(entryOf(shell, a).color, '#0070c0', '枠線のあるものの色は変えない');
  assert.equal(entryOf(shell, b).color, SigK.annotate.colorOf('square'));
  assert.equal(SigK.pageEdit.getHistoryState().at, 5, '1 世代');
});

// 質問 SH5 案A「「なし」の時は 4 行を隠す。…「あり」に戻すと、前の値で 4 行と枠線が戻る。」
const LINE_ROWS = ['props-color-row', 'props-style-row', 'props-width-row', 'props-opacity-row'];

function lineRowsHidden(document) {
  return LINE_ROWS.map((id) => document.getElementById(id).hidden);
}

test('「なし」の時は線の色・線種・線の太さ・透明度の行を非表示にし、「あり」に戻すと、なしにする前の線の色と線の太さで表示する', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  SigK.annotate.setColor('#0070c0');
  SigK.annotate.setLineWidth(7);
  assert.deepEqual(lineRowsHidden(document), [false, false, false, false]);
  choose(shell, radios(document).off);
  assert.deepEqual(lineRowsHidden(document), [true, true, true, true]);
  assert.equal(document.getElementById('props-fill-head').hidden, false, '見出し「塗り」は表示したまま');
  // 別の四角で線の色を変えて、四角の次に付ける線の色を #00b050 にする。
  SigK.annotate.select(null);
  draw(shell, 'square', [300, 700], [400, 600]);
  SigK.annotate.setColor('#00b050');
  SigK.annotate.setTool(null);
  SigK.annotate.select(a);
  assert.deepEqual(lineRowsHidden(document), [true, true, true, true]);
  choose(shell, radios(document).on);
  assert.deepEqual(lineRowsHidden(document), [false, false, false, false]);
  assert.equal(entryOf(shell, a).color, '#0070c0', '次に付ける線の色ではなく、なしにする前の色');
  assert.equal(entryOf(shell, a).lineWidth, 7);
  assert.equal(document.getElementById('props-width').value, '7');
});

test('書き込みツールで「なし」を選んだ時も 4 行を非表示にする。枠線のある書き込みか直線を一緒に選択している時は表示する', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  choose(shell, radios(document).off);
  assert.deepEqual(lineRowsHidden(document), [true, true, true, true]);
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  SigK.annotate.select(null);
  SigK.annotate.setShapeKind('line');
  assert.deepEqual(lineRowsHidden(document).slice(0, 3), [false, false, false], '直線の書き込みツールでは表示する');
  const line = draw(shell, 'line', [100, 500], [200, 400]);
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([a, line]);
  assert.equal(lineRowsHidden(document)[0], false, '直線の線の色を変えられるように表示する');
});

test('複数選択で「なし」を選ぶと、それぞれの元の線の色を記憶し、「あり」でそれぞれの色に戻す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ddebf7');
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  SigK.annotate.setColor('#0070c0');
  SigK.annotate.select(null);
  const b = draw(shell, 'square', [300, 700], [400, 600]);
  SigK.annotate.setColor('#00b050');
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys([a, b]);
  choose(shell, radios(document).off);
  assert.deepEqual([entryOf(shell, a).color, entryOf(shell, b).color], [null, null]);
  assert.deepEqual(lineRowsHidden(document), [true, true, true, true]);
  choose(shell, radios(document).on);
  assert.deepEqual([entryOf(shell, a).color, entryOf(shell, b).color], ['#0070c0', '#00b050']);
});

test('直線・矢印・テキストでは表示しない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  for (const kind of ['line', 'arrow']) {
    SigK.annotate.setTool('shape');
    SigK.annotate.setShapeKind(kind);
    assert.equal(radios(document).row.hidden, true, kind);
  }
  SigK.annotate.setTool('text');
  assert.equal(radios(document).row.hidden, true, 'text');
});
