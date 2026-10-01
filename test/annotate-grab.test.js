'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 選んでいる書き込みを掴んでまとめて動かす（spec-4b-3a 確定事項F・B6）。1 件の動かし方は annotate-shape・annotate-text・annotate-note の
// テストが見る。jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

// 1 ページ目に読み込んだハイライト（12R。動かせない）と四角（40R。直すと写しに替わる）。
const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '40R', subtype: 'Square', rect: [399, 199, 501, 301], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 2 }, hasAppearance: true },
  ],
};

async function withShell(t, stub = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED, ...stub }),
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

function mouse(shell, type, target, [x, y], { shift = false, ctrl = false } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, shiftKey: shift, ctrlKey: ctrl });
  target.dispatchEvent(event);
  return event;
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  const tool = SigK.annotate.getTool();
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, from));
  mouse(shell, 'mousemove', shell.document.body, px(shell, to));
  mouse(shell, 'mouseup', pageNode(shell), px(shell, to));
  SigK.annotate.setTool(tool);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

// 表示の px で at から delta だけ引く。release=false なら離さない。
function dragPx(shell, at, delta, { release = true, ...keys } = {}) {
  const to = [at[0] + delta[0], at[1] + delta[1]];
  const down = mouse(shell, 'mousedown', pageNode(shell), at, keys);
  mouse(shell, 'mousemove', shell.document.body, to, keys);
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), to, keys);
  return down;
}

const rectOf = (shell, key) => {
  const { SigK } = shell;
  return [...SigK.annotationState.findAnnot(SigK.viewer.getAnnotations(), SigK.viewer.getImported(), key).rect];
};
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 0.05, `${actual} は ${expected} に近くない`));

test('選んでいる書き込みの 1 つを掴んで引くと、選んだ全部が同じだけ動き、1 世代で、選択はそのまま（確定事項F3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  const scale = viewport(shell).scale;
  const at = SigK.pageEdit.getHistoryState().at;
  dragPx(shell, px(shell, [150, 700]), [50 * scale, 20 * scale]);
  near(rectOf(shell, a), [150, 580, 250, 680]);
  near(rectOf(shell, b), [350, 580, 450, 680]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  assert.deepEqual([...SigK.annotate.getSelection()], [a, b]);
  SigK.pageEdit.undo();
  near(rectOf(shell, a), [100, 600, 200, 700]);
  assert.deepEqual([...SigK.annotate.getSelection()], [a, b]);
});

test('動かせない書き込み（マークアップ）が混ざっていても、動かせるものだけが動く（確定事項F1・決定53 ③）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.selectKeys(['12R', a]);
  const scale = viewport(shell).scale;
  dragPx(shell, px(shell, [150, 700]), [0, 40 * scale]);
  near(rectOf(shell, a), [100, 560, 200, 660]);
  near(rectOf(shell, '12R'), [48, 300, 232, 310]);
  assert.deepEqual([...SigK.annotate.getSelection()], ['12R', a]);
});

test('押した書き込みそのものが動かせないなら掴まない（確定事項F2）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.selectKeys([a, '12R']);
  dragPx(shell, px(shell, [100, 305]), [30, 0], { release: false });
  assert.equal(SigK.annotatePointer.isDragging(), false);
});

test('読み込んだ書き込みはまとめて動かすと写しに替わり、選択は新しい鍵になる', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.selectKeys([a, '40R']);
  const scale = viewport(shell).scale;
  dragPx(shell, px(shell, [150, 700]), [10 * scale, 0]);
  const keys = [...SigK.annotate.getSelection()];
  assert.equal(keys.length, 2);
  assert.equal(keys[0], a);
  assert.notEqual(keys[1], '40R');
  near(rectOf(shell, keys[1]).map(Math.round), [409, 199, 511, 301].map(Math.round));
  assert.ok(SigK.viewer.getAnnotations().removed.includes('40R'));
});

