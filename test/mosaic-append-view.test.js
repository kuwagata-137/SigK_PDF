'use strict';

// モザイクを 1 つ追加しただけのときは、ページとサムネイルを描き直さずに、追加した範囲だけを塗る（決定99 ①。mosaic-append.js を
// page-render.js・thumbnails.js・viewer.applyPlan に組み込んだ経路）。jsdom には 2D コンテキストが無いので、試験の中だけ、画素を
// 配列で持つ 2D コンテキスト（pdf-pixel-fakes.js）を返して、色を読める canvas にする。試験用の pdf.js は canvas に何も描かない。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');
const { pixelContext } = require('./pdf-pixel-fakes.js');

const A = 'C:\\work\\a.pdf';
const BOX = [100, 200, 400, 600];
const BOX2 = [300, 500, 500, 700];

async function withMosaicTool(t) {
  const pdfjs = createPdfjsStub();
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) } });
  t.after(() => shell.cleanup());
  shell.window.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  shell.window.HTMLCanvasElement.prototype.getContext = function getContext() {
    this.pixels ??= pixelContext(this);
    return this.pixels;
  };
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('mosaic');
  await settle(shell);
  return { shell, pdfjs };
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
  return node.querySelector(':scope > canvas, :scope > .pdf-held > canvas');
}

function thumbPicture(shell, index) {
  return shell.document.querySelector(`#thumbs .thumb[data-page="${index + 1}"] > .sheet canvas`);
}

function px(shell, index, point) {
  return shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(point[0], point[1]);
}

function fire(shell, type, target, [x, y], { buttons = 0 } = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
}

