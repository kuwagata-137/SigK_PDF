'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 編集モードで紙の上を左ボタンで押したときの振り分け（annotate-press.js）のうち、選んでいない書き込みをドラッグで動かせる道具と、
// 押せば書き込みを掴む所の判定（grabsAt。十字矢印のカーソルとハンドの振り分けが使う）を見る（決定84）。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

// 1 ページ目に読み込んだハイライト（12R。動かせない）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
  ],
};

// 四角 [100, 600, 200, 700] の上の辺の上（つまみの四隅と辺の中点から外れた所）と、内側。
const LINE = [125, 700];
const INSIDE = [150, 650];

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
const viewport = (shell) => shell.SigK.viewer.getTextLayer(0).viewport;
const px = (shell, point) => viewport(shell).convertToViewportPoint(point[0], point[1]);

function mouse(shell, type, target, [x, y], { ctrl = false } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey: ctrl });
  target.dispatchEvent(event);
  return event;
}

// 図形の道具で四角（塗りなし・線の太さ 2）を描き、道具なし・選択なしに戻す。
function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

// 紙の点（pt）から表示の px で delta だけドラッグする。
function drag(shell, point, delta) {
  const at = px(shell, point);
  const to = [at[0] + delta[0], at[1] + delta[1]];
  mouse(shell, 'mousedown', pageNode(shell), at);
  mouse(shell, 'mousemove', shell.document.body, to);
  mouse(shell, 'mouseup', pageNode(shell), to);
}

function click(shell, point) {
  mouse(shell, 'mousedown', pageNode(shell), px(shell, point));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, point));
}

const rectOf = (shell, key) => {
  const { SigK } = shell;
  return [...SigK.annotationState.findAnnot(SigK.viewer.getAnnotations(), SigK.viewer.getImported(), key).rect];
};
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 0.05, `${actual} は ${expected} に近くない`));
const addedCount = (shell) => shell.SigK.viewer.getAnnotations().added.length;

test('「図形」の道具で、選んでいない四角の線をドラッグすると、選んで動かし、新しい図形は描かない（決定84 ④）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('shape');
  drag(shell, LINE, [20 * viewport(shell).scale, 0]);
  near(rectOf(shell, a), [120, 600, 220, 700]);
  assert.equal(SigK.annotate.getSelected(), a);
  assert.equal(addedCount(shell), 1);
  assert.equal(SigK.annotate.getTool(), 'shape', '道具は持ったまま');
});

test('「図形」の道具で、塗っていない四角の内側をドラッグすると新しい図形を描き、塗った四角なら内側でも動かす（決定84 ②）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const scale = viewport(shell).scale;
  SigK.annotate.setTool('shape');
  drag(shell, [120, 680], [20 * scale, 20 * scale]);
  assert.equal(addedCount(shell), 2, '内側から新しい四角を描いた');
  near(rectOf(shell, a), [100, 600, 200, 700]);
  SigK.annotate.select(a);
  assert.equal(SigK.annotate.setFill('#00ff00'), true);
  SigK.annotate.select(null);
  drag(shell, [170, 630], [10 * scale, 0]);
  near(rectOf(shell, a), [110, 600, 210, 700]);
  assert.equal(addedCount(shell), 2);
});

test('「図形」の道具で、塗っていない四角の内側をクリックすると、何も無い所のクリックと同じく選択を外す（決定84 ②）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  SigK.annotate.setTool('shape');
  click(shell, INSIDE);
  assert.deepEqual([...SigK.annotate.getSelection()], []);
  assert.equal(addedCount(shell), 1);
  click(shell, LINE);
  assert.equal(SigK.annotate.getSelected(), a, '線の上のクリックでは選ぶ');
});

