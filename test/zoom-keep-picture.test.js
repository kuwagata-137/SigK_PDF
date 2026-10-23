'use strict';

// 倍率を変えたとき、新しい絵ができるまで前の絵を残す（2026-10-23 ユーザーの報告「ハンドでズームすると一瞬真っ白になる」）。
// 前は setZoom が各ページの枠を空にしてから描き直していたので、pdf.js が描き終えるまで紙の白い地が見えていた。
// 今は前の倍率の絵（canvas）と書き込みの層（svg.annot-layer）を枠に残し、枠いっぱいに引き伸ばして見せる。
// jsdom には 2D コンテキストが無いので、テストの中だけ「描ける」ことにして canvas を貼らせる。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

async function withOpenDocument(t, { sizes = [A4, A4, A4] } = {}) {
  const shell = await createShell({ pdfjs: createPdfjsStub({ sizes }) });
  t.after(() => shell.cleanup());
  shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  shell.window.HTMLCanvasElement.prototype.getContext = () => ({});
  await shell.flush();
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\zoom.pdf' }));
  await settle(shell);
  return shell;
}

// 描き直しは requestAnimationFrame の後で、pdf.js の待ちを何段か挟む。
async function settle(shell) {
  await shell.flush();
  await shell.flush();
}

function pageNode(shell, index) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function pictureOf(node) {
  return node.querySelector(':scope > canvas');
}

function layerOf(node) {
  return node.querySelector(':scope > svg.annot-layer');
}

// canvas を抱えているページの index。
function pagesWithPicture(shell) {
  return [...shell.document.querySelectorAll('.pdf-page')]
    .filter((node) => pictureOf(node) !== null)
    .map((node) => Number(node.dataset.page) - 1);
}

test('倍率を変えた直後も、新しい絵ができるまで前の絵と書き込みの層をページに残す', async (t) => {
  const shell = await withOpenDocument(t);
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  const layer = layerOf(node);
  assert.ok(picture !== null, '開いた時点で絵が無い');
  assert.ok(layer !== null, '開いた時点で書き込みの層が無い');
  const width = layer.getAttribute('width');
  const height = layer.getAttribute('height');

  shell.SigK.viewer.setZoom(2);

  assert.equal(pictureOf(node), picture, '倍率を変えた直後に絵が消えた（描き終えるまで白くなる）');
  assert.equal(layerOf(node), layer, '倍率を変えた直後に書き込みの層が消えた');
  // 書き込みの層は前の倍率の座標のまま、枠いっぱいに引き伸ばす。
  assert.equal(layer.getAttribute('viewBox'), `0 0 ${width} ${height}`);
  assert.equal(layer.getAttribute('width'), '100%');
  assert.equal(layer.getAttribute('height'), '100%');
  assert.equal(layer.getAttribute('preserveAspectRatio'), 'none');
  // 文字の層は目に見えないので、今までどおり作り直す（spec-1-3 確定事項22）。
  assert.equal(node.querySelector('.textLayer'), null);
});

test('新しい絵ができたら前の絵と入れ替え、絵も書き込みの層も 1 枚ずつになる', async (t) => {
  const shell = await withOpenDocument(t);
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);

  shell.SigK.viewer.setZoom(2);
  await settle(shell);

  assert.equal(node.querySelectorAll(':scope > canvas').length, 1);
  assert.notEqual(pictureOf(node), picture, '前の絵のまま');
  assert.equal(node.querySelectorAll(':scope > svg.annot-layer').length, 1);
  assert.notEqual(layerOf(node).getAttribute('width'), '100%', '書き込みの層が引き伸ばした前のもののまま');
  assert.equal(layerOf(node).hasAttribute('viewBox'), false);
});

test('続けて倍率を変えても、残した絵は 1 枚のまま、最初の大きさで引き伸ばす', async (t) => {
  const shell = await withOpenDocument(t);
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  const layer = layerOf(node);
  const viewBox = `0 0 ${layer.getAttribute('width')} ${layer.getAttribute('height')}`;

  shell.SigK.viewer.setZoom(1.5);
  shell.SigK.viewer.setZoom(2);

  assert.equal(pictureOf(node), picture);
  assert.equal(node.querySelectorAll(':scope > canvas').length, 1);
  assert.equal(layer.getAttribute('viewBox'), viewBox);
});

test('倍率を変えたあと描く範囲から外れたページには、前の絵を残さない', async (t) => {
  const sizes = Array.from({ length: 40 }, () => A4);
  const shell = await withOpenDocument(t, { sizes });
  const { SigK } = shell;
  SigK.viewer.goToPage(20);
  await settle(shell);
  const before = pagesWithPicture(shell);
  assert.ok(before.includes(20), `20 ページ目に絵が無い: ${before}`);

  // 残した直後に、遠いページへ移る。
  SigK.viewer.setZoom(2);
  SigK.viewer.goToPage(0);
  await settle(shell);

  const rendered = [...SigK.viewer.getState().rendered];
  const after = pagesWithPicture(shell);
  assert.equal(after.includes(20), false, `範囲の外の 20 ページ目に前の絵が残っている: ${after}`);
  for (const index of after)
    assert.ok(rendered.includes(index), `描いていないページ ${index} に絵が残っている: ${after} / ${rendered}`);
});

test('前の絵を残した直後に文書を閉じても、並びを変えても、前の絵は残らない', async (t) => {
  const shell = await withOpenDocument(t);
  const { SigK } = shell;

  SigK.viewer.setZoom(2);
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  assert.deepEqual(pagesWithPicture(shell), [], '並びを変えたのに前の絵が残っている');
  await settle(shell);

  SigK.viewer.setZoom(1.5);
  SigK.viewer.close();
  assert.equal(shell.document.querySelectorAll('.pdf-page canvas').length, 0, '閉じたのに前の絵が残っている');
});

test('見開きに切り替えて倍率が変わるときも、前の絵を残す', async (t) => {
  const shell = await withOpenDocument(t, { sizes: [A4, A4, A4, A4, A4] });
  const { SigK, document } = shell;
  SigK.viewer.applyFit('width');
  await settle(shell);
  const zoom = SigK.viewer.getState().zoom;
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  assert.ok(picture !== null);

  SigK.shell.setPageLayout(document, 'facing');

  assert.notEqual(SigK.viewer.getState().zoom, zoom, '見開きにしても倍率が変わらない（このテストの前提が崩れた）');
  assert.equal(pictureOf(node), picture, '見開きに切り替えた直後に絵が消えた');
});