// index のページで、範囲 box の左上（x1・y2）から右下（x2・y1）までドラッグして、モザイクを置く。
function place(shell, box = BOX, index = 0) {
  fire(shell, 'mousedown', pageNode(shell, index), px(shell, index, [box[0], box[3]]), { buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, px(shell, index, [box[2], box[1]]), { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell, index), px(shell, index, [box[2], box[1]]));
}

function mosaicCount(shell, index = 0) {
  return shell.SigK.viewer.getPlan()[index].mosaic?.length ?? 0;
}

test('モザイクを置くと、ページとサムネイルを描き直さずに追加した範囲だけを塗り、記録とテキストレイヤーを更新する（pdf.js で描かない）', async (t) => {
  const { shell, pdfjs } = await withMosaicTool(t);
  const { SigK } = shell;
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  const thumb = thumbPicture(shell, 0);
  assert.ok(picture !== null && thumb !== null, '置く前に絵が無い（試験の前提が崩れた）');
  const text = node.querySelector('.textLayer');
  const mosaics = [];
  const render = SigK.textLayer.render;
  SigK.textLayer.render = (options) => {
    mosaics.push(options.mosaic?.length ?? 0);
    return render(options);
  };
  const renders = pdfjs.renderCalls.length;

  place(shell);
  await settle(shell);

  assert.equal(mosaicCount(shell), 1);
  assert.equal(pictureOf(node), picture, 'ページの絵を作り直した');
  assert.equal(thumbPicture(shell, 0), thumb, 'サムネイルの絵を作り直した');
  assert.equal(pdfjs.renderCalls.length, renders, 'pdf.js で描いた');
  assert.ok(picture.puts > 0, 'ページの絵に塗っていない');
  assert.ok(thumb.puts > 0, 'サムネイルに塗っていない');
  assert.equal(SigK.viewer.drawnPicture(0).plan.mosaic.length, 1, 'ページの絵の記録を更新していない');
  assert.equal(SigK.thumbnails.drawnThumb(0).plan.mosaic.length, 1, 'サムネイルの記録を更新していない');
  assert.notEqual(node.querySelector('.textLayer'), text, 'テキストレイヤーを作り直していない');
  assert.equal(node.querySelectorAll('.textLayer').length, 1, '前のテキストレイヤーが残っている');
  assert.deepEqual(mosaics, [1], 'モザイクに重なる行の文字を空にしていない');
});

test('取り消しと［このページのモザイクを削除］では描き直し、やり直しでは追加した範囲だけを塗る', async (t) => {
  const { shell, pdfjs } = await withMosaicTool(t);
  const { SigK } = shell;
  const node = pageNode(shell, 0);
  place(shell);
  await settle(shell);
  const steps = [
    ['取り消し', () => SigK.pageEdit.undo(), 0, true],
    ['やり直し', () => SigK.pageEdit.redo(), 1, false],
    ['このページのモザイクを削除', () => SigK.annotateMosaic.removeOnPage(0), 0, true],
  ];
  for (const [label, act, count, redraw] of steps) {
    const picture = pictureOf(node);
    const renders = pdfjs.renderCalls.filter((call) => call.page === 1).length;
    assert.equal(act(), true, label);
    await settle(shell);
    assert.equal(mosaicCount(shell), count, label);
    assert.equal(pictureOf(node) !== picture, redraw, `${label}: 描き直したか`);
    assert.equal(pdfjs.renderCalls.filter((call) => call.page === 1).length > renders, redraw, `${label}: pdf.js で描いたか`);
    assert.equal(SigK.viewer.drawnPicture(0).plan.mosaic?.length ?? 0, count, label);
  }
});

test('続けて配置した時は、同じページへの塗りを順番に実行し（前の塗りが終わってから次を始める）、描き直さない', async (t) => {
  const { shell, pdfjs } = await withMosaicTool(t);
  const { SigK } = shell;
  const node = pageNode(shell, 0);
  const picture = pictureOf(node);
  const events = [];
  const paintAppended = SigK.mosaicRegion.paintAppended;
  SigK.mosaicRegion.paintAppended = async (doc, canvas, ...rest) => {
    const label = canvas === picture ? `ページ ${rest[2].length}` : `サムネイル ${rest[2].length}`;
    events.push(`${label} 開始`);
    const result = await paintAppended(doc, canvas, ...rest);
    events.push(`${label} 終了`);
    return result;
  };
  const renders = pdfjs.renderCalls.length;

  place(shell, BOX);
  place(shell, BOX2);
  await settle(shell);

  assert.equal(mosaicCount(shell), 2);
  assert.deepEqual(events.filter((event) => event.startsWith('ページ')), ['ページ 1 開始', 'ページ 1 終了', 'ページ 2 開始', 'ページ 2 終了']);
  assert.deepEqual(events.filter((event) => event.startsWith('サムネイル')), ['サムネイル 1 開始', 'サムネイル 1 終了', 'サムネイル 2 開始', 'サムネイル 2 終了']);
  assert.equal(pictureOf(node), picture, '描き直した');
  assert.equal(pdfjs.renderCalls.length, renders, 'pdf.js で描いた');
  assert.equal(SigK.viewer.drawnPicture(0).plan.mosaic.length, 2);
  assert.equal(SigK.thumbnails.drawnThumb(0).plan.mosaic.length, 2);
});

test('塗っている途中に倍率を変えたら、古い絵に書き込まず、記録も更新しない（新しい倍率の絵を描き直す）', async (t) => {
  const { shell } = await withMosaicTool(t);
  const { SigK } = shell;
  const node = pageNode(shell, 0);
  const drawn = SigK.viewer.drawnPicture(0);
  // 塗る処理が、書き込みの有無を調べるところ（page.getAnnotations）で止まるようにする。
  let release = null;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const getAnnotations = drawn.page.getAnnotations.bind(drawn.page);
  drawn.page.getAnnotations = async () => {
    await gate;
    return getAnnotations();
  };

  place(shell);
  await new Promise((resolve) => setImmediate(resolve));
  SigK.viewer.setZoom(SigK.viewer.getState().zoom * 1.25);
  release();
  await settle(shell);
  await settle(shell);

  assert.equal(drawn.canvas.puts, 0, '倍率を変えた後に、古い絵に書き込んだ');
  assert.notEqual(pictureOf(node), drawn.canvas, '新しい倍率の絵を描いていない');
  assert.equal(SigK.viewer.drawnPicture(0).plan.mosaic.length, 1, '新しい倍率の絵にモザイクの記録が無い');
});