test('Shift を押しながら引くと、画面の px で動きの大きい方の向きだけ動く（等しいときは横。確定事項F5）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const scale = viewport(shell).scale;
  // 押すのは上の辺の、つまみ（四隅と辺の中点）から外れた所。
  dragPx(shell, px(shell, [125, 700]), [40 * scale, 10 * scale], { shift: true });
  near(rectOf(shell, a), [140, 600, 240, 700]);
  dragPx(shell, px(shell, [165, 700]), [5 * scale, -30 * scale], { shift: true });
  near(rectOf(shell, a), [140, 630, 240, 730]);
  dragPx(shell, px(shell, [165, 730]), [20 * scale, 20 * scale], { shift: true });
  near(rectOf(shell, a), [160, 630, 260, 730]);
});

test('引いている途中で Shift を押すと、マウスを動かさなくても横か縦にそろう（確定事項F5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  dragPx(shell, px(shell, [125, 700]), [40, 10], { release: false });
  const group = pageNode(shell).querySelector(`.annot-layer g[data-annot="${a}"]`);
  assert.equal(group.style.transform, 'translate(40px, 10px)');
  document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  assert.equal(group.style.transform, 'translate(40px, 0px)');
  document.dispatchEvent(new shell.window.KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  assert.equal(group.style.transform, 'translate(40px, 10px)');
  SigK.annotate.escape();
});

test('動かしている間は、動かせる書き込みの <g> と枠の組だけがずれ、カーソルは move（確定事項F3・F6）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.selectKeys(['12R', a]);
  dragPx(shell, px(shell, [150, 700]), [30, 15], { release: false });
  const frameOf = (key) => document.querySelector(`.annot-frame-group[data-frame-key="${key}"]`).style.transform;
  assert.equal(frameOf(a), 'translate(30px, 15px)');
  assert.equal(frameOf('12R'), '');
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), 'move');
  mouse(shell, 'mouseup', pageNode(shell), [px(shell, [150, 700])[0] + 30, px(shell, [150, 700])[1] + 15]);
  assert.equal(document.documentElement.hasAttribute('data-transform-cursor'), false);
  assert.equal(frameOf(a), '');
});

test('Esc で取りやめると元の位置に戻り、世代は積まれない（確定事項M）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const at = SigK.pageEdit.getHistoryState().at;
  dragPx(shell, px(shell, [125, 700]), [40, 10], { release: false });
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotatePointer.isDragging(), false);
  assert.equal(pageNode(shell).querySelector(`.annot-layer g[data-annot="${a}"]`).style.transform, '');
  mouse(shell, 'mouseup', pageNode(shell), [0, 0]);
  near(rectOf(shell, a), [100, 600, 200, 700]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  assert.equal(SigK.annotate.getSelected(), a, 'Esc 1 回目は取りやめだけで、選択は残る');
});

test('「選択」の道具なら、選んでいない書き込みを押してそのまま引くと 1 段で動く（決定53 ⑨）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.setTool('select');
  const scale = viewport(shell).scale;
  dragPx(shell, px(shell, [150, 700]), [20 * scale, 0]);
  near(rectOf(shell, a), [120, 600, 220, 700]);
  assert.equal(SigK.annotate.getSelected(), a);
});

test('道具なしのときは、選んでいない書き込みを押して引いても動かない（今までどおり 2 段）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const scale = viewport(shell).scale;
  dragPx(shell, px(shell, [150, 700]), [20 * scale, 0]);
  near(rectOf(shell, a), [100, 600, 200, 700]);
});

test('回ったページでも、Shift は画面の横・縦でそろう（確定事項F5）', async (t) => {
  const shell = await withShell(t, { rotations: { 0: 90 } });
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const before = rectOf(shell, a);
  const scale = viewport(shell).scale;
  const at = px(shell, [150, 650]);
  // 画面で右へ大きく、下へ少し。回ったページなので、紙の座標では片方の軸だけが変わる。
  dragPx(shell, at, [30 * scale, 5 * scale], { shift: true });
  const after = rectOf(shell, a);
  const moved = after.map((value, index) => Math.round((value - before[index]) * 100) / 100);
  assert.ok((moved[0] === 0 && moved[2] === 0) !== (moved[1] === 0 && moved[3] === 0), `片方の軸だけ動く: ${moved}`);
  assert.ok(Math.abs(Math.abs(moved[0] + moved[1]) - 30) <= 0.05, `30pt 動く: ${moved}`);
});
