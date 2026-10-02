(function (root) {
  'use strict';

  // テキストの塗りと枠線を画面と印刷に描く部品（spec-4b-4a 確定事項D1〜D3）。free-text-shape.js の svgOf・paint が呼ぶ。
  //
  // 座標は箱の左上を原点にした表示の向き（free-text-shape.js が箱の左上へ移して回してから描く）。塗りは箱いっぱい、枠線は箱の内側
  // （線の太さの半分だけ入れた四角）に描く。不透明度が 1 未満の印刷は、塗り・枠線・文字を箱だけの別の canvas に不透明で描いてから
  // 重ねる（塗りと枠線と文字が重なっても濃くならない。図形と同じ。shape-print-layer.js）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function hasDecor(entry) {
    return (entry.fill ?? null) !== null || (entry.borderColor ?? null) !== null;
  }

  // 箱の大きさ（表示の向き・CSS px）。
  function boxOf(entry, scale) {
    const { width, height } = root.SigK.freeTextGeometry.frameSize(entry.rect, entry.rotation);
    return { width: width * scale, height: height * scale };
  }

  function rectElement(doc, attributes) {
    const node = doc.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  // SVG の塗りと枠線（文字より先に置く）。飾りが無ければ空。
  function svgParts(doc, entry, scale) {
    const { width, height } = boxOf(entry, scale);
    const parts = [];
    if ((entry.fill ?? null) !== null)
      parts.push(rectElement(doc, { class: 'free-text-fill', x: '0', y: '0', width: fmt(width), height: fmt(height), fill: entry.fill, stroke: 'none' }));
    if ((entry.borderColor ?? null) !== null) {
      const line = entry.borderWidth * scale;
      parts.push(rectElement(doc, {
        class: 'free-text-border', x: fmt(line / 2), y: fmt(line / 2), width: fmt(width - line), height: fmt(height - line),
        fill: 'none', stroke: entry.borderColor, 'stroke-width': fmt(line),
      }));
    }
    return parts;
  }

  // canvas 2D の塗りと枠線（文字より先に描く）。
  function paint(ctx, entry, scale) {
    const { width, height } = boxOf(entry, scale);
    if ((entry.fill ?? null) !== null) {
      ctx.fillStyle = entry.fill;
      ctx.fillRect(0, 0, width, height);
    }
    if ((entry.borderColor ?? null) !== null) {
      const line = entry.borderWidth * scale;
      ctx.strokeStyle = entry.borderColor;
      ctx.lineWidth = line;
      ctx.lineJoin = 'miter';
      ctx.strokeRect(line / 2, line / 2, width - line, height - line);
    }
  }

  // 印刷の別の canvas（箱を回した外接の大きさ。ページの canvas と同じ座標で描ける）。作れなければ null（そのまま重ねて描く）。
  // origin は箱の左上（表示の座標）、angle は画面での回転（度）。
  function layerFor(ctx, entry, origin, angle, scale) {
    const { width, height } = boxOf(entry, scale);
    const radians = (angle * Math.PI) / 180;
    const turn = ([x, y]) => [origin[0] + x * Math.cos(radians) - y * Math.sin(radians), origin[1] + x * Math.sin(radians) + y * Math.cos(radians)];
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(turn);
    const pad = root.SigK.shapePrintLayer.LAYER_PADDING;
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return root.SigK.shapePrintLayer.layerOf(ctx, { left: Math.min(...xs) - pad, top: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextDecorGraphics = { hasDecor, svgParts, paint, layerFor };
})(typeof window !== 'undefined' ? window : globalThis);
