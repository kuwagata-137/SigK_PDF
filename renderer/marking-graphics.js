(function (root) {
  'use strict';

  // 画面と印刷のマーキング（spec-7-9 確定事項F2・F3・F5）。
  //
  // SVG の層に置く <g>（svgOf）と、印刷用に canvas 2D へ同じ絵を描く口（paint）。どちらも marking-geometry.js の部品（紙の座標）を
  // viewport で表示の座標へ直して描くだけで、幾何は持たない。annotation-layer.js が kind で委ねる。線・中の円の塗り・番号・「！」は
  // どれも書き込みの色で、中は塗らない（透ける）。不透明度は、画面では annotation-layer.js の <g opacity> が 1 つの絵として薄め、
  // 印刷では別の canvas に不透明で描いてから alpha で重ねる（shape-graphics.js と同じ。線どうしが重なっても濃くならない）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function element(doc, tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  // 部品を表示の座標（px）へ直す。円は中心と半径、線と折れ線は点、太さは倍率を掛ける。
  function viewPartsOf(entry, viewport) {
    const scale = viewport.scale ?? 1;
    const toView = (point) => viewport.convertToViewportPoint(point[0], point[1]);
    return root.SigK.markingGeometry.partsOf(entry).map((part) => {
      switch (part.type) {
        case 'circle':
        case 'disc': return { ...part, center: toView(part.center), r: part.r * scale, width: (part.width ?? 0) * scale };
        case 'line': return { ...part, from: toView(part.from), to: toView(part.to), width: part.width * scale };
        default: return { ...part, points: part.points.map(toView), width: part.width * scale };
      }
    });
  }

  function pointsText(points) {
    return points.map((point) => point.map(fmt).join(',')).join(' ');
  }

  function partElement(doc, part, color) {
    switch (part.type) {
      case 'circle': return element(doc, 'circle', { cx: fmt(part.center[0]), cy: fmt(part.center[1]), r: fmt(part.r), 'stroke-width': fmt(part.width) });
      case 'disc': return element(doc, 'circle', { cx: fmt(part.center[0]), cy: fmt(part.center[1]), r: fmt(part.r), fill: color, stroke: 'none' });
      case 'line': return element(doc, 'line', {
        x1: fmt(part.from[0]), y1: fmt(part.from[1]), x2: fmt(part.to[0]), y2: fmt(part.to[1]), 'stroke-width': fmt(part.width), 'stroke-linecap': part.cap,
      });
      default: return element(doc, part.closed ? 'polygon' : 'polyline', { points: pointsText(part.points), 'stroke-width': fmt(part.width) });
    }
  }

  // マーキング 1 つの <g>。線の色は <g> に付け、中は塗らない。
  function svgOf(doc, entry, viewport) {
    const group = element(doc, 'g', {
      class: `marking ${entry.marking.shape}`, stroke: entry.color, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    group.append(...viewPartsOf(entry, viewport).map((part) => partElement(doc, part, entry.color)));
    return group;
  }

  function tracePart(ctx, part) {
    ctx.beginPath();
    if (part.type === 'circle' || part.type === 'disc') {
      ctx.arc(part.center[0], part.center[1], part.r, 0, Math.PI * 2);
      return;
    }
    const points = part.type === 'line' ? [part.from, part.to] : part.points;
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
    if (part.closed === true)
      ctx.closePath();
  }

  function drawParts(ctx, parts, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    for (const part of parts) {
      tracePart(ctx, part);
      if (part.type === 'disc') {
        ctx.fill();
        continue;
      }
      ctx.lineWidth = part.width;
      ctx.lineCap = part.cap ?? 'round';
      ctx.stroke();
    }
  }

  // 表示の座標の外接（rect を直したもの）に、線の端のための余白を加えた範囲。
  function extentOf(entry, viewport) {
    const box = root.SigK.shapeFigure.viewBoxOf(entry.rect, viewport);
    const pad = root.SigK.shapePrintLayer.LAYER_PADDING + (entry.lineWidth * (viewport.scale ?? 1)) / 2;
    return { left: box.x - pad, top: box.y - pad, right: box.x + box.width + pad, bottom: box.y + box.height + pad };
  }

  // 同じ絵を canvas 2D に描く（印刷）。不透明度が 1 未満なら別の canvas に不透明で描いてから重ねる（作れなければ globalAlpha のまま）。
  function paint(ctx, entry, viewport) {
    const parts = viewPartsOf(entry, viewport);
    const alpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    const layer = alpha < 1 ? root.SigK.shapePrintLayer.layerOf(ctx, extentOf(entry, viewport)) : null;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (layer === null) {
      drawParts(ctx, parts, entry.color);
    } else {
      drawParts(layer.ctx, parts, entry.color);
      ctx.drawImage(layer.canvas, layer.x, layer.y);
      layer.canvas.width = 0;
      layer.canvas.height = 0;
    }
    ctx.restore();
    return 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingGraphics = { svgOf, paint, viewPartsOf };
})(typeof window !== 'undefined' ? window : globalThis);
