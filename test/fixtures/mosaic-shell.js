'use strict';

// モザイクの保存の画面のテストの土台（mosaic-save.test.js・mosaic-save-guard.test.js）。jsdom には 2D コンテキストが無いので、描く部品
// （pageImage.renderToCanvas・toBytes）を差し替えて、確認・ワーカーへ渡す spec・帯を見る。

const { createShell, makeSource } = require('../harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const PAPER = [0, 0, 595.28, 841.89];
const MOSAIC = [{ box: [100, 200, 300, 400], block: 8 }];

// a.pdf を開き、pages（表示上の位置）にモザイクを置いた殻。options は createShell へそのまま渡す（files を渡せば a.pdf に足す）。
async function withMosaic(t, options = {}, pages = [0]) {
  const { files = {}, ...rest } = options;
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }), ...files },
    boxesResults: [{ ok: true, boxes: [PAPER, PAPER, PAPER] }],
    ...rest,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  placeMosaic(shell, pages);
  await shell.flush();
  return shell;
}

function placeMosaic(shell, pages) {
  const { SigK } = shell;
  SigK.pageEdit.commit(SigK.pagePlan.editPages(SigK.viewer.getPlan(), new Map(pages.map((index) => [index, (entry) => ({ ...entry, mosaic: MOSAIC })]))));
}

// 描く部品の代わり。renderToCanvas に届いた { page, scale, rotation, box, annotationMode } を残し、PNG・JPEG は指定の長さのバイト列を返す。
// onRender（n 回目）は描くたびに呼んで待つ（描いている間の操作を差し込む）。
function stubImages(t, shell, { png = 10, jpeg = 8, onRender = () => {} } = {}) {
  const images = shell.SigK.pageImage;
  const original = { renderToCanvas: images.renderToCanvas, toBytes: images.toBytes };
  const calls = [];
  images.renderToCanvas = async (_doc, page, options) => {
    calls.push({ page: page.pageNumber, scale: options.scale, rotation: options.rotation, box: [...options.box], annotationMode: options.annotationMode });
    await onRender(calls.length);
    return { canvas: { width: 1, height: 1, getContext: () => null }, width: 1, height: 1 };
  };
  images.toBytes = async (_canvas, { type }) => new Uint8Array(type === images.PNG ? png : jpeg).fill(1);
  t.after(() => Object.assign(images, original));
  return calls;
}

const byId = (shell, id) => shell.document.getElementById(id);
const spec = (shell) => shell.taskCalls.at(-1)?.spec;
const okResult = () => ({ ok: true, signature: { size: 2048, mtimeMs: 2000 } });

module.exports = { A, B, PAPER, MOSAIC, withMosaic, placeMosaic, stubImages, byId, spec, okResult, makeSource };