test('「道具なし」「テキスト」「吹き出し」「ノート」の道具でも、選んでいない書き込みをドラッグするとそのまま動かす（決定84 ④）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const scale = viewport(shell).scale;
  let x = 100;
  for (const tool of [null, 'text', 'callout', 'note']) {
    SigK.annotate.setTool(tool);
    SigK.annotate.select(null);
    drag(shell, [x + 25, 700], [10 * scale, 0]);
    x += 10;
    near(rectOf(shell, a), [x, 600, x + 100, 700]);
    assert.equal(SigK.annotate.getSelected(), a, `道具 ${tool}`);
  }
  assert.equal(addedCount(shell), 1, 'テキスト・ノートは置かない');
});

test('ペン・マーカー・ハイライトの道具では今までどおり、選んでいない書き込みはドラッグしても動かさず、選んでいれば動かす（決定84 ④）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const scale = viewport(shell).scale;
  for (const tool of ['pen', 'marker', 'highlight']) {
    SigK.annotate.setTool(tool);
    SigK.annotate.select(null);
    drag(shell, LINE, [10 * scale, 0]);
    near(rectOf(shell, a), [100, 600, 200, 700]);
  }
  assert.equal(addedCount(shell), 3, 'ペンとマーカーは線を描いた');
  // ペンとマーカーの線が LINE の上に重なったので、重ならない所を押す。
  SigK.annotate.setTool('pen');
  SigK.annotate.select(a);
  drag(shell, [175, 700], [10 * scale, 0]);
  near(rectOf(shell, a), [110, 600, 210, 700]);
  assert.equal(addedCount(shell), 3);
});

test('動かせない書き込み（ハイライト）の上では、「図形」の道具は今までどおり描き、ハイライトを選ばない（決定84）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const scale = viewport(shell).scale;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  drag(shell, [100, 305], [30 * scale, 30 * scale]);
  assert.equal(addedCount(shell), 1);
  assert.equal(SigK.annotate.getSelection().includes('12R'), false);
});

test('grabsAt は、押せば書き込みを掴む所でだけ真になる（十字矢印のカーソルとハンドの振り分けが使う。決定84）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const grabs = (point, { ctrl = false } = {}) => {
    const [x, y] = px(shell, point);
    return SigK.annotatePress.grabsAt({ target: pageNode(shell), clientX: x, clientY: y, ctrlKey: ctrl });
  };
  for (const tool of ['select', null, 'text', 'callout', 'note', 'shape', 'hand'])
    assert.equal((SigK.annotate.setTool(tool), grabs(LINE)), true, `道具 ${tool} で線の上`);
  SigK.annotate.setTool('select');
  assert.equal(grabs(INSIDE), true, '「選択」は内側も');
  assert.equal(grabs([300, 400]), false, '何も無い所');
  assert.equal(grabs([100, 305]), false, '動かせない書き込み');
  for (const tool of ['shape', 'hand'])
    assert.equal((SigK.annotate.setTool(tool), grabs(INSIDE)), false, `道具 ${tool} で内側`);
  SigK.annotate.setTool('pen');
  assert.equal(grabs(LINE), false, 'ペンは選んでいない書き込みを掴まない');
  assert.equal(grabs(LINE, { ctrl: true }), true, 'Ctrl なら足して掴む');
  SigK.annotate.select(a);
  assert.equal(grabs(LINE), true, '選んでいれば掴む');
  for (const tool of ['eraser', 'mosaic', 'trim']) {
    SigK.annotate.setTool(tool);
    SigK.annotate.select(a);
    assert.equal(grabs(LINE), false, `道具 ${tool}`);
  }
  assert.equal(SigK.annotatePress.grabsAt({ target: shell.document.body, clientX: 10, clientY: 10, ctrlKey: false }), false, '紙の外');
});

test('grabsAt は、多角形を描いている途中は偽になる（押すと頂点を置くため。決定84）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('polygon');
  click(shell, [300, 400]);
  assert.equal(SigK.annotatePlacing.isActive(), true);
  const [x, y] = px(shell, LINE);
  assert.equal(SigK.annotatePress.grabsAt({ target: pageNode(shell), clientX: x, clientY: y, ctrlKey: false }), false);
  SigK.annotate.escape();
});
