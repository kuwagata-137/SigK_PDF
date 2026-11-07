(function (root) {
  'use strict';

  // 画像のタブを、書き込みを焼き込んだ 1 枚の画像のバイト列にする（spec-7-1 確定事項B4）。
  //
  // 印刷（print.js）と同じ描き手を使う。倍率 1（1pt＝1 画素）で、ページの回転・トリミングの範囲・モザイク・書き込みを 1 枚に描く。
  // 違いは 3 つある。
  //   ① 背景を塗らない（透明を残す）。JPEG に書くときは透明を持てないので白を塗る（Chromium は透明を黒にして JPEG にするため）。
  //   ② モザイクは pdf.js の描いた絵を比べずに塗る（mosaicPaint.paint。PDF の保存の画像と同じ）。画面の下見（paintOver）は、書き込みを
  //      描かない絵と比べて違う画素を書き込みとみなして残すので、③で敷き直した画素や透明な画素がモザイクから漏れてしまう。
  //   ③ 元が JPEG なら、pdf.js が描いたあと、ブラウザで読み解いた元の画像を描き直す。pdf.js は JPEG を自前で読み解くので、画素が
  //      少しずれる（事前調査 A）。EXIF の向きは画像→PDF と同じく読まない（imageOrientation: 'none'）。
  //
  // jsdom には 2D コンテキストが無い。そのときは bytes を null で返し、経路だけを確かめる（page-image.js と同じ作法）。

  function viewer() {
    return root.SigK.viewer;
  }

  // 元の JPEG をブラウザで読み解く。読めなければ null（pdf.js が描いたままにする）。
  async function decodeOriginal(win, file, entry) {
    const original = file?.image?.original;
    if (file?.image?.kind !== 'jpeg' || !(original instanceof Uint8Array) || !Number.isInteger(entry?.src))
      return null;
    if (typeof win?.createImageBitmap !== 'function' || typeof win?.Blob !== 'function')
      return null;
    try {
      return await win.createImageBitmap(new win.Blob([original], { type: 'image/jpeg' }), { imageOrientation: 'none' });
    } catch (error) {
      root.SigK.log?.warn('image-render', '元の JPEG を読み解けなかったので、pdf.js が描いた画素で書きます', error);
      return null;
    }
  }

  // 元の画像を、紙の座標（左下が原点。画像は [0, 0, 幅, 高さ] に載っている）に合わせて描く。viewport.transform は紙の座標から
  // canvas の画素へ移す行列で、回転とトリミングの範囲を含む。画像の上の行は紙の y＝高さにあるので、上下を返してから描く。
  function drawOriginal(ctx, viewport, bitmap, size) {
    ctx.save();
    ctx.setTransform(...viewport.transform);
    ctx.transform(1, 0, 0, -1, 0, size.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    ctx.restore();
  }

  // format は 'png' か 'jpeg'。戻り値は { ok, bytes, width, height } か { error }。bytes は jsdom では null。
  async function render(doc, format) {
    const view = viewer();
    const tab = root.SigK.imageTab;
    const page = await view.getPage(1);
    const entry = view.getPlan()[0];
    if (page === null || page === undefined || entry === undefined)
      return { error: '画像にするページがありません。' };
    const file = view.getState().file;
    await root.SigK.freeTextShape?.ensureLoaded(doc);
    const bitmap = await decodeOriginal(doc.defaultView, file, entry);
    const painter = root.SigK.annotate?.painterFor(entry.src) ?? null;
    const size = file?.image?.frames?.[Number.isInteger(entry.src) ? entry.src : 0] ?? null;
    const images = root.SigK.pageImage;
    const drawn = await images.renderToCanvas(doc, page, {
      scale: 1,
      rotation: view.viewportRotation(1, page),
      box: entry.crop ?? null,
      annotationMode: root.SigK.pdfjs?.lib?.AnnotationMode?.ENABLE_STORAGE,
      background: format === 'jpeg' ? '#ffffff' : 'rgba(0,0,0,0)',
      overlay: (ctx, viewport) => {
        if (bitmap !== null && size !== null)
          drawOriginal(ctx, viewport, bitmap, size);
        root.SigK.mosaicPaint?.paint(ctx, viewport, entry.mosaic ?? null);
        painter?.(ctx, viewport);
      },
    });
    bitmap?.close?.();
    if (drawn.canvas === null)
      return { ok: true, bytes: null, width: drawn.width, height: drawn.height };
    try {
      const bytes = await images.toBytes(drawn.canvas, { type: tab.mimeOf(format), quality: tab.qualityOf(format) });
      return { ok: true, bytes, width: drawn.width, height: drawn.height };
    } finally {
      images.release(drawn.canvas);
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageRender = { render, drawOriginal };
})(typeof window !== 'undefined' ? window : globalThis);
