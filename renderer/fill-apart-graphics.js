(function (root) {
  'use strict';

  // 塗りと枠線を分けて描く図形の、画面の SVG と印刷の canvas（spec-7-9 確定事項B4・B5・C1〜C4）。
  //
  // 塗りの不透明度が枠線と違う時と、ハッチングがある時（fill-style.js の paintsApart）に、shape-graphics.js から呼ぶ。図形の部品
  // （shape-figure.js の figureOf）のうち塗れる部品 1 つを使い、次の順で描く。
  //   1. 内側: 塗りつぶし（塗りの不透明度）と、その上のハッチング（不透明。部品の形で切り抜く）。
  //      枠線があり枠線の透明度が 0% でない時は、内側から枠線の帯を抜く（塗りを線の内側の縁までに限り、線と塗りの重なる帯を濃くしない。
  //      spec-4b-1b 事前調査 D の v3。SVG は mask、canvas は別の canvas に描いて destination-out）。
  //   2. 枠線（枠線の不透明度）。
  // 枠線の透明度が 0% の時は、枠線が帯を覆うので抜かない。保存の外観（worker/fill-apart-appearance.js）も同じ順と抜き方で描く。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // mask と clipPath の id の通し番号（同じ文書で重ならないように）。
  let serial = 0;

  function graphics() {
    return root.SigK.shapeGraphics;
  }

  function fill() {
    return root.SigK.fillStyle;
  }

  function printLayer() {
    return root.SigK.shapePrintLayer;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function element(doc, tag, attributes = {}) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  // 塗れる部品（四角・丸・閉じた多角形は 1 つだけ持つ）。
  function fillPartOf(shape) {
    return shape.parts.find((part) => part.fillable === true) ?? null;
  }

  // ハッチングの線（表示の座標）と、線の色・幅（px）。ハッチングが無ければ null。
  function hatchOf(entry, viewport) {
    const hatch = fill().hatchOf(entry);
    if (hatch === null)
      return null;
    const geometry = root.SigK.hatchGeometry;
    const toView = (point) => viewport.convertToViewportPoint(point[0], point[1]);
    const lines = geometry.linesOf(geometry.boxOf(entry), hatch).map(([from, to]) => [toView(from), toView(to)]);
    return { lines, color: hatch.color, width: hatch.width * (viewport.scale ?? 1) };
  }

  // 枠線の帯を内側から抜くか（枠線があり、半透明の時）。
  function masksStroke(entry, shape) {
    return shape.stroke !== null && (entry.opacity ?? 1) < 1;
  }

  function strokeAttributes(shape, part, stroke) {
    const attributes = { fill: 'none', stroke, 'stroke-width': fmt(shape.width) };
    if (part.dash !== undefined)
      attributes['stroke-dasharray'] = part.dash.map(fmt).join(' ');
    return attributes;
  }

  function partOf(doc, part, attributes) {
    const node = graphics().partElement(doc, part);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  // 内側（塗りつぶしとハッチング）の <g>。defs に切り抜きと抜く帯を置く。
  function insideOf(doc, entry, shape, part, hatch, defs) {
    const inside = element(doc, 'g', { class: 'fill-inside' });
    if (shape.fill !== null)
      inside.append(partOf(doc, part, { fill: shape.fill, 'fill-opacity': fmt(fill().fillOpacityOf(entry)), stroke: 'none' }));
    if (hatch !== null) {
      const clip = element(doc, 'clipPath', { id: `sigk-hatch-clip-${(serial += 1)}` });
      clip.append(partOf(doc, part, { stroke: 'none' }));
      defs.append(clip);
      const lines = element(doc, 'g', { class: 'hatch', 'clip-path': `url(#${clip.id})`, stroke: hatch.color, 'stroke-width': fmt(hatch.width), 'stroke-linecap': 'butt', fill: 'none' });
      lines.append(...hatch.lines.map(([from, to]) => element(doc, 'line', { x1: fmt(from[0]), y1: fmt(from[1]), x2: fmt(to[0]), y2: fmt(to[1]) })));
      inside.append(lines);
    }
    if (masksStroke(entry, shape)) {
      const mask = element(doc, 'mask', { id: `sigk-fill-mask-${(serial += 1)}` });
      mask.append(partOf(doc, part, { fill: '#ffffff', stroke: 'none' }), partOf(doc, part, strokeAttributes(shape, part, '#000000')));
      defs.append(mask);
      inside.setAttribute('mask', `url(#${mask.id})`);
    }
    return inside;
  }

  // 画面の <g>。塗れる部品が無ければ null（呼ぶ側が今までの描き方にする）。
  function svgOf(doc, entry, viewport, shape) {
    const part = fillPartOf(shape);
    if (part === null)
      return null;
    const group = element(doc, 'g', { class: `shape ${entry.kind} apart`, fill: 'none', stroke: 'none', 'stroke-linecap': shape.cap, 'stroke-linejoin': shape.join });
    const transform = root.SigK.shapeRotation?.svgTransformOf(entry, viewport) ?? null;
    if (transform !== null)
      group.setAttribute('transform', transform);
    const defs = element(doc, 'defs');
    group.append(defs, insideOf(doc, entry, shape, part, hatchOf(entry, viewport), defs));
    if (shape.stroke !== null) {
      const stroke = partOf(doc, part, strokeAttributes(shape, part, shape.stroke));
      if ((entry.opacity ?? 1) < 1)
        stroke.setAttribute('opacity', fmt(entry.opacity));
      group.append(stroke);
    }
    return group;
  }

  // 部品の形の path を引く（rect も path にする。切り抜きに使う）。
  function tracePartPath(ctx, part) {
    if (part.type !== 'rect') {
      graphics().tracePart(ctx, part);
      return;
    }
    ctx.beginPath();
    ctx.rect(part.x, part.y, part.width, part.height);
  }

  function paintHatch(ctx, part, hatch) {
    ctx.save();
    tracePartPath(ctx, part);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = hatch.color;
    ctx.lineWidth = hatch.width;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [from, to] of hatch.lines) {
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 内側を描く。masked なら枠線の帯を抜く（別の canvas の時だけ。ページの canvas で抜くと下の絵まで消えるため）。
  function paintInside(ctx, entry, shape, part, hatch, masked) {
    if (shape.fill !== null) {
      ctx.globalAlpha = fill().fillOpacityOf(entry);
      graphics().drawFigure(ctx, { ...shape, stroke: null });
    }
    if (hatch !== null)
      paintHatch(ctx, part, hatch);
    if (masked && masksStroke(entry, shape)) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      graphics().drawFigure(ctx, { ...shape, fill: null, stroke: '#000000' });
    }
  }

  // 印刷（canvas 2D）。turn は回した四角・丸の回転（shape-rotation.js の viewRotationOf）。内側は図形の外接だけの別の canvas に描いて
  // から重ね、枠線は枠線の不透明度でページの canvas に直に描く。別の canvas を作れなければ、帯を抜かずに直に描く。
  function paint(ctx, entry, viewport, shape, turn) {
    const part = fillPartOf(shape);
    if (part === null)
      return false;
    const layer = printLayer().layerOf(ctx, printLayer().turnedExtent(printLayer().extentOf(shape), turn));
    const target = layer === null ? ctx : layer.ctx;
    target.save();
    printLayer().turnContext(target, turn);
    paintInside(target, entry, shape, part, hatchOf(entry, viewport), layer !== null);
    target.restore();
    if (layer !== null) {
      ctx.drawImage(layer.canvas, layer.x, layer.y);
      layer.canvas.width = 0;
      layer.canvas.height = 0;
    }
    if (shape.stroke !== null) {
      ctx.save();
      ctx.globalAlpha = entry.opacity ?? 1;
      printLayer().turnContext(ctx, turn);
      graphics().drawFigure(ctx, { ...shape, fill: null });
      ctx.restore();
    }
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.fillApartGraphics = { svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
