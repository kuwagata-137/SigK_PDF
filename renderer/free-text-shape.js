(function (root) {
  'use strict';

  // 画面のテキスト注釈（spec-4-2 確定事項10・14・29・33）。
  //
  // SVG の <text> と、印刷用の canvas 2D の描き手を持つ。同梱フォントの先読みと幅の計測は free-text-font.js、
  // 座標の計算は free-text-geometry.js。
  // SVG と canvas で同じ位置・角度・ベースラインにするのは、画面と紙で見た目を
  // ずらさないためである（annotation-layer.js と同じ考え）。新しい形（spec-4b-4a）の行と中身の位置は
  // free-text-metrics.js が決め、太字は Bold の書体、斜体は擬似斜体（font-style: italic。保存の Tm 0.25 と同じ形。
  // 事前調査 B）で描く。詰め（kerning）と合字は使わない（保存の字の並びとそろえる。事前調査 E）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 書体と字の幅（free-text-font.js へ移した。spec-4b-4b）。今までの呼び名（freeTextShape.measure など）のまま渡す。
  function font() {
    return root.SigK.freeTextFont;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  // 行と中身の位置（箱の左上から。pt）。free-text-metrics.js が無ければ（単体のテスト）今までの形として改行で分ける。
  function linesAndInset(entry) {
    const metrics = root.SigK.freeTextMetrics;
    if (metrics !== undefined) {
      const { lines, inset } = metrics.layoutOfEntry(entry);
      return { lines, inset: [inset.left, inset.top] };
    }
    const { PADDING } = geometry();
    return { lines: geometry().linesOf(entry.text), inset: [PADDING, PADDING] };
  }

  // 画面に描くための位置。origin は表示の左上（CSS px）、angle は画面での回転（時計回り）。
  function layoutOf(entry, viewport) {
    const [x, y] = geometry().frameOrigin(entry.rect, entry.rotation);
    return {
      origin: viewport.convertToViewportPoint(x, y),
      angle: geometry().screenAngle(viewport.rotation ?? 0, entry.rotation),
      scale: viewport.scale ?? 1,
      ...linesAndInset(entry),
    };
  }

  // 行ごとの x・y（箱の左上からの CSS px）。inset は中身の左上（pt）。
  function linePositions(lines, fontSize, scale, inset) {
    const { BASELINE, LINE_HEIGHT } = geometry();
    return lines.map((line, index) => ({
      line,
      x: inset[0] * scale,
      y: (inset[1] + BASELINE * fontSize + LINE_HEIGHT * fontSize * index) * scale,
    }));
  }

  // SVG の <g>。行ごとに <text> を置き、箱の左上へ移して回す。
  function svgOf(doc, entry, viewport) {
    const { origin, angle, scale, lines, inset } = layoutOf(entry, viewport);
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'free-text');
    group.setAttribute('fill', entry.color);
    group.setAttribute('transform', `translate(${fmt(origin[0])} ${fmt(origin[1])}) rotate(${angle})`);
    if (entry.bold === true)
      group.setAttribute('font-weight', '700');
    if (entry.italic === true)
      group.setAttribute('font-style', 'italic');
    // 塗りと枠線は文字より先（spec-4b-4a 確定事項D1。free-text-decor-graphics.js）。
    group.append(...(root.SigK.freeTextDecorGraphics?.svgParts(doc, entry, scale) ?? []));
    for (const { line, x, y } of linePositions(lines, entry.fontSize, scale, inset)) {
      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', fmt(x));
      text.setAttribute('y', fmt(y));
      text.setAttribute('font-size', fmt(entry.fontSize * scale));
      text.setAttribute('xml:space', 'preserve');
      text.textContent = line;
      group.append(text);
    }
    return group;
  }

  // 箱の左上へ移して回し、塗りと枠線、文字の順に描く。alpha は重ねる不透明度。
  function drawOn(ctx, entry, { origin, angle, scale, lines, inset }, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(origin[0], origin[1]);
    ctx.rotate((angle * Math.PI) / 180);
    root.SigK.freeTextDecorGraphics?.paint(ctx, entry, scale);
    ctx.font = font().fontOf(entry.fontSize * scale, entry.bold === true, entry.italic === true);
    // 詰めと合字を切る（spec-4b-4a 確定事項D3。optimizeSpeed は合字を作らない）。
    ctx.fontKerning = 'none';
    ctx.textRendering = 'optimizeSpeed';
    ctx.fillStyle = entry.color;
    ctx.textBaseline = 'alphabetic';
    for (const { line, x, y } of linePositions(lines, entry.fontSize, scale, inset))
      ctx.fillText(line, x, y);
    ctx.restore();
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項29）。戻り値は描いた行数。不透明度 1 未満で塗りか枠線があれば、別の canvas に
  // 不透明で描いてから重ねる（spec-4b-4a 確定事項D3）。
  function paint(ctx, entry, viewport) {
    const layout = layoutOf(entry, viewport);
    const alpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    const decor = root.SigK.freeTextDecorGraphics;
    const layer = alpha < 1 && decor?.hasDecor(entry) ? decor.layerFor(ctx, entry, layout.origin, layout.angle, layout.scale) : null;
    if (layer === null) {
      drawOn(ctx, entry, layout, alpha);
      return layout.lines.length;
    }
    drawOn(layer.ctx, entry, layout, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
    return layout.lines.length;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextShape = {
    get FAMILY() { return font().FAMILY; },
    get ADVANCE_PX() { return font().ADVANCE_PX; },
    fontOf: (...args) => font().fontOf(...args),
    ensureLoaded: (...args) => font().ensureLoaded(...args),
    isLoaded: () => font().isLoaded(),
    measure: (...args) => font().measure(...args),
    advanceOf: (...args) => font().advanceOf(...args),
    layoutOf,
    svgOf,
    paint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
