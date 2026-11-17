(function (root) {
  'use strict';

  // シート（用紙 1 枚の片面）の画像を作る（docs/spec-7-7-print-dialog.md）。
  //
  // 配置（print-sheet-plan.js）どおりに、ページの画像・注釈の一覧ページ・ページ境界線・タイルマーク・ラベルを canvas に描く。
  // ページは用紙に入る部分だけを、用紙の上で dpi の解像度になる倍率で描く（拡大しても粗くならず、縮小しても無駄に大きく描かない）。
  // ページ画像は、画素単位にそろえた位置に、拡大縮小せずに貼る（貼る時の補間で滲ませない。決定97 ②）。
  // 印刷する画像（forPrint）は、横のシートを時計回りに 90 度回して縦の用紙の向きにする（print-sheet-geometry.js）。
  // グレースケール (白黒) で印刷(Y) は灰色に、インク / トナーを節約は色を白に近づけて描く（質問 PR3 ③・PR5）。
  // jsdom には 2D コンテキストが無い。そのときもページは描かせ（経路と描く範囲を試験で見るため）、シートの canvas は作らない。

  const UM_PER_INCH = 25400;
  // 時計回りに 90 度回す回転行列（成分を直接指定する）。ctx.rotate(Math.PI / 2) では cos(π/2) が 0 にならず、画素の位置がわずかにずれる。
  const TURN = [0, 1, -1, 0];
  // インク / トナーを節約の濃さ（質問 PR5 の答え「15% 節約」。Acrobat の説明「トナーを最大 15% 節約できます」と同じにする）。
  const INK_SAVE_DENSITY = 0.85;
  const MARK_LENGTH = 4000;
  const LABEL_PT = 7;
  const UNPRINTABLE = '#dfdfdf';

  const R = () => root.SigK.printPageRegion;

  const px = (um, dpi) => (um / UM_PER_INCH) * dpi;

  function hasCanvas(doc) {
    return root.SigK.pageImage.hasCanvas(doc.defaultView);
  }

  // シート画像の画素数（回す前の向き）。canvas の大きさと同じく四捨五入する。
  function sheetPixels(sheet, dpi) {
    return { width: Math.max(1, Math.round(px(sheet.width, dpi))), height: Math.max(1, Math.round(px(sheet.height, dpi))) };
  }

  // シート画像の画素数上限は、モザイクを入れたページの保存（mosaic-save.js）と同じ 1 枚 4,000 万画素・1 辺 16,384 画素にする。
  // dpi で描くと上限を超える用紙は、上限に収まる解像度に下げる（その用紙だけ。mosaic-save.js の scaleFor と同じ考え方。決定97 ⑤）。
  function cappedDpi(sheet, dpi, { maxPixels = root.SigK.mosaicSave.MAX_PIXELS, maxSide = root.SigK.mosaicSave.MAX_SIDE } = {}) {
    const size = sheetPixels(sheet, dpi);
    if (size.width * size.height <= maxPixels && Math.max(size.width, size.height) <= maxSide)
      return dpi;
    const width = sheet.width / UM_PER_INCH;
    const height = sheet.height / UM_PER_INCH;
    // 0.999 は、画素数を四捨五入しても上限を超えないための余裕。
    return Math.min(Math.sqrt(maxPixels / (width * height)), maxSide / Math.max(width, height)) * 0.999;
  }

  // 小数を含む矩形（px）を画素単位にそろえる。四辺をそれぞれ四捨五入する（隣り合う矩形の間に、隙間も重なりも作らない）。
  function snapRect(rect) {
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    return { x, y, width: Math.round(rect.x + rect.width) - x, height: Math.round(rect.y + rect.height) - y };
  }

  function sheetCanvas(doc, sheet, dpi, forPrint) {
    const { width, height } = sheetPixels(sheet, dpi);
    const turn = forPrint && sheet.landscape;
    const canvas = doc.createElement('canvas');
    canvas.width = turn ? height : width;
    canvas.height = turn ? width : height;
    const ctx = canvas.getContext('2d');
    // プレビューでは、用紙の印刷できない余白を灰色（#dfdfdf。Acrobat のプレビューと同じ色）で塗る。
    ctx.fillStyle = forPrint ? '#ffffff' : UNPRINTABLE;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!forPrint && sheet.area) {
      const area = snapRect(rectPx(sheet.area, dpi));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(area.x, area.y, area.width, area.height);
    }
    if (turn)
      ctx.transform(...TURN, canvas.width, 0);
    return { canvas, ctx };
  }

  function rectPx(rect, dpi) {
    return { x: px(rect.x, dpi), y: px(rect.y, dpi), width: px(rect.width, dpi), height: px(rect.height, dpi) };
  }

  // 描いたページの部分を、枠の向き（rotation が 90 なら時計回り）で dest に貼る。dest は画素単位にそろえた矩形（snapRect）。
  // ページの部分は dest と同じ大きさ（差は 1 画素以内）で描いてあるので、拡大縮小せずに貼る（決定97 ②）。
  // 差が 1 画素を超える時（pageImage の画素数上限で倍率を下げて描いた時）だけ、dest の大きさに合わせて伸ばす。
  function paste(ctx, image, dest, rotation, { grayscale, inkSave }) {
    const turned = rotation === 90;
    const width = turned ? dest.height : dest.width;
    const height = turned ? dest.width : dest.height;
    // drawImage は大きさ 0 の画像を受け付けない（例外になる）。画素単位にそろえて幅か高さが 0 になった細い部分は貼らない。
    if (width <= 0 || height <= 0 || image.width <= 0 || image.height <= 0)
      return;
    ctx.save();
    if (grayscale)
      ctx.filter = 'grayscale(1)';
    if (inkSave)
      ctx.globalAlpha = INK_SAVE_DENSITY;
    if (turned)
      ctx.transform(...TURN, dest.x + dest.width, dest.y);
    else
      ctx.translate(dest.x, dest.y);
    if (Math.abs(image.width - width) <= 1 && Math.abs(image.height - height) <= 1)
      ctx.drawImage(image, 0, 0);
    else
      ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
  }

  function drawSummary(ctx, item, dpi) {
    const rect = rectPx(item, dpi);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.translate(rect.x, rect.y);
    if (item.rotation === 90) {
      ctx.translate(rect.width, 0);
      ctx.rotate(Math.PI / 2);
    }
    root.SigK.printSummary.draw(ctx, item.source.summary, (dpi / 72) * item.scale);
    ctx.restore();
  }

  function drawBorder(ctx, item, dpi) {
    const rect = rectPx(item, dpi);
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, dpi / 144);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }

  // タイルマーク: 隣のタイルと重ならない部分の四隅に、外向きの短い線を描く。
  function drawTileMarks(ctx, core, dpi) {
    const r = rectPx(core, dpi);
    const len = px(MARK_LENGTH, dpi);
    const corners = [[r.x, r.y, -1, -1], [r.x + r.width, r.y, 1, -1], [r.x, r.y + r.height, -1, 1], [r.x + r.width, r.y + r.height, 1, 1]];
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, dpi / 144);
    ctx.beginPath();
    for (const [x, y, dx, dy] of corners) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx * len, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + dy * len);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLabel(ctx, tile, text, dpi) {
    const box = rectPx(tile.labelBox, dpi);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.font = `${(LABEL_PT * dpi) / 72}px "Yu Gothic UI", "Meiryo", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, box.x, box.y + box.height / 2);
    ctx.restore();
  }

  // シート 1 枚を描く。renderPart(source, part, pxPerPt) はページの部分を描いて { canvas, width, height } を返す（print-job.js）。
  // labelOf(tile) はポスターのラベルの文。戻り値は { canvas（jsdom では null）, rendered（描いたページの部分の寸法） }。
  async function composeSheet(doc, sheet, { dpi, forPrint = true, grayscale = false, inkSave = false, renderPart, labelOf = () => '' }) {
    const target = hasCanvas(doc) ? sheetCanvas(doc, sheet, dpi, forPrint) : null;
    const rendered = [];
    for (const item of sheet.items) {
      if (item.source === null || item.source === undefined)
        continue;
      if (Array.isArray(item.source.summary)) {
        if (target !== null)
          drawSummary(target.ctx, item, dpi);
      } else {
        const visible = R().visiblePart(item, sheet);
        if (visible === null)
          continue;
        const drawn = await renderPart(item.source, visible.part, (dpi / 72) * item.scale);
        rendered.push({
          page: item.page, sourcePage: drawn.sourcePage, width: drawn.width, height: drawn.height, rotation: drawn.rotation, box: drawn.box ?? null, scale: drawn.scale,
        });
        if (target !== null && drawn.canvas !== null)
          paste(target.ctx, drawn.canvas, snapRect(rectPx(visible.dest, dpi)), item.rotation, { grayscale, inkSave });
        root.SigK.pageImage.release(drawn.canvas);
      }
      if (target !== null && item.border === true)
        drawBorder(target.ctx, item, dpi);
    }
    if (target !== null && sheet.tile) {
      if (sheet.tile.marks)
        drawTileMarks(target.ctx, sheet.tile.core, dpi);
      if (sheet.tile.label !== null)
        drawLabel(target.ctx, sheet.tile, labelOf(sheet.tile), dpi);
    }
    return { canvas: target?.canvas ?? null, rendered };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSheetRender = { INK_SAVE_DENSITY, sheetPixels, cappedDpi, snapRect, composeSheet };
})(typeof window !== 'undefined' ? window : globalThis);
