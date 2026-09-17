(function (root) {
  'use strict';

  // 画面の図形・ペン（spec-4-3 確定事項8・11・25）。
  //
  // SVG の層に置く <g>（svgOf）と、印刷用に canvas 2D へ同じ絵を描く口（paint）。
  // free-text-shape.js と同じ位置づけで、annotation-layer.js が kind で委ねる。
  // 幾何は紙の座標（pt）で決めて viewport で表示へ直す。矢じりの翼は shape-geometry.js の
  // arrowHead（保存の外観と同じ式）で紙の座標に置いてから直すので、回転した紙でも同じ点になる。
  // 矩形・楕円の線は箱の内側に収める（線幅の半分だけ内へ。保存の外観と同じ）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  // 属性に書く数。小数 2 桁で十分で、浮動小数のごみを残さない。
  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 紙の座標の箱 [x1 y1 x2 y2] を表示の px の箱にする。回転した紙では角の対応が変わるので min/max で組む。
  function viewBoxOf(rect, viewport) {
    const a = viewport.convertToViewportPoint(rect[0], rect[1]);
    const b = viewport.convertToViewportPoint(rect[2], rect[3]);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    return { x: round(x), y: round(y), width: round(Math.abs(b[0] - a[0])), height: round(Math.abs(b[1] - a[1])) };
  }

  // 線幅の半分だけ内側の箱（矩形・楕円）。
  function innerBoxOf(entry, viewport) {
    const box = viewBoxOf(entry.rect, viewport);
    const inset = (entry.lineWidth * (viewport.scale ?? 1)) / 2;
    return {
      x: round(box.x + inset), y: round(box.y + inset),
      width: round(Math.max(0, box.width - inset * 2)), height: round(Math.max(0, box.height - inset * 2)),
    };
  }

  function toView(point, viewport) {
    return viewport.convertToViewportPoint(point[0], point[1]);
  }

  // 矢じりの翼 → 終点 → 翼（表示の px）。
  function arrowPoints(entry, viewport) {
    const [from, to] = entry.paths[0];
    const [left, right] = geometry().arrowHead(from, to, entry.lineWidth);
    return [left, to, right].map((point) => toView(point, viewport));
  }

  function isRounded(kind) {
    return kind !== 'square';
  }

  function element(doc, tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  function polyline(doc, points) {
    return element(doc, 'polyline', { points: points.map((point) => point.map(fmt).join(',')).join(' '), fill: 'none' });
  }

  function primitivesOf(doc, entry, viewport) {
    switch (entry.kind) {
      case 'square': {
        const box = innerBoxOf(entry, viewport);
        return [element(doc, 'rect', { x: fmt(box.x), y: fmt(box.y), width: fmt(box.width), height: fmt(box.height) })];
      }
      case 'circle': {
        const box = innerBoxOf(entry, viewport);
        return [element(doc, 'ellipse', {
          cx: fmt(box.x + box.width / 2), cy: fmt(box.y + box.height / 2), rx: fmt(box.width / 2), ry: fmt(box.height / 2),
        })];
      }
      case 'line':
      case 'arrow': {
        const [from, to] = entry.paths[0].map((point) => toView(point, viewport));
        const line = element(doc, 'line', { x1: fmt(from[0]), y1: fmt(from[1]), x2: fmt(to[0]), y2: fmt(to[1]) });
        return entry.kind === 'arrow' ? [line, polyline(doc, arrowPoints(entry, viewport))] : [line];
      }
      default:
        return entry.paths.map((path) => polyline(doc, path.map((point) => toView(point, viewport))));
    }
  }

  // 図形 1 つの <g>。線の属性は <g> に付け、中に矩形・楕円・線・折れ線を置く。
  function svgOf(doc, entry, viewport) {
    const rounded = isRounded(entry.kind);
    const group = element(doc, 'g', {
      class: `shape ${entry.kind}`,
      stroke: entry.color,
      'stroke-width': fmt(entry.lineWidth * (viewport.scale ?? 1)),
      fill: 'none',
      'stroke-linecap': rounded ? 'round' : 'butt',
      'stroke-linejoin': rounded ? 'round' : 'miter',
    });
    group.append(...primitivesOf(doc, entry, viewport));
    return group;
  }

  function strokePath(ctx, points) {
    ctx.beginPath();
    points.forEach((point, index) => (index === 0 ? ctx.moveTo(point[0], point[1]) : ctx.lineTo(point[0], point[1])));
    ctx.stroke();
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項25）。ctx は viewport と同じ座標系（CSS px 相当）で受ける。
  function paint(ctx, entry, viewport) {
    ctx.save();
    ctx.globalAlpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    ctx.strokeStyle = entry.color;
    ctx.lineWidth = entry.lineWidth * (viewport.scale ?? 1);
    ctx.lineCap = isRounded(entry.kind) ? 'round' : 'butt';
    ctx.lineJoin = isRounded(entry.kind) ? 'round' : 'miter';
    if (entry.kind === 'square') {
      const box = innerBoxOf(entry, viewport);
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    } else if (entry.kind === 'circle') {
      const box = innerBoxOf(entry, viewport);
      ctx.beginPath();
      ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (entry.kind === 'ink') {
      for (const path of entry.paths)
        strokePath(ctx, path.map((point) => toView(point, viewport)));
    } else {
      strokePath(ctx, entry.paths[0].map((point) => toView(point, viewport)));
      if (entry.kind === 'arrow')
        strokePath(ctx, arrowPoints(entry, viewport));
    }
    ctx.restore();
    return 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeGraphics = { viewBoxOf, svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
