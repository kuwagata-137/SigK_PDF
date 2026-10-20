(function (root) {
  'use strict';

  // 1 ページを canvas に描いて画像にする層（spec-3-3 確定事項23）。
  //
  // 印刷（print.js）と PDF→画像（tools-to-image.js）が共用する。canvas を作って
  // 描くところまでは同じで、出口だけが違う。印刷は <img> に載せるので data URL、
  // PDF→画像はファイルに書くのでバイト列である。
  //
  // jsdom には 2D コンテキストが無い。そのときは canvas を作らず、寸法だけを
  // 返して経路の検証に使う（print.js が元々していた作法）。見た目と中身は
  // 起動確認（SIGK_SMOKE_PRINT・SIGK_SMOKE_TO_IMAGE）で確かめる。

  const PNG = 'image/png';
  const JPEG = 'image/jpeg';

  function hasCanvas(win) {
    return typeof (win ?? root).CanvasRenderingContext2D !== 'undefined';
  }

  // viewport を作る。rotation を渡さなければ pdf.js の既定（ページ自身の
  // /Rotate）に任せる。渡すときは絶対角である（spec-1-5 確定事項39）。
  // box は描く範囲（印刷が plan の crop を渡す。spec-4b-6a 確定事項6）。口が読まれていなければ元の範囲で描く。
  function viewportFor(page, { scale, rotation, box = null }) {
    const viewbox = root.SigK?.pageViewbox;
    if (viewbox !== undefined)
      return viewbox.viewportFor(page, { scale, rotation, box });
    return rotation === undefined ? page.getViewport({ scale }) : page.getViewport({ scale, rotation });
  }

  // 描く。戻り値は { canvas, width, height }。canvas は 2D コンテキストが無い
  // 環境では null で、そのときも寸法は入っている。
  //
  // annotationMode は pdf.js の描き方（spec-4-1 確定事項18・28。読み込んだテキスト
  // マークアップを pdf.js に描かせないとき ENABLE_STORAGE）。overlay(ctx, viewport) は
  // 描いたあとに呼ぶ口で、印刷が未保存の注釈を同じ canvas に重ねる（確定事項28）。mosaic は plan の要素のモザイクの並びで、
  // overlay の前に塗る（spec-4b-6b 確定事項7。書き込みはモザイクの上）。
  // software は CPU で描く canvas にする（willReadFrequently）。GPU で描く小さな canvas に 2 枚分を交互に描くと、字の形が一部しか
  // 描かれないことがある（Chromium の中の不具合。2026-10-15 の計画外の直し）ので、同時に何枚も描く帯・盤の紙（plan-page-image.js）が使う。
  // 1 枚の canvas の画素の上限（spec-6-1 確定事項D-9）。Chromium は面積が約 2 億 6,800 万画素を超える canvas を描かない（A0 を 400%・
  // 画面の倍率 1.5 で白いまま。起動確認で確かめた）。その 4 分の 1 にして、超える分は倍率を下げて描き、CSS で紙の大きさへ広げる（少しにじむ）。
  // A4 を 400%・画面の倍率 2 で描く鮮明さ（約 4,300 万画素）は変えない。1 枚あたり約 268MB まで。
  const MAX_CANVAS_PIXELS = 2 ** 26;

  // 幅 width・高さ height（倍率 scale で描いたときの画素）が上限を超えるなら、面積が上限に収まる倍率に下げる。
  function cappedScale(scale, width, height, max = MAX_CANVAS_PIXELS) {
    const area = width * height;
    return area > max ? scale * Math.sqrt(max / area) : scale;
  }

  // maxPixels は印刷が渡す（表示は page-render.js が同じ上限で下げる）。PDF→画像は指定した解像度どおりに書き出すので渡さない（4,000 万画素を超えたら断る）。
  async function renderToCanvas(doc, page, { scale, rotation, box = null, annotationMode, overlay = null, mosaic = null, software = false, maxPixels = Infinity }) {
    let viewport = viewportFor(page, { scale, rotation, box });
    const capped = cappedScale(scale, viewport.width, viewport.height, maxPixels);
    if (capped !== scale)
      viewport = viewportFor(page, { scale: capped, rotation, box });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    if (!hasCanvas(doc.defaultView))
      return { canvas: null, width, height };

    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = software ? canvas.getContext('2d', { willReadFrequently: true }) : canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport, annotationMode }).promise;
    await root.SigK.mosaicPaint?.paintOver(doc, canvas, page, viewport, mosaic);
    if (typeof overlay === 'function')
      overlay(ctx, viewport);
    return { canvas, width, height };
  }

  // 早めに手放す。参照が残っていても中身は解放される。A4・300dpi の canvas は
  // 2480×3508px ＝ 約 35MB（RGBA）で、ページ数ぶん抱えることはできない。
  function release(canvas) {
    if (canvas === null || canvas === undefined)
      return;
    canvas.width = 0;
    canvas.height = 0;
  }

  // 印刷の出口。data URL と、PNG そのもののバイト数を返す。base64 は 3 バイトを
  // 4 文字にするので、接頭辞を除いた長さの 3/4 が中身である。
  function toDataUrl(canvas, { type = PNG, quality } = {}) {
    const url = canvas.toDataURL(type, quality);
    return { url, bytes: Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4) };
  }

  // ファイルに書く出口。toBlob は toDataURL の 1.5〜2.4 倍速く（spec-3-3 事前調査 A）、
  // base64 を経由しないぶんメモリも食わない。
  function toBytes(canvas, { type = PNG, quality } = {}) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('ページを画像にできませんでした'));
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      }, type, quality);
    });
  }

  // 1 ページを画像のバイト列にする（PDF→画像の本体）。描いて、変換して、canvas と
  // ページの資源を手放す。ページの資源（展開した画像）は pdf.js が文書に抱え続け、
  // cleanup() を呼ばないと GPU プロセスが 1 ページ約 5MB ずつ伸びる（事前調査 B-1。
  // 確定事項24）。jsdom では bytes が null で返る。
  async function exportPage(doc, page, { scale, rotation, type = PNG, quality } = {}) {
    const drawn = await renderToCanvas(doc, page, { scale, rotation });
    try {
      const bytes = drawn.canvas === null ? null : await toBytes(drawn.canvas, { type, quality });
      return { bytes, width: drawn.width, height: drawn.height };
    } finally {
      release(drawn.canvas);
      page.cleanup?.();
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageImage = { PNG, JPEG, MAX_CANVAS_PIXELS, cappedScale, hasCanvas, renderToCanvas, release, toDataUrl, toBytes, exportPage };
})(typeof window !== 'undefined' ? window : globalThis);
