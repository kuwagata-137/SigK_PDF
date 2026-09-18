(function (root) {
  'use strict';

  // 画面の付箋（ノート注釈。spec-4-4 確定事項8・10〜14・34・40）。
  //
  // SVG の層に置く <g>（svgOf）と、印刷用に canvas 2D へ同じ絵を描く口（paint）。
  // free-text-shape.js・shape-graphics.js と同じ位置づけで、annotation-layer.js が kind で委ねる。
  // 付箋は PDF の規格どおり NoZoom・NoRotate として振る舞う: /Rect の左上 (x1, y2) だけを紙 ↔ 表示で
  // 往復し、そこから右下へ倍率に依らず一定の大きさ（20pt × 96/72 px）で上向きに描く。当たり判定・
  // 選択枠・一覧からの寄せもこの箱（boxOf）を使う。印刷は /Rect の大きさ（20pt × 倍率）で描く。
  // 絵（NOTE_SHAPE）は worker/note-appearance.js と同じ配列で、一致はテストで見張る。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 付箋の大きさ（pt）と、画面での大きさ（CSS px。viewer-layout.js の CSS_UNITS と同じ 96/72）。
  const ICON_SIZE = 20;
  const CSS_UNITS = 96 / 72;
  const ICON_PX = ICON_SIZE * CSS_UNITS;
  const STROKE_COLOR = '#4a4a4a';

  // 角丸の吹き出し（角の半径 1.5・κ 0.5523）と、左下のしっぽ、本文の印 2 本。20×20・y 下向き。
  const NOTE_SHAPE = Object.freeze({
    outline: Object.freeze([
      ['M', 3, 1.5], ['L', 17, 1.5], ['C', 17.83, 1.5, 18.5, 2.17, 18.5, 3], ['L', 18.5, 13],
      ['C', 18.5, 13.83, 17.83, 14.5, 17, 14.5], ['L', 9, 14.5], ['L', 5.5, 18], ['L', 5.5, 14.5], ['L', 3, 14.5],
      ['C', 2.17, 14.5, 1.5, 13.83, 1.5, 13], ['L', 1.5, 3], ['C', 1.5, 2.17, 2.17, 1.5, 3, 1.5],
    ].map((segment) => Object.freeze(segment))),
    lines: Object.freeze([Object.freeze([[5.5, 6.5], [14.5, 6.5]]), Object.freeze([[5.5, 9.5], [11.5, 9.5]])]),
  });

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 基準の点（/Rect の左上）。紙の座標。
  function anchorOf(entry) {
    return [entry.rect[0], entry.rect[3]];
  }

  // 基準の点から 20×20 の箱（紙の座標・小数 2 桁）。
  function rectFromAnchor([x, y]) {
    return [round(x), round(y - ICON_SIZE), round(x + ICON_SIZE), round(y)];
  }

  // 箱の四隅（UL・UR・LL・LR。markup-quads.js と同じ約束）。
  function quadOfRect([x1, y1, x2, y2]) {
    return [x1, y2, x2, y2, x1, y1, x2, y1];
  }

  // 画面の箱（.pdf-page 基準の CSS px）。倍率・回転に依らず ICON_PX の正方形。
  function boxOf(entry, viewport) {
    const [x, y] = viewport.convertToViewportPoint(...anchorOf(entry));
    return { x, y, width: ICON_PX, height: ICON_PX };
  }

  // 表示の点が付箋に当たるか。
  function hits(entry, point, viewport) {
    const box = boxOf(entry, viewport);
    return point[0] >= box.x && point[0] <= box.x + box.width && point[1] >= box.y && point[1] <= box.y + box.height;
  }

  function outlinePath() {
    const parts = NOTE_SHAPE.outline.map(([op, ...values]) => `${op}${values.map(fmt).join(' ')}`);
    return `${parts.join(' ')} Z`;
  }

  function linesPath() {
    return NOTE_SHAPE.lines.map(([from, to]) => `M${fmt(from[0])} ${fmt(from[1])} L${fmt(to[0])} ${fmt(to[1])}`).join(' ');
  }

  function pathElement(doc, d, attributes) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    for (const [name, value] of Object.entries(attributes))
      path.setAttribute(name, value);
    return path;
  }

  // 付箋の <g>。translate で箱の左上へ、scale で 20 の絵を ICON_PX に。
  function svgOf(doc, entry, viewport) {
    const box = boxOf(entry, viewport);
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'note');
    group.setAttribute('transform', `translate(${fmt(box.x)} ${fmt(box.y)}) scale(${fmt(ICON_PX / ICON_SIZE)})`);
    const stroke = { stroke: STROKE_COLOR, 'stroke-width': '1', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    group.append(
      pathElement(doc, outlinePath(), { fill: entry.color, ...stroke }),
      pathElement(doc, linesPath(), { fill: 'none', ...stroke }),
    );
    return group;
  }

  function traceOutline(ctx) {
    ctx.beginPath();
    for (const [op, ...values] of NOTE_SHAPE.outline) {
      if (op === 'M')
        ctx.moveTo(values[0], values[1]);
      else if (op === 'L')
        ctx.lineTo(values[0], values[1]);
      else
        ctx.bezierCurveTo(...values);
    }
    ctx.closePath();
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項34）。ctx は viewport と同じ座標系で受け、
  // 印刷では /Rect の大きさ（20pt × 倍率）にする。
  function paint(ctx, entry, viewport) {
    const [x, y] = viewport.convertToViewportPoint(...anchorOf(entry));
    const scale = viewport.scale ?? 1;
    ctx.save();
    ctx.globalAlpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = entry.color;
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    traceOutline(ctx);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (const [from, to] of NOTE_SHAPE.lines) {
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
    }
    ctx.stroke();
    ctx.restore();
    return 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.noteGraphics = { ICON_SIZE, ICON_PX, STROKE_COLOR, NOTE_SHAPE, anchorOf, rectFromAnchor, quadOfRect, boxOf, hits, svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
