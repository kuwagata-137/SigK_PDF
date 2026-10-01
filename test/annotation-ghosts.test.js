'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// Ctrl＋ドラッグで写しを作る（spec-4b-3a 確定事項G。モック screenshots/phase4b-3-copy.png）。写しの絵は annotation-ghosts.js、
// 写しを足すのは annotate-bulk.js（copySelected）。jsdom はレイアウトしないので、clientX/Y がそのまま .pdf-page 基準の CSS px。

const A = 'C:\\work\\a.pdf';

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
const viewport = (shell) => shell.SigK.viewer.getTextLayer(0).viewport;
const px = (shell, point) => viewport(shell).convertToViewportPoint(point[0], point[1]);

function mouse(shell, type, target, [x, y], { ctrl = false, shift = false } = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey: ctrl, shiftKey: shift }));
}

function key(shell, type, name) {
  shell.document.dispatchEvent(new shell.window.KeyboardEvent(type, { key: name, bubbles: true }));
}

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

// 表示の px で at から delta だけ引く。keys は押し・動き・離しに付ける修飾キー。
function dragPx(shell, at, delta, { release = true, down = {}, moveKeys = down, up = moveKeys } = {}) {
  const to = [at[0] + delta[0], at[1] + delta[1]];
  mouse(shell, 'mousedown', pageNode(shell), at, down);
  mouse(shell, 'mousemove', shell.document.body, to, moveKeys);
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), to, up);
  return to;
}

const added = (shell) => [...shell.SigK.viewer.getAnnotations().added];
const near = (actual, expected) => [...actual].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 0.05, `${[...actual]} は ${expected} に近くない`));

test('選んでいる書き込みを Ctrl を押しながら引くと、元は残り、写しが最前面に足され、選択は写しになる。1 世代（確定事項G1・G3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  drawSquare(shell, [300, 500], [400, 400]);
  SigK.annotate.select(a);
  const scale = viewport(shell).scale;
  const at = SigK.pageEdit.getHistoryState().at;
  dragPx(shell, px(shell, [125, 700]), [50 * scale, 20 * scale], { down: { ctrl: true } });
  const list = added(shell);
  assert.equal(list.length, 3);
  near(list[0].rect, [100, 600, 200, 700]);
  near(list.at(-1).rect, [150, 580, 250, 680]);
  assert.deepEqual([...SigK.annotate.getSelection()], [list.at(-1).id]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  SigK.pageEdit.undo();
  assert.equal(added(shell).length, 2);
  assert.deepEqual([...SigK.annotate.getSelection()], [a]);
});

test('複数を Ctrl＋ドラッグすると、動かせるものだけ写し、マークアップは写さない（確定事項G3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.selectKeys(['12R', a, '40R']);
  dragPx(shell, px(shell, [150, 700]), [0, 30], { down: { ctrl: true } });
  const copies = added(shell).slice(1);
  assert.equal(copies.length, 2);
  assert.equal(copies.some((entry) => entry.kind === 'highlight'), false);
  assert.equal(copies.every((entry) => entry.ref === undefined), true, '読み込んだものの参照は写さない');
  assert.equal(SigK.viewer.getAnnotations().removed.includes('40R'), false, '読み込んだ元は残る');
  assert.equal(SigK.annotate.getSelection().length, 2);
});

test('引いている途中で Ctrl を押すと写しを作る形に、離すと動かす形に戻る（確定事項G1・G2）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  dragPx(shell, px(shell, [125, 700]), [40, 10], { release: false });
  const group = pageNode(shell).querySelector(`.annot-layer g[data-annot="${a}"]`);
  assert.equal(group.style.transform, 'translate(40px, 10px)');
  key(shell, 'keydown', 'Control');
  assert.equal(group.style.transform, '', '元は元の位置に戻る');
  const ghost = pageNode(shell).querySelector('.annot-layer .annot-ghost');
  assert.notEqual(ghost, null);
  assert.equal(ghost.hasAttribute('data-annot'), false);
  assert.equal(ghost.style.transform, 'translate(40px, 10px)');
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), 'copy');
  assert.equal(document.querySelector(`.annot-frame-group[data-frame-key="${a}"]`).style.transform, 'translate(40px, 10px)', '枠は写しに付いていく');
  key(shell, 'keyup', 'Control');
  assert.equal(pageNode(shell).querySelector('.annot-layer .annot-ghost'), null);
  assert.equal(group.style.transform, 'translate(40px, 10px)');
  assert.equal(document.documentElement.getAttribute('data-transform-cursor'), 'move');
  mouse(shell, 'mouseup', pageNode(shell), [px(shell, [125, 700])[0] + 40, px(shell, [125, 700])[1] + 10]);
  assert.equal(added(shell).length, 1, '動かす形で離したので写しは無い');
});

test('Ctrl で選んでいない書き込みを押してそのまま引くと、足したものを含めた全部の写しを作る（確定事項B3・G1）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  const b = drawSquare(shell, [300, 700], [400, 600]);
  SigK.annotate.select(a);
  dragPx(shell, px(shell, [350, 700]), [0, 40], { down: { ctrl: true } });
  assert.equal(added(shell).length, 4);
  assert.equal(SigK.annotate.isSelected(a), false);
  assert.equal(SigK.annotate.isSelected(b), false);
  assert.equal(SigK.annotate.getSelection().length, 2);
});

test('Esc で取りやめると写しの絵は消え、何も足されない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  dragPx(shell, px(shell, [125, 700]), [40, 10], { release: false, down: { ctrl: true } });
  assert.notEqual(pageNode(shell).querySelector('.annot-ghost'), null);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(pageNode(shell).querySelector('.annot-ghost'), null);
  mouse(shell, 'mouseup', pageNode(shell), [0, 0], { ctrl: true });
  assert.equal(added(shell).length, 1);
});

test('Ctrl を押しながらつまみを引くと、写しではなく大きさが変わる（確定事項G4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const scale = viewport(shell).scale;
  // 上の辺の中点のつまみ。
  dragPx(shell, px(shell, [150, 700]), [0, -20 * scale], { down: { ctrl: true } });
  assert.equal(added(shell).length, 1);
  near(added(shell)[0].rect, [100, 600, 200, 720]);
  assert.equal(pageNode(shell).querySelector('.annot-ghost'), null);
});

test('Ctrl＋ドラッグでも、Shift を押していれば横か縦だけずれる（確定事項G5）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 600]);
  SigK.annotate.select(a);
  const scale = viewport(shell).scale;
  dragPx(shell, px(shell, [125, 700]), [30 * scale, 8 * scale], { down: { ctrl: true, shift: true } });
  near(added(shell).at(-1).rect, [130, 600, 230, 700]);
});
