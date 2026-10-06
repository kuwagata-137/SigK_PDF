'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 切った範囲を画面へ映す経路（spec-4b-6a 確定事項5〜8・25）。plan の crop を当てると、ページの器の大きさ・描く viewport・
// 文字の層・サムネイル・印刷・紙の範囲（テキストの自動の幅）が、どれも切った範囲になる。

const CROP = [100, 200, 400, 600];

async function withOpenDocument(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  return shell;
}

function withCrop(SigK, index, box) {
  return SigK.pagePlan.cropPages(SigK.viewer.getPlan(), new Map([[index, (entry) => ({ ...entry, crop: box })]]));
}

function nodeSize(document, index) {
  const node = document.querySelectorAll('#view-pages .pdf-page')[index];
  return { width: Number.parseFloat(node.style.width), height: Number.parseFloat(node.style.height) };
}

test('切ったページの器は切った範囲の大きさになり、ほかのページは変わらない', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t);
  const before = nodeSize(document, 0);
  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  await flush();

  const after = nodeSize(document, 0);
  assert.ok(Math.abs(after.width / before.width - 300 / A4.width) < 0.01, `幅 ${after.width} / ${before.width}`);
  assert.ok(Math.abs(after.height / before.height - 400 / A4.height) < 0.01, `高さ ${after.height} / ${before.height}`);
  assert.deepEqual(nodeSize(document, 1), before);
});

test('回したページでは切った範囲の幅と高さが入れ替わる', async (t) => {
  const { document, SigK, flush } = await withOpenDocument(t);
  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  await flush();
  const upright = nodeSize(document, 0);
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  await flush();
  const turned = nodeSize(document, 0);
  assert.equal(turned.width, upright.height);
  assert.equal(turned.height, upright.width);
});

test('文字の層の viewport は切った範囲の箱で、座標の往復が箱の原点からになる', async (t) => {
  const { SigK, flush } = await withOpenDocument(t);
  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  await flush();
  const viewport = SigK.viewer.getTextLayer(0)?.viewport;
  assert.ok(viewport, '文字の層が描かれていない');
  assert.deepEqual([...viewport.viewBox], CROP);
  // 箱の左上（100, 600）が器の左上（0, 0）に来る。
  const [x, y] = viewport.convertToViewportPoint(100, 600);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9, `${x}, ${y}`);
});

test('印刷は切った範囲で描く', async (t) => {
  const { SigK, flush } = await withOpenDocument(t);
  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  await flush();
  SigK.print.open();
  const prepared = await SigK.print.prepare({ mode: 'current' });
  const scale = SigK.print.PRINT_SCALE;
  assert.equal(prepared.ok, true);
  assert.equal(prepared.images[0].width, Math.round(300 * scale));
  assert.equal(prepared.images[0].height, Math.round(400 * scale));
});

test('紙の範囲（テキストの自動の幅の上限）は切った範囲を返す', async (t) => {
  const { SigK, flush } = await withOpenDocument(t);
  assert.deepEqual([...SigK.viewer.getPaperBox(0)], [0, 0, A4.width, A4.height]);
  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  await flush();
  assert.deepEqual([...SigK.viewer.getPaperBox(0)], CROP);
  assert.deepEqual([...SigK.viewer.getPaperBox(1)], [0, 0, A4.width, A4.height]);
});

test('UserUnit が 1 でないページは、切った範囲の寸法にも UserUnit を掛け、回したら幅と高さを入れ替える', async (t) => {
  const shell = await createShell({ pdfjs: createPdfjsStub({ userUnits: [2, 1, 1], rotations: [90, 0, 0] }) });
  t.after(() => shell.cleanup());
  const { SigK } = shell;
  await SigK.viewer.open(makeSource());
  await shell.flush();
  assert.deepEqual({ ...SigK.viewer.getSizes()[0] }, { width: A4.height * 2, height: A4.width * 2 });

  SigK.viewer.applyPlan(withCrop(SigK, 0, CROP));
  // 300pt × 400pt を UserUnit 2 で 600 × 800、/Rotate 90 で入れ替えて 800 × 600。
  assert.deepEqual({ ...SigK.viewer.getSizes()[0] }, { width: 800, height: 600 });
  assert.deepEqual({ ...SigK.viewer.getSizes()[1] }, { width: A4.width, height: A4.height });
});
