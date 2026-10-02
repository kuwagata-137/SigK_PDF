(function (root) {
  'use strict';

  // ハイライト・下線・取り消し線の描き手（spec-4-1 確定事項5・28・37）。annotation-layer.js から移した（spec-4b-4b。200 行の目安。
  // 中身は変えていない）。ハイライトは mix-blend-mode: multiply の多角形（文字が透ける）、下線・取り消し線は <line>。
  // 同じ絵を canvas 2D にも描く（印刷。ハイライトは multiply で塗る）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function quads() {
    return root.SigK.markupQuads;
  }

  // 属性に書く数。小数 2 桁で十分で、浮動小数のごみを残さない。
  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function shapeOf(doc, entry, points) {
    if (entry.kind === 'highlight') {
      const polygon = doc.createElementNS(SVG_NS, 'polygon');
      const [ul, ur, ll, lr] = points;
      polygon.setAttribute('points', [ul, ur, lr, ll].map((point) => point.map(fmt).join(',')).join(' '));
      polygon.setAttribute('fill', entry.color);
      polygon.setAttribute('class', 'highlight');
      return polygon;
    }
    const line = doc.createElementNS(SVG_NS, 'line');
    const [from, to] = quads().lineEndpoints(points, entry.kind);
    line.setAttribute('x1', fmt(from[0]));
    line.setAttribute('y1', fmt(from[1]));
    line.setAttribute('x2', fmt(to[0]));
    line.setAttribute('y2', fmt(to[1]));
    line.setAttribute('stroke', entry.color);
    line.setAttribute('stroke-width', fmt(quads().lineWidth(points)));
    line.setAttribute('stroke-linecap', 'butt');
    line.setAttribute('class', entry.kind);
    return line;
  }

  // 四角ごとの多角形か線（annotation-layer.js の <g> に入れる）。
  function svgOf(doc, entry, viewport) {
    return entry.quads.map((quad) => shapeOf(doc, entry, quads().quadToViewport(quad, viewport)));
  }

  function paintQuad(ctx, entry, points) {
    if (entry.kind === 'highlight') {
      const [ul, ur, ll, lr] = points;
      ctx.beginPath();
      ctx.moveTo(ul[0], ul[1]);
      ctx.lineTo(ur[0], ur[1]);
      ctx.lineTo(lr[0], lr[1]);
      ctx.lineTo(ll[0], ll[1]);
      ctx.closePath();
      ctx.fill();
      return;
    }
    const [from, to] = quads().lineEndpoints(points, entry.kind);
    ctx.lineWidth = quads().lineWidth(points);
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }

  // 同じ絵を canvas 2D に描く（印刷）。ctx は viewport と同じ座標系（CSS px 相当）。
  function paint(ctx, entry, viewport) {
    ctx.save();
    ctx.globalAlpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    ctx.globalCompositeOperation = entry.kind === 'highlight' ? 'multiply' : 'source-over';
    ctx.fillStyle = entry.color;
    ctx.strokeStyle = entry.color;
    ctx.lineCap = 'butt';
    for (const quad of entry.quads)
      paintQuad(ctx, entry, quads().quadToViewport(quad, viewport));
    ctx.restore();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markupGraphics = { svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
