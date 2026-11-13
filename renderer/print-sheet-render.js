(function (root) {
  'use strict';

  // シート（用紙 1 枚の片面）の画像を作る（docs/spec-7-7-print-dialog.md）。
  //
  // 配置（print-sheet-plan.js）どおりに、ページの画像・注釈の一覧ページ・ページ境界線・タイルマーク・ラベルを canvas に描く。
  // ページは用紙に入る部分だけを、用紙の上で dpi の解像度になる倍率で描く（拡大しても粗くならず、縮小しても無駄に大きく描かない）。
  // 印刷する画像（forPrint）は、横のシートを時計回りに 90 度回して縦の用紙の向きにする（print-sheet-geometry.js）。
  // グレースケール (白黒) で印刷(Y) は灰色に、インク / トナーを節約は色を白に近づけて描く（質問 PR3 ③）。
  // jsdom には 2D コンテキストが無い。そのときもページは描かせ（経路と描く範囲を試験で見るため）、シートの canvas は作らない。

  const UM_PER_INCH = 25400;
  // インク / トナーを節約の濃さ（質問 PR3 ③の図の「5 割」。Acrobat は最大 15% の節約なので、ユーザーに改めて伺う）。
  const INK_SAVE_DENSITY = 0.5;
  const MARK_LENGTH = 4000;
  const LABEL_PT = 7;

  const R = () => root.SigK.printPageRegion;

  const px = (um, dpi) => (um / UM_PER_INCH) * dpi;

  function hasCanvas(doc) {
    return root.SigK.pageImage.hasCanvas(doc.defaultView);
  }

  function sheetCanvas(doc, sheet, dpi, forPrint) {
    const width = Math.max(1, Math.round(px(sheet.width, dpi)));
    const height = Math.max(1, Math.round(px(sheet.height, dpi)));
    const turn = forPrint && sheet.landscape;
    const canvas = doc.createElement('canvas');
    canvas.width = turn ? height : width;
    canvas.height = turn ? width : height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (turn) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    }
    return { canvas, ctx };
  }

  function rectPx(rect, dpi) {
    return { x: px(rect.x, dpi), y: px(rect.y, dpi), width: px(rect.width, dpi), height: px(rect.height, dpi) };
  }

  // 描いたページの部分を、枠の向き（rotation が 90 なら時計回り）で dest に描く。
  function paste(ctx, image, dest, rotation, { grayscale, inkSave }) {
    ctx.save();
    if (grayscale)
      ctx.filter = 'grayscale(1)';
    if (inkSave)
      ctx.globalAlpha = INK_SAVE_DENSITY;
    if (rotation === 90) {
      ctx.translate(dest.x + dest.width, dest.y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(image, 0, 0, dest.height, dest.width);
    } else {
      ctx.drawImage(image, dest.x, dest.y, dest.width, dest.height);
    }
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
          paste(target.ctx, drawn.canvas, rectPx(visible.dest, dpi), item.rotation, { grayscale, inkSave });
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
  SigK.printSheetRender = { INK_SAVE_DENSITY, composeSheet };
})(typeof window !== 'undefined' ? window : globalThis);
