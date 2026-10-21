'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-image.js');
const images = globalThis.SigK.pageImage;

// 1 ページを canvas に描いて画像にする層（spec-3-3 確定事項23・24）。
//
// Node にも jsdom にも 2D コンテキストは無い。ここで見るのは「無い環境では寸法だけ
// 返す」「出口の変換が正しい」「ページの資源を手放す」の 3 点で、実際の画素は
// 起動確認（SIGK_SMOKE_TO_IMAGE）に残す。

const A4 = { width: 595.28, height: 841.89 };

// pdf.js のページの代わり。getViewport の引数と cleanup の回数を控える。
function makePage({ size = A4, rotate = 0 } = {}) {
  const page = { rotate, viewportCalls: [], cleanups: 0, rendered: 0 };
  page.getViewport = ({ scale, rotation = rotate }) => {
    page.viewportCalls.push({ scale, rotation });
    const swapped = rotation % 180 !== 0;
    return { width: (swapped ? size.height : size.width) * scale, height: (swapped ? size.width : size.height) * scale };
  };
  page.render = (options = {}) => {
    page.rendered += 1;
    page.lastRender = options;
    return { promise: Promise.resolve() };
  };
  page.cleanup = () => {
    page.cleanups += 1;
    return true;
  };
  return page;
}

// 2D コンテキストの無い document。createElement は呼ばれないはずである。
function makeDocWithoutCanvas() {
  return {
    defaultView: {},
    createElement: () => {
      throw new Error('2D コンテキストが無い環境で canvas を作ろうとした');
    },
  };
}

