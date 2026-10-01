(function (root) {
  'use strict';

  // 画面の図形・ペン（spec-4-3 確定事項8・11・25、spec-4b-1b 確定事項29〜33・40〜42）。
  //
  // SVG の層に置く <g>（svgOf）と、印刷用に canvas 2D へ同じ絵を描く口（paint）。どちらも shape-figure.js の部品を描くだけで、
  // 幾何は持たない。free-text-shape.js と同じ位置づけで、annotation-layer.js が kind で委ねる。
  // 不透明度は、画面では annotation-layer.js の <g opacity> が 1 つの絵として薄める。印刷では別の canvas に不透明で描いてから
  // alpha で重ねる（確定事項40）。どちらも、塗りと線・矢印の軸と矢じり・ペンの線どうしが重なっても濃くならず、保存の外観の
  // 透明グループ（確定事項31）と同じ見え方になる。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function figure() {
    return root.SigK.shapeFigure;
  }

  // 印刷の別の canvas と回転（shape-print-layer.js）。
  function printLayer() {
    return root.SigK.shapePrintLayer;
  }

  // 属性に書く数。小数 2 桁で十分で、浮動小数のごみを残さない。
  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function same(point) {
    return point;
  }

  function element(doc, tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  function attributesOf(part) {
    switch (part.type) {
      case 'rect': return { x: fmt(part.x), y: fmt(part.y), width: fmt(part.width), height: fmt(part.height) };
      case 'ellipse': return { cx: fmt(part.cx), cy: fmt(part.cy), rx: fmt(part.rx), ry: fmt(part.ry) };
      case 'line': return { x1: fmt(part.from[0]), y1: fmt(part.from[1]), x2: fmt(part.to[0]), y2: fmt(part.to[1]) };
      case 'polyline': return { points: part.points.map((point) => point.map(fmt).join(',')).join(' '), fill: 'none' };
      default: return { d: root.SigK.shapeOutline.svgPathOf(part.segments, same) };
    }
  }

  // 部品 1 つの要素。破線の部品は間隔と端を自分に付ける（矢じりは <g> の丸い端のまま）。
  function partElement(doc, part) {
    const attributes = attributesOf(part);
    if (part.dash !== undefined)
      attributes['stroke-dasharray'] = part.dash.map(fmt).join(' ');
    if (part.cap !== undefined)
      attributes['stroke-linecap'] = part.cap;
    return element(doc, part.type, attributes);
  }

  // 図形 1 つの <g>。線と塗りの属性は <g> に付け、中に部品を置く。線なし・塗りなしは 'none'。回した四角・丸は、回す前の
  // 部品を描いて <g> を箱の中心まわりに回す（spec-4b-2 確定事項6）。
  function svgOf(doc, entry, viewport) {
    const shape = figure().figureOf(entry, viewport);
    const group = element(doc, 'g', {
      class: `shape ${entry.kind}`,
      stroke: shape.stroke ?? 'none',
      'stroke-width': fmt(shape.width),
      fill: shape.fill ?? 'none',
      'stroke-linecap': shape.cap,
      'stroke-linejoin': shape.join,
    });
    const transform = root.SigK.shapeRotation?.svgTransformOf(entry, viewport) ?? null;
    if (transform !== null)
      group.setAttribute('transform', transform);
    group.append(...shape.parts.map((part) => partElement(doc, part)));
    return group;
  }

  // 部品を canvas の path に引く（rect は fillRect・strokeRect で描くので呼ばない）。
  function tracePart(ctx, part) {
    if (part.type === 'path') {
      root.SigK.shapeOutline.tracePath(ctx, part.segments, same);
      return;
    }
    ctx.beginPath();
    if (part.type === 'ellipse') {
      ctx.ellipse(part.cx, part.cy, part.rx, part.ry, 0, 0, Math.PI * 2);
      return;
    }
    const points = part.type === 'line' ? [part.from, part.to] : part.points;
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
  }

  // 部品を不透明で描く。塗りを先に、線をあとに（保存の外観の B と同じ順）。
  function drawFigure(ctx, shape) {
    if (shape.stroke !== null)
      ctx.strokeStyle = shape.stroke;
    if (shape.fill !== null)
      ctx.fillStyle = shape.fill;
    ctx.lineWidth = shape.width;
    ctx.lineJoin = shape.join;
    for (const part of shape.parts) {
      ctx.lineCap = part.cap ?? shape.cap;
      ctx.setLineDash(part.dash ?? []);
      const filled = shape.fill !== null && part.fillable === true;
      if (part.type === 'rect') {
        if (filled)
          ctx.fillRect(part.x, part.y, part.width, part.height);
        if (shape.stroke !== null)
          ctx.strokeRect(part.x, part.y, part.width, part.height);
        continue;
      }
      tracePart(ctx, part);
      if (filled)
        ctx.fill();
      if (shape.stroke !== null)
        ctx.stroke();
    }
  }

  // 同じ絵を canvas 2D に描く（印刷。spec-4-3 確定事項25）。ctx は viewport と同じ座標系（CSS px 相当）で受ける。
  // 不透明度が 1 未満なら別の canvas に不透明で描いてから重ねる。別の canvas を作れなければ globalAlpha のまま描く。
  // 回した四角・丸は canvas を回してから描く（spec-4b-2 確定事項7）。
  function paint(ctx, entry, viewport) {
    const shape = figure().figureOf(entry, viewport);
    const alpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    const turn = root.SigK.shapeRotation?.viewRotationOf(entry, viewport) ?? null;
    const layer = alpha < 1 ? printLayer().layerOf(ctx, printLayer().turnedExtent(printLayer().extentOf(shape), turn)) : null;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (layer === null) {
      printLayer().turnContext(ctx, turn);
      drawFigure(ctx, shape);
    } else {
      printLayer().turnContext(layer.ctx, turn);
      drawFigure(layer.ctx, shape);
      ctx.drawImage(layer.canvas, layer.x, layer.y);
      // 早めに手放す（page-image.js の release と同じ）。
      layer.canvas.width = 0;
      layer.canvas.height = 0;
    }
    ctx.restore();
    return 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeGraphics = { svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
