(function (root) {
  'use strict';

  // モザイクの塗り（spec-4b-6b 確定事項5〜8・19。事前調査 L）。
  //
  // 範囲を紙の座標のブロック（page-mosaic.js の gridOf）に割り、viewport でそのページの canvas の画素の四角にして、ブロックごとに
  // 平均色で塗る。区切りを紙の座標で決めるので、表示の倍率・回転・保存の 300dpi の画像で同じ所に来る。
  //
  // 下見（表示・サムネイル・印刷）は、pdf.js が canvas に描いた表示のみの書き込みを塗らないために、書き込みを描かない絵
  // （annotationMode: DISABLE）をもう 1 枚描いて base にする。平均色は base から取り、canvas と base で色が違う画素（＝書き込み）は
  // 塗らずに残す。保存の画像は初めから書き込みを描かないので base は要らない。2D コンテキストの無い環境（jsdom）では何もしない。

  function pageMosaic() {
    return root.SigK.pageMosaic;
  }

  function needsPaint(mosaic) {
    return Array.isArray(mosaic) && mosaic.length > 0;
  }

  // 紙の座標の四角 → canvas の画素の [左, 上, 右, 下]（四捨五入）。回したページでも 2 つの角の小さい方・大きい方を取る。
  function pixelRectOf(viewport, x1, y1, x2, y2) {
    const [ax, ay] = viewport.convertToViewportPoint(x1, y1);
    const [bx, by] = viewport.convertToViewportPoint(x2, y2);
    return [Math.round(Math.min(ax, bx)), Math.round(Math.min(ay, by)), Math.round(Math.max(ax, bx)), Math.round(Math.max(ay, by))];
  }

  function clip([left, top, right, bottom], width, height) {
    return [Math.max(0, left), Math.max(0, top), Math.min(width, right), Math.min(height, bottom)];
  }

  // 1 つのブロック（outer の中の [左, 上, 右, 下]）を塗る。平均は sample から取り、keep なら target と sample で違う画素は残す。
  function fillBlock(target, sample, stride, [left, top, right, bottom], keep) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (y * stride + x) * 4;
        r += sample[at];
        g += sample[at + 1];
        b += sample[at + 2];
        n += 1;
      }
    }
    if (n === 0)
      return;
    const color = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = (y * stride + x) * 4;
        if (keep && (target[at] !== sample[at] || target[at + 1] !== sample[at + 1] || target[at + 2] !== sample[at + 2]))
          continue;
        target[at] = color[0];
        target[at + 1] = color[1];
        target[at + 2] = color[2];
        target[at + 3] = 255;
      }
    }
  }

  // 1 つの範囲 { box, block } を塗る。
  function paintItem(ctx, viewport, item, base) {
    const grid = pageMosaic().gridOf(item?.box, item?.block);
    if (grid === null)
      return;
    const { width, height } = ctx.canvas;
    const [ox, oy, ox2, oy2] = clip(pixelRectOf(viewport, ...item.box), width, height);
    const w = ox2 - ox;
    const h = oy2 - oy;
    if (w <= 0 || h <= 0)
      return;
    const image = ctx.getImageData(ox, oy, w, h);
    const sample = base === null ? image.data : base.getImageData(ox, oy, w, h).data;
    for (let j = 0; j + 1 < grid.ys.length; j += 1) {
      for (let i = 0; i + 1 < grid.xs.length; i += 1) {
        const [left, top, right, bottom] = clip(pixelRectOf(viewport, grid.xs[i], grid.ys[j + 1], grid.xs[i + 1], grid.ys[j]), ox2, oy2);
        fillBlock(image.data, sample, w, [left - ox, top - oy, right - ox, bottom - oy].map((v) => Math.max(0, v)), base !== null);
      }
    }
    ctx.putImageData(image, ox, oy);
  }

  // ctx（そのページを viewport で描いた canvas の 2D コンテキスト）に、モザイクの並びを置いた順に塗る（確定事項5・6）。
  // base は書き込みを描かない絵の 2D コンテキスト（同じ大きさ。無ければ ctx 自身から平均を取る）。
  function paint(ctx, viewport, mosaic, { base = null } = {}) {
    if (!needsPaint(mosaic) || typeof ctx?.getImageData !== 'function')
      return false;
    for (const item of mosaic)
      paintItem(ctx, viewport, item, base);
    return true;
  }

  // 書き込みを描かない絵を、canvas と同じ大きさで描く。track(task) で描画の task を渡す（ページビューが捨てるときに止めるため）。
  async function drawBase(doc, page, viewport, canvas, { track = () => {} } = {}) {
    const base = doc.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const task = page.render({ canvasContext: base.getContext('2d'), viewport, annotationMode: root.SigK.pdfjs?.lib?.AnnotationMode?.DISABLE });
    track(task);
    await task.promise;
    return base;
  }

  // 下見（確定事項7）: モザイクがあれば、書き込みを描かない絵を描いて base にし、canvas に塗る。塗ったら true。
  async function paintOver(doc, canvas, page, viewport, mosaic, options = {}) {
    if (!needsPaint(mosaic) || typeof canvas?.getContext !== 'function')
      return false;
    const ctx = canvas.getContext('2d');
    if (typeof ctx?.getImageData !== 'function')
      return false;
    const base = await drawBase(doc, page, viewport, canvas, options);
    try {
      return paint(ctx, viewport, mosaic, { base: base.getContext('2d') });
    } finally {
      base.width = 0;
      base.height = 0;
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicPaint = { needsPaint, pixelRectOf, paint, paintOver };
})(typeof window !== 'undefined' ? window : globalThis);
