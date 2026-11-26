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
test('塗りつぶしのある四角で「なし」を選ぶと枠線を消して 1 世代積み、続けて「あり」を選ぶと次に付ける線の色で戻して同じ世代に畳む', async (t) => {
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
  assert.equal(shell.uiCalls.some((patch) => patch.annotStrokeNone?.shape === true), true);
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
