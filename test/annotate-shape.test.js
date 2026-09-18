'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 図形・ペン注釈の指揮と押し離し（spec-4-3 確定事項1〜7・9・10・12〜19）。
//
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま
// .pdf-page 基準の CSS px になる。座標の計算そのものは shape-geometry.test.js が見る。

const A = 'C:\\work\\a.pdf';

// 読み込む図形: 他のツールの矩形と矢印（2 点の PolyLine）、向きを落とす Line。
const IMPORTED = {
  0: [
    { id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 4 }, opacity: 1 },
    { id: '31R', subtype: 'PolyLine', rect: [48.5, 48.5, 251.5, 151.5], color: new Uint8ClampedArray([0, 128, 0]), borderStyle: { width: 3 }, vertices: new Float32Array([50, 50, 250, 150]), lineEndings: ['None', 'OpenArrow'] },
    { id: '32R', subtype: 'Line', rect: [48, 198, 252, 302], color: new Uint8ClampedArray([0, 0, 0]), borderStyle: { width: 2 }, lineCoordinates: [50, 200, 250, 300], lineEndings: ['None', 'None'] },
  ],
};

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED, ...(options.stub ?? {}) }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

async function withTool(t, tool, options = {}) {
  const shell = await withShell(t, options);
  shell.SigK.annotate.setTool(tool);
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function viewportOf(shell, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport;
}

function mouse(shell, type, target, x, y, extra = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
  target.dispatchEvent(event);
  return event;
}

// pt の 2 点をドラッグする（押す → 動かす → 離す）。途中の点は pt の並び。
function drag(shell, from, to, { index = 0, shift = false, via = [] } = {}) {
  const page = pageNode(shell, index);
  const viewport = viewportOf(shell, index);
  const px = (point) => viewport.convertToViewportPoint(point[0], point[1]);
  const [sx, sy] = px(from);
  const down = mouse(shell, 'mousedown', page, sx, sy, { shiftKey: shift });
  for (const point of via) {
    const [x, y] = px(point);
    mouse(shell, 'mousemove', shell.document.body, x, y, { shiftKey: shift });
  }
  const [ex, ey] = px(to);
  mouse(shell, 'mousemove', shell.document.body, ex, ey, { shiftKey: shift });
  mouse(shell, 'mouseup', page, ex, ey, { shiftKey: shift });
  return down;
}

function clickAt(shell, x, y, index = 0) {
  const page = pageNode(shell, index);
  const [cx, cy] = viewportOf(shell, index).convertToViewportPoint(x, y);
  mouse(shell, 'mousedown', page, cx, cy);
  mouse(shell, 'mouseup', page, cx, cy);
}

const plain = (value) => structuredClone(value);
const near = (actual, expected, eps = 0.05) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} は ${expected} に近くない`);

// ---- 描く（確定事項3・4・6・9） ----

test('図形の道具で紙をドラッグすると矩形が描かれ、1 世代積まれて選ばれる', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK, document } = shell;
  assert.equal(document.documentElement.getAttribute('data-tool'), 'shape');
  assert.equal(SigK.annotateShape.getShapeKind(), 'square');
  const down = drag(shell, [100, 700], [300, 600]);
  assert.equal(down.defaultPrevented, true);
  const { added } = SigK.viewer.getAnnotations();
  assert.equal(added.length, 1);
  const entry = added[0];
  assert.equal(entry.kind, 'square');
  assert.equal(entry.color, '#d92c2c');
  assert.equal(entry.lineWidth, 2);
  assert.equal(entry.src, 0);
  entry.rect.forEach((value, i) => near(value, [100, 600, 300, 700][i]));
  assert.equal('paths' in entry, false);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.pageEdit.canUndo(), true);
  assert.equal(SigK.viewer.isDirty(), true);
  assert.equal(SigK.annotateShape.isDrawing(), false);
  assert.equal(SigK.annotatePointer.isDrawing(), false);
  // 層に描かれ、枠が付く
  const group = pageNode(shell).querySelector(`.annot-layer g[data-annot="${entry.id}"]`);
  assert.equal(group.getAttribute('data-kind'), 'square');
  assert.ok(group.querySelector('rect') !== null);
  assert.ok(pageNode(shell).querySelector('.annot-frame') !== null);
  assert.equal(pageNode(shell).querySelector('.annot-draft'), null);
});

test('描いている途中は下書きが層に出て、Esc で捨てられる', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK, document } = shell;
  const viewport = viewportOf(shell);
  const [sx, sy] = viewport.convertToViewportPoint(100, 700);
  mouse(shell, 'mousedown', pageNode(shell), sx, sy);
  assert.equal(SigK.annotateShape.isDrawing(), true);
  const [mx, my] = viewport.convertToViewportPoint(200, 650);
  mouse(shell, 'mousemove', document.body, mx, my);
  const draft = pageNode(shell).querySelector('.annot-draft');
  assert.ok(draft !== null);
  assert.ok(draft.querySelector('rect') !== null);
  assert.equal(draft.hasAttribute('data-annot'), false);
  // Esc で捨てる（道具は離さない）
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotateShape.isDrawing(), false);
  assert.equal(pageNode(shell).querySelector('.annot-draft'), null);
  assert.equal(SigK.annotate.getTool(), 'shape');
  // その後の離しでは何も作らない
  mouse(shell, 'mouseup', pageNode(shell), mx, my);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.pageEdit.canUndo(), false);
});

test('押して離すだけ（CLICK_SLOP 以内）では描かず、当たり判定で選ぶ', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  drag(shell, [100, 700], [101, 699]);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.pageEdit.canUndo(), false);
  assert.equal(pageNode(shell).querySelector('.annot-draft'), null);
  // 読み込んだ矩形の上を押して離すと選ぶ（道具を持ったまま）
  clickAt(shell, 350, 340);
  assert.equal(SigK.annotate.getSelected(), '30R');
  assert.equal(SigK.annotate.getTool(), 'shape');
});

test('種類を切り替えると楕円・直線・矢印が描け、直線は押した点から離した点へ向く', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  assert.equal(SigK.annotate.setShapeKind('circle'), true);
  drag(shell, [100, 700], [200, 650]);
  assert.equal(SigK.annotate.setShapeKind('line'), true);
  drag(shell, [300, 700], [100, 500]);
  assert.equal(SigK.annotate.setShapeKind('arrow'), true);
  drag(shell, [100, 400], [300, 300]);
  const [circle, line, arrow] = SigK.viewer.getAnnotations().added;
  assert.equal(circle.kind, 'circle');
  assert.equal(line.kind, 'line');
  line.paths[0][0].forEach((value, i) => near(value, [300, 700][i]));
  line.paths[0][1].forEach((value, i) => near(value, [100, 500][i]));
  near(line.rect[0], 99);
  near(line.rect[3], 701);
  assert.equal(arrow.kind, 'arrow');
  arrow.paths[0][1].forEach((value, i) => near(value, [300, 300][i]));
  // 矢じりの翼のぶんだけ /Rect が広い
  assert.ok(arrow.rect[1] < 299);
  assert.equal(pageNode(shell).querySelectorAll(`.annot-layer g[data-annot="${arrow.id}"] g.shape.arrow polyline`).length, 1);
  assert.equal(SigK.annotate.setShapeKind('ink'), false);
  assert.equal(SigK.annotateShape.getShapeKind(), 'arrow');
  assert.deepEqual(plain(shell.uiCalls.filter((call) => 'annotShapeKind' in call).map((call) => call.annotShapeKind)), ['circle', 'line', 'arrow']);
});

test('Shift で正方形・正円・45° 刻みになる', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  drag(shell, [100, 700], [200, 660], { shift: true });
  const square = SigK.viewer.getAnnotations().added[0];
  near(square.rect[2] - square.rect[0], square.rect[3] - square.rect[1]);
  near(square.rect[2] - square.rect[0], 100);
  SigK.annotate.setShapeKind('line');
  drag(shell, [100, 500], [200, 490], { shift: true });
  const line = SigK.viewer.getAnnotations().added[1];
  near(line.paths[0][1][1], 500, 0.1);
  near(line.paths[0][1][0], 100 + Math.hypot(100, 10), 0.1);
});

test('ペンでなぞると間引いた点列の Ink が 1 つできる', async (t) => {
  const shell = await withTool(t, 'pen');
  const { SigK } = shell;
  assert.equal(SigK.annotateShape.kindOfTool('pen'), 'ink');
  // 波形を 200 点（pt 刻み 1）で
  const via = Array.from({ length: 200 }, (_, i) => [100 + i, 500 + Math.sin(i / 8) * 20]);
  drag(shell, [100, 500], [300, 500 + Math.sin(200 / 8) * 20], { via });
  const { added } = SigK.viewer.getAnnotations();
  assert.equal(added.length, 1);
  const ink = added[0];
  assert.equal(ink.kind, 'ink');
  assert.equal(ink.color, '#d92c2c');
  assert.equal(ink.paths.length, 1);
  assert.ok(ink.paths[0].length >= 4 && ink.paths[0].length < 100, `点の数 ${ink.paths[0].length}`);
  ink.paths[0][0].forEach((value, i) => near(value, [100, 500][i]));
  assert.ok(ink.rect[0] <= 100 && ink.rect[2] >= 300);
  assert.equal(SigK.annotate.getSelected(), ink.id);
  assert.equal(pageNode(shell).querySelectorAll(`.annot-layer g[data-annot="${ink.id}"] polyline`).length, 1);
  // 2 回なぞれば 2 つ
  drag(shell, [100, 400], [200, 380], { via: [[150, 390]] });
  assert.equal(SigK.viewer.getAnnotations().added.length, 2);
});

test('紙の外で離しても描き終わり、閲覧モードでは何も起きない', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK, document } = shell;
  const viewport = viewportOf(shell);
  const [sx, sy] = viewport.convertToViewportPoint(100, 700);
  mouse(shell, 'mousedown', pageNode(shell), sx, sy);
  const [ex, ey] = viewport.convertToViewportPoint(200, 650);
  mouse(shell, 'mouseup', document.body, ex, ey);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotatePointer.isDrawing(), false);

  SigK.shell.setMode(document, 'view');
  drag(shell, [100, 300], [200, 200]);
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
});

// ---- 選ぶ・動かす・消す（確定事項5・12） ----

test('直線・矢印は線からの距離で選び、離れた点では選ばない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  // 読み込んだ矢印 (50,50)→(250,150) の中点の近く
  clickAt(shell, 150, 101);
  assert.equal(SigK.annotate.getSelected(), '31R');
  // 外接の中でも線から遠い点では選ばない
  clickAt(shell, 200, 60);
  assert.equal(SigK.annotate.getSelected(), null);
  // 矢じりの翼にも当たる
  const geo = SigK.shapeGeometry;
  const [wing] = geo.arrowHead([50, 50], [250, 150], 3);
  clickAt(shell, wing[0], wing[1]);
  assert.equal(SigK.annotate.getSelected(), '31R');
  // 他のツールの Line は拾っていないので選べない
  clickAt(shell, 150, 250);
  assert.equal(SigK.annotate.getSelected(), null);
});

test('選んだ図形を掴んでドラッグすると動き、1 世代積まれる', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK, document } = shell;
  drag(shell, [100, 700], [300, 600]);
  const entry = SigK.viewer.getAnnotations().added[0];
  SigK.annotate.setTool(null);
  const viewport = viewportOf(shell);
  const [sx, sy] = viewport.convertToViewportPoint(200, 650);
  const down = mouse(shell, 'mousedown', pageNode(shell), sx, sy);
  assert.equal(down.defaultPrevented, true);
  assert.equal(SigK.annotatePointer.isDragging(), true);
  const [ex, ey] = viewport.convertToViewportPoint(230, 610);
  mouse(shell, 'mousemove', document.body, ex, ey);
  mouse(shell, 'mouseup', pageNode(shell), ex, ey);
  const moved = SigK.viewer.getAnnotations().added[0];
  assert.equal(moved.id, entry.id);
  near(moved.rect[0], entry.rect[0] + 30);
  near(moved.rect[1], entry.rect[1] - 40);
  near(moved.rect[2], entry.rect[2] + 30);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  SigK.pageEdit.undo();
  near(SigK.viewer.getAnnotations().added[0].rect[0], entry.rect[0]);
});

test('道具を持ったままでも、選んでいる図形の上では描かずに動かす', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  drag(shell, [100, 700], [300, 600]);
  const entry = SigK.viewer.getAnnotations().added[0];
  drag(shell, [200, 650], [220, 640]);
  const { added } = SigK.viewer.getAnnotations();
  assert.equal(added.length, 1);
  near(added[0].rect[0], entry.rect[0] + 20);
});

test('読み込んだ矢印を動かすと写しが足され、点列も一緒にずれる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  assert.equal(SigK.annotateShape.move('31R', [10, 20]), true);
  const { added, removed } = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(removed), ['31R']);
  assert.equal(added.length, 1);
  assert.deepEqual(plain(added[0].paths), [[[60, 70], [260, 170]]]);
  near(added[0].rect[0], 58.5);
  assert.equal(added[0].kind, 'arrow');
  assert.equal(added[0].lineWidth, 3);
  assert.equal(SigK.annotate.getSelected(), added[0].id);
  // テキスト・マークアップは動かせない
  assert.equal(SigK.annotateShape.move('nothing', [1, 1]), false);
});

test('Delete で消え、Ctrl+Z で戻る', async (t) => {
  const shell = await withTool(t, 'pen');
  const { SigK } = shell;
  drag(shell, [100, 500], [200, 480], { via: [[150, 490]] });
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  assert.equal(SigK.annotate.remove(), true);
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.length, 1);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(SigK.viewer.isDirty(), false);
});

// ---- 太さ・色・種類（確定事項7・19） ----

test('線の太さは選んでいる図形を変えて /Rect を作り直し、無ければ次に描く太さとして覚える', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  SigK.annotate.setShapeKind('line');
  drag(shell, [100, 500], [300, 500]);
  const before = SigK.viewer.getAnnotations().added[0];
  near(before.rect[1], 499);
  assert.equal(SigK.annotate.setLineWidth(8), true);
  const after = SigK.viewer.getAnnotations().added[0];
  assert.equal(after.lineWidth, 8);
  near(after.rect[1], 496);
  assert.equal(SigK.annotateShape.getLineWidth(), 8);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotLineWidth: 8 });
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].lineWidth, 2);
  // 選んでいなければ次の太さだけ
  SigK.annotate.select(null);
  assert.equal(SigK.annotate.setLineWidth(3), true);
  assert.equal(SigK.annotate.setLineWidth(4), false);
  drag(shell, [100, 400], [300, 400]);
  assert.equal(SigK.viewer.getAnnotations().added[1].lineWidth, 3);
  // 同じ太さなら履歴に積まない
  const generations = SigK.pageEdit.canUndo();
  assert.equal(SigK.annotate.setLineWidth(3), true);
  assert.equal(SigK.pageEdit.canUndo(), generations);
});

test('色は図形とペンで別々に覚え、選んでいる図形の色を変えられる', async (t) => {
  const shell = await withTool(t, 'shape');
  const { SigK } = shell;
  assert.equal(SigK.annotate.setColor('#2c5cd9'), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotColors: { shape: '#2c5cd9' } });
  assert.equal(SigK.annotate.colorOf('pen'), '#d92c2c');
  assert.equal(SigK.annotate.colorOf('ink'), '#d92c2c');
  assert.equal(SigK.annotate.colorOf('arrow'), '#2c5cd9');
  drag(shell, [100, 700], [300, 600]);
  const entry = SigK.viewer.getAnnotations().added[0];
  assert.equal(entry.color, '#2c5cd9');
  assert.equal(SigK.annotate.setColor('#2f9e5a'), true);
  assert.equal(SigK.viewer.getAnnotations().added[0].color, '#2f9e5a');
  assert.equal(SigK.annotate.setColor('#ffe45a'), false);
  SigK.annotate.setTool('pen');
  drag(shell, [100, 400], [200, 380], { via: [[150, 390]] });
  assert.equal(SigK.viewer.getAnnotations().added[1].color, '#d92c2c');
});

test('覚えた太さと種類は起動時に戻る', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotLineWidth: 5, annotShapeKind: 'arrow' } });
  await shell.flush();
  assert.equal(shell.SigK.annotateShape.getLineWidth(), 5);
  assert.equal(shell.SigK.annotateShape.getShapeKind(), 'arrow');
});

// ---- 読み込み（確定事項13） ----

test('開くと Square と 2 点の PolyLine を読み込み、pdf.js には描かせず自前で描き、Line は表示のみ', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const imported = SigK.viewer.getImported();
  // Line は塊④で表示のみの entry として一覧に出る（spec-4-4 確定事項20）。紙の上には描かない。
  assert.deepEqual(plain(imported[0].map((entry) => [entry.ref, entry.kind, entry.lineWidth, entry.readonly === true])), [['30R', 'square', 4, false], ['31R', 'arrow', 3, false], ['32R', 'other', undefined, true]]);
  assert.equal(shell.pdfjs.documents.at(-1).annotationStorage.get('32R'), undefined);
  assert.deepEqual(plain(imported[0][1].paths), [[[50, 50], [250, 150]]]);
  const svg = pageNode(shell).querySelector('.annot-layer');
  assert.ok(svg.querySelector('g[data-annot="30R"] rect') !== null);
  assert.ok(svg.querySelector('g[data-annot="31R"] polyline') !== null);
  assert.equal(svg.querySelector('g[data-annot="32R"]'), null);
  // 選ぶとプロパティに種類・太さ・ページが出て、削除できる
  SigK.annotate.select('30R');
  assert.equal(shell.document.getElementById('props-kind').textContent, '矩形');
  assert.equal(shell.document.getElementById('props-width').value, '4');
  assert.equal(shell.document.getElementById('props-width-row').hidden, false);
  assert.equal(shell.document.getElementById('props-shape-row').hidden, true);
  assert.equal(SigK.annotate.remove(), true);
  assert.deepEqual(plain(SigK.viewer.getAnnotations().removed), ['30R']);
  assert.deepEqual(plain(SigK.annotationState.toSaveSpec(SigK.viewer.getAnnotations())), { add: [], remove: ['30R'] });
});

// ---- 右パネル（確定事項2） ----

test('右パネルは道具に応じて「図形の種類」「線の太さ」の行を出し入れする', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const shapeRow = document.getElementById('props-shape-row');
  const widthRow = document.getElementById('props-width-row');
  assert.equal(shapeRow.hidden, true);
  assert.equal(widthRow.hidden, true);
  SigK.annotate.setTool('shape');
  assert.equal(shapeRow.hidden, false);
  assert.equal(widthRow.hidden, false);
  assert.equal(document.getElementById('props-kind').textContent, '図形（次に付ける）');
  assert.equal(document.getElementById('props-width').value, '2');
  const buttons = [...document.querySelectorAll('#props-shape-kinds button')];
  assert.deepEqual(buttons.map((button) => button.dataset.kind), ['square', 'circle', 'line', 'arrow']);
  assert.deepEqual(buttons.map((button) => button.classList.contains('on')), [true, false, false, false]);
  assert.ok(buttons[0].querySelector('svg') !== null);
  assert.match(document.getElementById('props-hint').textContent, /ドラッグ/);
  buttons[3].click();
  assert.equal(SigK.annotateShape.getShapeKind(), 'arrow');
  assert.deepEqual(buttons.map((button) => button.classList.contains('on')), [false, false, false, true]);
  // 線の太さの select
  const width = document.getElementById('props-width');
  assert.deepEqual([...width.options].map((option) => option.value), ['1', '2', '3', '5', '8']);
  width.value = '5';
  width.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotateShape.getLineWidth(), 5);
  // ペンは種類の行が無い
  SigK.annotate.setTool('pen');
  assert.equal(shapeRow.hidden, true);
  assert.equal(widthRow.hidden, false);
  assert.equal(document.getElementById('props-kind').textContent, 'ペン（次に付ける）');
  assert.match(document.getElementById('props-hint').textContent, /なぞる/);
  // 色の丸は 4 つ
  assert.equal(document.querySelectorAll('#props-colors .swatch').length, 4);
  SigK.annotate.setTool(null);
  assert.equal(widthRow.hidden, true);
});

test('プリセットに無い太さの図形を選ぶと、その値の選択肢が足される', async (t) => {
  const shell = await withShell(t, { stub: { annotations: { 0: [{ id: '33R', subtype: 'Circle', rect: [0, 0, 50, 50], color: new Uint8ClampedArray([0, 0, 0]), borderStyle: { width: 1.5 } }] } } });
  const { SigK, document } = shell;
  SigK.annotate.select('33R');
  const width = document.getElementById('props-width');
  assert.equal(width.value, '1.5');
  assert.equal(width.querySelectorAll('option').length, 6);
  SigK.annotate.select(null);
  SigK.annotate.setTool('pen');
  assert.equal(width.querySelectorAll('option').length, 5);
});