// 2D コンテキストのある document のふり。canvas は toDataURL / toBlob を持つだけの箱。
function makeDocWithCanvas({ blob = new Uint8Array([1, 2, 3]) } = {}) {
  const canvases = [];
  return {
    canvases,
    defaultView: { CanvasRenderingContext2D: function CanvasRenderingContext2D() {} },
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext: (...args) => {
          canvas.contextArgs = args;
          return {};
        },
        toDataURL: () => 'data:image/png;base64,AAAA',
        toBlob: (callback, type, quality) => {
          canvas.blobArgs = { type, quality };
          callback(blob === null ? null : { arrayBuffer: async () => blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) });
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
}

test('2D コンテキストが無ければ canvas を作らず、寸法だけを丸めて返す', async () => {
  const page = makePage();
  const drawn = await images.renderToCanvas(makeDocWithoutCanvas(), page, { scale: 150 / 72 });

  assert.equal(drawn.canvas, null);
  assert.deepEqual({ width: drawn.width, height: drawn.height }, { width: 1240, height: 1754 });
  assert.equal(page.rendered, 0);
});

test('rotation を渡さなければ pdf.js の既定（ページ自身の回転）に任せる', async () => {
  const page = makePage({ rotate: 90 });
  const drawn = await images.renderToCanvas(makeDocWithoutCanvas(), page, { scale: 1 });

  // 90 度なら幅と高さが入れ替わる。
  assert.deepEqual({ width: drawn.width, height: drawn.height }, { width: 842, height: 595 });
  assert.deepEqual(page.viewportCalls, [{ scale: 1, rotation: 90 }]);
});

test('rotation を渡せば絶対角として置き換える（印刷の経路）', async () => {
  const page = makePage({ rotate: 90 });
  await images.renderToCanvas(makeDocWithoutCanvas(), page, { scale: 1, rotation: 180 });

  assert.deepEqual(page.viewportCalls, [{ scale: 1, rotation: 180 }]);
});

test('2D コンテキストがあれば canvas を寸法どおりに作って描く', async () => {
  const doc = makeDocWithCanvas();
  const page = makePage();
  const drawn = await images.renderToCanvas(doc, page, { scale: 300 / 72 });

  assert.equal(doc.canvases.length, 1);
  assert.deepEqual({ w: drawn.canvas.width, h: drawn.canvas.height }, { w: 2480, h: 3508 });
  assert.equal(page.rendered, 1);
});

// 未保存の注釈を重ねる口（spec-4-1 確定事項28）。描いたあと、同じ ctx と viewport で呼ばれる。
test('overlay は描いたあとに ctx と viewport で呼ばれ、annotationMode は pdf.js へ渡る', async () => {
  const doc = makeDocWithCanvas();
  const page = makePage();
  const calls = [];
  const drawn = await images.renderToCanvas(doc, page, {
    scale: 1,
    annotationMode: 3,
    overlay: (ctx, viewport) => calls.push({ ctx, viewport, rendered: page.rendered }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rendered, 1, '描いたあとに呼ばれる');
  assert.equal(calls[0].viewport, page.lastRender.viewport);
  assert.equal(calls[0].ctx, page.lastRender.canvasContext);
  assert.equal(page.lastRender.annotationMode, 3);
  assert.notEqual(drawn.canvas, null);
  // 無い環境では呼ばれない。
  const skipped = [];
  await images.renderToCanvas(makeDocWithoutCanvas(), makePage(), { scale: 1, overlay: () => skipped.push(1) });
  assert.equal(skipped.length, 0);
});

// 計画外の直し（2026-10-15）。GPU で描く小さな canvas に 2 枚分を交互に描くと、字の形が一部しか描かれないことがある（Chromium の中の不具合）。
// 帯・盤の紙（plan-page-image.js）は software を渡して CPU で描く canvas にする。ほかの呼び手は今までどおり。
test('software を渡すと CPU で描く 2D コンテキスト（willReadFrequently）を頼み、渡さなければ既定のまま頼む', async () => {
  const doc = makeDocWithCanvas();
  await images.renderToCanvas(doc, makePage(), { scale: 1, software: true });
  await images.renderToCanvas(doc, makePage(), { scale: 1 });
  assert.deepEqual(doc.canvases.map((canvas) => canvas.contextArgs), [['2d', { willReadFrequently: true }], ['2d']]);
});

test('release は canvas の寸法を 0 にして中身を手放す。null にも耐える', async () => {
  const doc = makeDocWithCanvas();
  const drawn = await images.renderToCanvas(doc, makePage(), { scale: 1 });
  images.release(drawn.canvas);

  assert.deepEqual({ w: drawn.canvas.width, h: drawn.canvas.height }, { w: 0, h: 0 });
  assert.doesNotThrow(() => images.release(null));
  assert.doesNotThrow(() => images.release(undefined));
});

test('toDataUrl は data URL と、PNG そのもののバイト数を返す', () => {
  const canvas = { toDataURL: () => 'data:image/png;base64,AAAAAAAA' };
  const result = images.toDataUrl(canvas);

  assert.equal(result.url, 'data:image/png;base64,AAAAAAAA');
  // base64 の 8 文字は 6 バイト。
  assert.equal(result.bytes, 6);
});

test('toBytes は toBlob に形式と品質を渡し、Uint8Array を返す', async () => {
  const doc = makeDocWithCanvas({ blob: new Uint8Array([9, 8, 7, 6]) });
  const drawn = await images.renderToCanvas(doc, makePage(), { scale: 1 });
  const bytes = await images.toBytes(drawn.canvas, { type: images.JPEG, quality: 0.9 });

  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes], [9, 8, 7, 6]);
  assert.deepEqual(drawn.canvas.blobArgs, { type: 'image/jpeg', quality: 0.9 });
});

test('toBytes は blob が作れなければ理由付きで拒否する', async () => {
  const doc = makeDocWithCanvas({ blob: null });
  const drawn = await images.renderToCanvas(doc, makePage(), { scale: 1 });

  await assert.rejects(images.toBytes(drawn.canvas), /画像にできませんでした/);
});

test('exportPage は描いて変換し、canvas とページの資源を手放す（確定事項24）', async () => {
  const doc = makeDocWithCanvas({ blob: new Uint8Array([1, 2]) });
  const page = makePage();
  const result = await images.exportPage(doc, page, { scale: 150 / 72, type: images.PNG });

  assert.deepEqual([...result.bytes], [1, 2]);
  assert.deepEqual({ width: result.width, height: result.height }, { width: 1240, height: 1754 });
  assert.deepEqual({ w: doc.canvases[0].width, h: doc.canvases[0].height }, { w: 0, h: 0 }, 'canvas は捨てる');
  assert.equal(page.cleanups, 1, 'page.cleanup() を 1 回呼ぶ');
});

test('exportPage は変換に失敗しても資源を手放してから投げる', async () => {
  const doc = makeDocWithCanvas({ blob: null });
  const page = makePage();

  await assert.rejects(images.exportPage(doc, page, { scale: 1 }), /画像にできませんでした/);
  assert.equal(page.cleanups, 1);
  assert.equal(doc.canvases[0].width, 0);
});

test('exportPage は 2D コンテキストが無ければ bytes を null で返し、それでも cleanup は呼ぶ', async () => {
  const page = makePage();
  const result = await images.exportPage(makeDocWithoutCanvas(), page, { scale: 1 });

  assert.equal(result.bytes, null);
  assert.deepEqual({ width: result.width, height: result.height }, { width: 595, height: 842 });
  assert.equal(page.cleanups, 1);
});

// 1 枚の canvas の画素の上限（spec-6-1 確定事項D-9）。Chromium は面積が大きすぎる canvas を描かない（A0 を 400%・画面の倍率 1.5 で白いまま）。
test('cappedScale は、画素の数が上限を超えるときだけ、面積が上限に収まるよう倍率を下げる', () => {
  const max = images.MAX_CANVAS_PIXELS;
  assert.equal(max, 2 ** 27);
  assert.equal(images.cappedScale(2, 1000, 1000), 2, '上限より小さければそのまま');
  const scale = images.cappedScale(4, 19072, 26960);
  assert.ok(Math.abs(19072 * 26960 * (scale / 4) ** 2 - max) < max * 1e-9, '面積がちょうど上限になる');
});

test('renderToCanvas は maxPixels を渡されたときだけ、大きすぎる紙の倍率を下げて描く（印刷。PDF→画像は渡さない）', async () => {
  const A0 = { width: 2384, height: 3370 };
  const capped = await images.renderToCanvas(makeDocWithoutCanvas(), makePage({ size: A0 }), { scale: 12, maxPixels: images.MAX_CANVAS_PIXELS });
  assert.ok(capped.width * capped.height <= images.MAX_CANVAS_PIXELS * 1.001, `${capped.width}×${capped.height}`);
  const exact = await images.renderToCanvas(makeDocWithoutCanvas(), makePage({ size: A0 }), { scale: 12 });
  assert.deepEqual({ width: exact.width, height: exact.height }, { width: 28608, height: 40440 }, '渡さなければ倍率どおり');
});
