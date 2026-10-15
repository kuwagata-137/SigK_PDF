(function (root) {
  'use strict';

  // タブの今の中身で 1 ページを描く（ツールモードの帯。spec-2-5 確定事項D8）。保存していない並べ替え・回転・切り取り・モザイク・
  // 差し込み・書き込みを含める。描き方は印刷（print.js）と同じで、読み込んだ書き込みは pdf.js に描かせず（ENABLE_STORAGE）、
  // 画面と同じ描き手（annotationLayer.paint）で重ねる。差し込んだページには書き込みを付けない（ページの表示と同じ既知の限界）。
  //
  // view は tabs.peek の中身（doc・plan・annots・imported・inserts）。左の欄のサムネイル（thumbnails.js）はこの描き方に寄せない（今のまま）。

  // 画素比は 2 まで（帯の紙は小さいので、それ以上は細かくしても見分けられない）。
  const MAX_RATIO = 2;
  const docIds = new WeakMap();
  let nextDocId = 1;

  function docId(doc) {
    if (doc === null || doc === undefined)
      return 0;
    if (!docIds.has(doc))
      docIds.set(doc, nextDocId++);
    return docIds.get(doc);
  }

  // 紙の印（帯の紙 strip-thumbs.js・分割の盤 split-thumbs.js）。「文書・plan の要素・差し込み・書き込み・紙の大きさ」で、印が変わった紙は描き直す。
  // sheetKey は紙の大きさの印（"100x141" など）。描けない（開けなかったタブ・無い位置）なら null。
  function signature(view, index, sheetKey) {
    const entry = view?.plan?.[index];
    if (view?.doc === undefined || entry === undefined)
      return null;
    const added = Number.isInteger(entry.insert) ? view.inserts?.[entry.insert] : null;
    const insert = added === null ? '' : `${docId(added?.doc)}/${added?.page ?? 0}`;
    const annots = Number.isInteger(entry.src) ? root.SigK.annotationState.annotsOnPage(view.annots, view.imported, entry.src) : [];
    return `${docId(view.doc)}|${JSON.stringify(entry)}|${insert}|${JSON.stringify(annots)}|${sheetKey}`;
  }

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
  // 引けないページは null。page は手放すときに cleanup する（strip-thumbs.js・split-thumbs.js・split-zoom.js）。
  // 描けなかったときは、ここでページの資源を手放してから例外を返す（呼ぶ側には page が渡らないため）。
  async function draw(domDoc, view, index, { sheet, dpr = 1 }) {
    const source = root.SigK.pagePlan.sourceOf(view.plan, index, { doc: view.doc, inserts: view.inserts });
    if (source === null)
      return null;
    const page = await source.doc.getPage(source.number);
    try {
      return await render(domDoc, view, index, page, { sheet, dpr });
    } catch (error) {
      page.cleanup?.();
      throw error;
    }
  }

  async function render(domDoc, view, index, page, { sheet, dpr }) {
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
  SigK.planPageImage = { MAX_RATIO, draw, overlayFor, signature };
})(typeof window !== 'undefined' ? window : globalThis);
