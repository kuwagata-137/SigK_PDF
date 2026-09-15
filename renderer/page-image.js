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
  function viewportFor(page, { scale, rotation }) {
    return rotation === undefined ? page.getViewport({ scale }) : page.getViewport({ scale, rotation });
  }

  // 描く。戻り値は { canvas, width, height }。canvas は 2D コンテキストが無い
  // 環境では null で、そのときも寸法は入っている。
  //
  // annotationMode は pdf.js の描き方（spec-4-1 確定事項18・28。読み込んだテキスト
  // マークアップを pdf.js に描かせないとき ENABLE_STORAGE）。overlay(ctx, viewport) は
  // 描いたあとに呼ぶ口で、印刷が未保存の注釈を同じ canvas に重ねる（確定事項28）。
  async function renderToCanvas(doc, page, { scale, rotation, annotationMode, overlay = null }) {
    const viewport = viewportFor(page, { scale, rotation });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    if (!hasCanvas(doc.defaultView))
      return { canvas: null, width, height };

    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport, annotationMode }).promise;
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
  SigK.pageImage = { PNG, JPEG, hasCanvas, renderToCanvas, release, toDataUrl, toBytes, exportPage };
})(typeof window !== 'undefined' ? window : globalThis);
