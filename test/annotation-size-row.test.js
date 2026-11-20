'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// プロパティパネルの行「大きさ」（幅・高さ）と、チェック欄「縦横比を固定」（spec-7-9 確定事項D1〜D4）。
// 大きさの計算そのものは shape-size.test.js、ハンドルの形は shape-resize.test.js、描く形は shape-draft.test.js が見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t, ui = null) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: {} }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...(ui === null ? {} : { ui }),
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

// 書き込みツールで pt の 2 点の図形を描いて選ぶ（kind は編集ツールバーで選ぶ種類）。
function draw(shell, kind, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind(kind);
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  mouse(shell, 'mousedown', pageNode(shell), px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', pageNode(shell), px(to));
  SigK.annotate.setTool(null);
  return SigK.viewer.getAnnotations().added.at(-1);
}

function rowsOf(document) {
  return {
    size: document.getElementById('props-box-size-row'),
    width: document.getElementById('props-box-width'),
    height: document.getElementById('props-box-height'),
    ratio: document.getElementById('props-keep-ratio-row'),
    check: document.getElementById('props-keep-ratio'),
  };
}

function current(shell) {
  return shell.SigK.viewer.getAnnotations().added.at(-1);
}

function enter(shell, input, text) {
  input.focus();
  input.value = text;
  input.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

function toggle(shell, check, value) {
  check.checked = value;
  check.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

const center = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
const near = (actual, expected, eps = 0.02) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

test('四角・丸・×印の書き込みツールではチェック欄だけを、選択した時は大きさの行も表示する。ほかの種類には表示しない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  assert.equal(rows.size.hidden, true);
  assert.equal(rows.ratio.hidden, true, '何も選択していなければ表示しない');
  SigK.annotate.setTool('shape');
  for (const kind of ['square', 'circle', 'cross']) {
    SigK.annotate.setShapeKind(kind);
    assert.equal(rows.ratio.hidden, false, `${kind} の書き込みツール`);
    assert.equal(rows.size.hidden, true, '次に追加する書き込みには大きさの数値欄を表示しない');
  }
  for (const kind of ['line', 'arrow', 'polygon']) {
    SigK.annotate.setShapeKind(kind);
    assert.equal(rows.ratio.hidden, true, `${kind} の書き込みツール`);
  }
  SigK.annotate.setTool('pen');
  assert.equal(rows.ratio.hidden, true);
  SigK.annotate.setTool(null);
  draw(shell, 'circle', [100, 700], [300, 600]);
  assert.equal(rows.size.hidden, false);
  assert.equal(rows.ratio.hidden, false);
  assert.equal(rows.width.value, '200');
  assert.equal(rows.height.value, '100');
  draw(shell, 'line', [100, 500], [300, 450]);
  assert.equal(rows.size.hidden, true);
  assert.equal(rows.ratio.hidden, true);
  // 行は回転の行のすぐ上（見出し「枠線」「塗り」の外）
  const order = [...document.querySelectorAll('#props .props-body > .prop')].map((node) => node.id);
  assert.deepEqual(order.slice(order.indexOf('props-box-size-row'), order.indexOf('props-box-size-row') + 3), ['props-box-size-row', 'props-keep-ratio-row', 'props-angle-row']);
});

test('幅・高さを入力すると中心を保って大きさを変え、1 世代積む。範囲の外と数でない値は今の値に戻す', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  const entry = draw(shell, 'square', [100, 700], [300, 600]);
  enter(shell, rows.width, '300');
  assert.equal(current(shell).id, entry.id);
  assert.deepEqual([...current(shell).rect], [50, 600, 350, 700]);
  assert.equal(rows.width.value, '300');
  enter(shell, rows.height, '50.04');
  assert.deepEqual([...current(shell).rect], [50, 624.98, 350, 675.02]);
  assert.equal(rows.height.value, '50', '表示は小数 1 桁');
  for (const text of ['0.5', '20000', 'abc', '']) {
    enter(shell, rows.width, text);
    assert.equal(rows.width.value, '300', `${text} は当てない`);
  }
  assert.deepEqual([...current(shell).rect], [50, 624.98, 350, 675.02]);
  // Ctrl+Z 1 回ずつで戻る
  SigK.pageEdit.undo();
  assert.deepEqual([...current(shell).rect], [50, 600, 350, 700]);
  SigK.pageEdit.undo();
  assert.deepEqual([...current(shell).rect], [100, 600, 300, 700]);
});

test('回した図形も、数値で大きさを変えると中心は動かない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  draw(shell, 'circle', [100, 700], [300, 600]);
  SigK.annotationAngleRow.setAngle(30);
  const before = center(current(shell).rect);
  enter(shell, rows.height, '40');
  const after = current(shell);
  assert.equal(after.angle, 30);
  near(after.rect[3] - after.rect[1], 40);
  near(center(after.rect)[0], before[0]);
  near(center(after.rect)[1], before[1]);
});

