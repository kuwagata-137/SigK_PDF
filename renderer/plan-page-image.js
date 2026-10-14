(function (root) {
  'use strict';

  // タブの今の中身で 1 ページを描く（ツールモードの帯。spec-2-5 確定事項D8）。保存していない並べ替え・回転・切り取り・モザイク・
  // 差し込み・書き込みを含める。描き方は印刷（print.js）と同じで、読み込んだ書き込みは pdf.js に描かせず（ENABLE_STORAGE）、
  // 画面と同じ描き手（annotationLayer.paint）で重ねる。差し込んだページには書き込みを付けない（ページの表示と同じ既知の限界）。
  //
  // view は tabs.peek の中身（doc・plan・annots・imported・inserts）。左の欄のサムネイル（thumbnails.js）はこの描き方に寄せない（今のまま）。

  // 画素比は 2 まで（帯の紙は小さいので、それ以上は細かくしても見分けられない）。
  const MAX_RATIO = 2;

  function overlayFor(view, index) {
    const src = view.plan[index]?.src;
    if (!Number.isInteger(src))
      return null;
    const entries = root.SigK.annotationState.annotsOnPage(view.annots, view.imported, src);
    if (entries.length === 0)
      return null;
    return { entries, paint: (ctx, viewport) => root.SigK.annotationLayer.paint(ctx, entries, viewport) };
  }

  function viewportFor(page, options) {
    return root.SigK.pageViewbox?.viewportFor(page, options) ?? page.getViewport({ scale: options.scale, rotation: options.rotation });
  }

  // sheet は紙の大きさ（CSS px。strip-layout の sheetOf）。{ canvas, page } を返す（canvas は描けない環境では null）。
  // 引けないページは null。page は手放すときに cleanup する（strip-thumbs.js）。
  async function draw(domDoc, view, index, { sheet, dpr = 1 }) {
    const source = root.SigK.pagePlan.sourceOf(view.plan, index, { doc: view.doc, inserts: view.inserts });
    if (source === null)
      return null;
    const page = await source.doc.getPage(source.number);
    const entry = view.plan[index];
    const rotation = (page.rotate ?? 0) + (entry?.rotate ?? 0);
    const box = entry?.crop ?? null;
    const base = viewportFor(page, { scale: 1, rotation, box });
    const ratio = Math.min(MAX_RATIO, Math.max(1, Number(dpr) || 1));
    const scale = base.width > 0 ? (sheet.width * ratio) / base.width : 1;
    const overlay = overlayFor(view, index);
    // テキストの書き込みは字形を読み込んでから塗る（読み込む前に塗ると代わりの字形になる。印刷と同じ）。
    if (overlay?.entries.some((annot) => annot.kind === 'text') === true)
      await root.SigK.freeTextShape?.ensureLoaded(domDoc);
    const result = await root.SigK.pageImage.renderToCanvas(domDoc, page, {
      scale, rotation, box,
      mosaic: entry?.mosaic ?? null,
      annotationMode: root.SigK.pdfjs?.lib?.AnnotationMode?.ENABLE_STORAGE,
      overlay: overlay?.paint ?? null,
    });
    return { canvas: result.canvas, page };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.planPageImage = { MAX_RATIO, draw, overlayFor };
})(typeof window !== 'undefined' ? window : globalThis);
