(function (root) {
  'use strict';

  // 保存・抽出の前に、モザイクのあるページを画像にする（spec-4b-6b 確定事項18・19・25。決定64 ⑤・決定66 ①②）。
  //
  // 上書き保存・名前を付けて保存では、まず確認（confirm-mosaic.js）を出す。抽出は抽出の確認に一文を足す（extract.js）ので、ここでは
  // 出さない。了承されたら、モザイクのあるページを順に、紙全体（MediaBox。page-boxes.js。読めなければ page.view）・回転 0・書き込みを
  // 描かずに 300dpi で描き、モザイクを塗って（mosaic-paint.js。base は要らない）、PNG か JPEG のバイト列にする。描く間は保存の枠
  // （save.js の runLocal）に載せ、帯「モザイクのページを画像にしています（n / N ページ）」と［中止］を出す。ワーカーへ渡す形は
  // [{ src, kind, bytes, box }]（worker/op-mosaic.js）。
  //
  // 確認の間・画像にしている間も、編集・タブの切り替えは止まらない。始めたときの文書と plan を控え、各ページを描く直前と描き終えたあとに
  // 今と比べ、違えば取りやめる（描いた画像とワーカーへ渡す並びが食い違うと、モザイクのページが元の中身のまま書かれるため。コードの点検で
  // 直した）。ページは比べた直後に、その場で今の文書から取る（viewer.getPage は呼んだときの文書を読む）。

  // 保存の画像の細かさ（決定66 ①）と、1 ページの画素の上限（差し込み・PDF→画像と同じ。超えたら収まる細かさまで下げる）。
  const DPI = 300;
  const MAX_PIXELS = 40_000_000;
  // 1 辺の画素の上限（Chromium の canvas の辺の上限 32,767 より手前。細長い紙で描けなくならないよう、超えたら下げる）。
  const MAX_SIDE = 16_384;
  const JPEG_QUALITY = 0.9;
  // PNG が JPEG のこの倍以下なら PNG（文字がにじまない）、超えるなら JPEG（写真のページ。事前調査 H）。
  const PNG_RATIO = 2;
  const LABEL = 'モザイクのページを画像に';

  function viewer() {
    return root.SigK.viewer;
  }

  function banner() {
    return root.SigK.viewBanner;
  }

  // 1pt あたりの画素。300dpi で 4,000 万画素か 1 辺 16,384 画素を超える紙は、収まるまで下げる。
  function scaleFor(box, userUnit = 1) {
    const width = (box[2] - box[0]) * userUnit;
    const height = (box[3] - box[1]) * userUnit;
    const scale = DPI / 72;
    const byArea = width * height * scale * scale <= MAX_PIXELS ? scale : Math.sqrt(MAX_PIXELS / (width * height)) * 0.999;
    const bySide = Math.max(width, height) * byArea <= MAX_SIDE ? byArea : (MAX_SIDE / Math.max(width, height)) * 0.999;
    return bySide;
  }

  // 始めたときの文書（file）と plan のままか。
  function stillSame(file, plan) {
    return viewer().getState().file === file && root.SigK.pagePlan.samePlan(plan, viewer().getPlan());
  }

  function pick(png, jpeg) {
    return png.length <= jpeg.length * PNG_RATIO ? { kind: 'png', bytes: png } : { kind: 'jpeg', bytes: jpeg };
  }

  // 表示上の index のページを画像にする。{ src, kind, bytes, box } か { error }。
  async function renderPage(index) {
    const entry = viewer().getPlan()[index];
    const file = viewer().getState().file;
    const page = await viewer().getPage(index + 1);
    if (!Number.isInteger(entry?.src) || page === null || page === undefined)
      return { error: 'モザイクのページを読めませんでした。' };
    await root.SigK.pageBoxes?.load(file);
    const box = root.SigK.pageBoxes?.mediaBoxOf(file, entry.src) ?? root.SigK.pageCrop.normalizeBox(page.view);
    const scale = scaleFor(box, page.userUnit ?? 1);
    const images = root.SigK.pageImage;
    const drawn = await images.renderToCanvas(root.document, page, { scale, rotation: 0, box, annotationMode: root.SigK.pdfjs?.lib?.AnnotationMode?.DISABLE });
    try {
      if (drawn.canvas === null)
        return { error: 'この環境ではモザイクのページを画像にできません。' };
      const viewport = root.SigK.pageViewbox.viewportFor(page, { scale, rotation: 0, box });
      root.SigK.mosaicPaint.paint(drawn.canvas.getContext('2d'), viewport, entry.mosaic);
      const png = await images.toBytes(drawn.canvas, { type: images.PNG });
      const jpeg = await images.toBytes(drawn.canvas, { type: images.JPEG, quality: JPEG_QUALITY });
      return { src: entry.src, ...pick(png, jpeg), box };
    } finally {
      images.release(drawn.canvas);
      page.cleanup?.();
    }
  }

  // indices（表示上の位置）のページを、保存の枠に載せて順に画像にする。［中止］は描き終えたあとにも見る（最後のページの間に押されても
  // 書かない）。文書か plan が始めたときと違えば { changed }。
  function renderAll(indices, file, plan) {
    return root.SigK.save.runLocal({
      label: LABEL,
      run: async ({ report, canceled }) => {
        const mosaics = [];
        for (const [at, index] of indices.entries()) {
          if (canceled())
            return { canceled: true };
          if (!stillSame(file, plan))
            return { changed: true };
          report(at + 1, indices.length, 'ページ');
          const rendered = await renderPage(index);
          if (canceled())
            return { canceled: true };
          if (rendered.error !== undefined)
            return rendered;
          mosaics.push(rendered);
        }
        return stillSame(file, plan) ? { ok: true, mosaics } : { changed: true };
      },
    });
  }

  function showChanged(mode) {
    banner()?.show(mode === 'extract'
      ? '抽出の確認や画像にしている間に、ページかタブが変わったので、抽出を取りやめました。もう一度抽出してください。'
      : '保存の確認や画像にしている間に、ページかタブが変わったので、保存を取りやめました。元のファイルは変更していません。もう一度保存してください。', { tone: 'warn' });
    return { changed: true };
  }

  // 保存・抽出の前に呼ぶ。{ ok, mosaics }（無ければ空の配列）か { canceled } か { error }。帯は出し終えて返す。
  //   mode    … 'overwrite'・'saveAs'（確認を出す）・'extract'（確認を出さない。抽出の確認が一文を足す）
  //   indices … 画像にするページの表示上の位置（既定は plan のモザイクのあるページ全部）
  //   name・sourceName … 確認の文の保存先と元のファイルの名前
  //   plan … 呼ぶ側が先に読んだ plan（抽出は確認と保存先のダイアログの前に読む）。今と違えば取りやめる。既定は今の plan
  // ページかタブが変わっていれば、帯を出して { changed } を返す。
  async function prepare({ mode = 'overwrite', indices = null, name = '', sourceName = '', plan: expected = null } = {}) {
    const file = viewer().getState().file;
    const plan = expected ?? viewer().getPlan();
    if (!stillSame(file, plan))
      return showChanged(mode);
    const targets = (indices ?? root.SigK.pageMosaic.indicesOf(plan)).filter((index) => root.SigK.pageMosaic.countOf(plan[index]) > 0);
    if (targets.length === 0)
      return { ok: true, mosaics: [] };
    if (mode !== 'extract') {
      const pages = root.SigK.pageMosaic.pagesLabel(targets);
      if (await root.SigK.confirmMosaic.ask({ mode, count: targets.length, pages, name, sourceName }) !== true) {
        // 自分で「やめる」を選んだので赤く塗らない（決定49）。
        banner()?.show('保存を取りやめました。', { tone: 'info' });
        return { canceled: true };
      }
    }
    const result = await renderAll(targets, file, plan);
    if (result?.changed === true)
      return showChanged(mode);
    if (result?.canceled === true) {
      banner()?.show(mode === 'extract' ? '抽出を中止しました。' : '保存を中止しました。元のファイルは変更していません。', { tone: 'info' });
      return result;
    }
    if (result?.ok !== true) {
      banner()?.show(result?.error ?? 'モザイクのページを画像にできませんでした。');
      return result ?? { error: 'モザイクのページを画像にできませんでした。' };
    }
    return result;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.mosaicSave = { DPI, MAX_PIXELS, MAX_SIDE, prepare, renderPage, scaleFor };
})(typeof window !== 'undefined' ? window : globalThis);