test('縦横比を固定にチェックがあると、幅を入力すれば高さも、高さを入力すれば幅も今の比で変える。チェックは記憶する', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  draw(shell, 'square', [100, 700], [300, 600]);
  assert.equal(rows.check.checked, false);
  toggle(shell, rows.check, true);
  assert.equal(SigK.shapeRatio.isKept(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(shell.uiCalls.at(-1))), { annotKeepRatio: true });
  enter(shell, rows.width, '300');
  assert.deepEqual([...current(shell).rect], [50, 575, 350, 725]);
  assert.equal(rows.height.value, '150');
  enter(shell, rows.height, '50');
  assert.deepEqual([...current(shell).rect], [150, 625, 250, 675]);
  assert.equal(rows.width.value, '100');
  // もう一方が範囲の外になる値は当てない（幅 10000 → 高さ 5000 は当たるが、高さ 0.8 → 幅 1.6・高さ 0.8 は最小を下回る）
  enter(shell, rows.height, '0.8');
  assert.deepEqual([...current(shell).rect], [150, 625, 250, 675]);
  toggle(shell, rows.check, false);
  assert.deepEqual(JSON.parse(JSON.stringify(shell.uiCalls.at(-1))), { annotKeepRatio: false });
});

test('縦横比を固定にチェックがあると、新しく描く四角・丸・×印は正方形・正円になり、辺のハンドルでも比を保つ', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  SigK.shapeRatio.apply(true);
  assert.equal(rowsOf(document).ratio.hidden, true, '書き込みを選択していなければ行は隠れたまま');
  const circle = draw(shell, 'circle', [100, 700], [300, 600]);
  assert.deepEqual([...circle.rect], [100, 500, 300, 700]);
  // 辺のハンドル（右の辺）を右へ引くと、縦も同じ比で中心から両側へ伸びる
  const handle = SigK.annotationFrame.shown().shape.handles.find((item) => item.id === 'x2');
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  mouse(shell, 'mousedown', pageNode(shell), handle.at);
  mouse(shell, 'mousemove', document.body, [handle.at[0] + 100 * scale, handle.at[1]]);
  mouse(shell, 'mouseup', pageNode(shell), [handle.at[0] + 100 * scale, handle.at[1]]);
  const after = current(shell);
  near(after.rect[0], 100);
  near(after.rect[2] - after.rect[0], 300, 0.05);
  near(after.rect[3] - after.rect[1], 300, 0.05);
  near(center(after.rect)[1], 600, 0.05);
  // 直線には効かない
  const line = draw(shell, 'line', [100, 400], [300, 350]);
  assert.deepEqual(JSON.parse(JSON.stringify(line.paths[0])), [[100, 400], [300, 350]]);
});

test('起動時に settings.json のチェックの状態を戻す', async (t) => {
  const shell = await withShell(t, { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotKeepRatio: true });
  const { document, SigK } = shell;
  assert.equal(SigK.shapeRatio.isKept(), true);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  assert.equal(rowsOf(document).check.checked, true);
  assert.equal(SigK.shapeRatio.apply('yes'), true, '真偽値でなければ捨てる');
});

test('複数選択・トリミング・モザイクでは、大きさと縦横比を固定の行を表示しない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const rows = rowsOf(document);
  const first = draw(shell, 'square', [100, 700], [300, 600]);
  const second = draw(shell, 'circle', [100, 500], [300, 400]);
  assert.equal(rows.size.hidden, false);
  SigK.annotate.selectKeys([first.id, second.id]);
  assert.equal(rows.size.hidden, true);
  assert.equal(rows.ratio.hidden, true);
  SigK.annotate.select(second.id);
  assert.equal(rows.size.hidden, false);
  SigK.annotate.setTool('trim');
  assert.equal(rows.size.hidden, true);
  assert.equal(rows.ratio.hidden, true);
  SigK.annotate.setTool('mosaic');
  assert.equal(rows.size.hidden, true);
  assert.equal(rows.ratio.hidden, true);
});
