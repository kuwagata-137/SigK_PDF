(function (root) {
  'use strict';

  // 印刷で図形を描く別の canvas と回転（spec-4b-1b 確定事項40、spec-4b-2 確定事項7）。
  //
  // shape-graphics.js の paint が使う。不透明度が 1 未満の図形は、図形の外接だけの別の canvas に不透明で描いてから alpha で
  // 重ねる（塗りと線が重なっても濃くならない）。回した四角・丸は canvas を箱の中心まわりに回してから描き、別の canvas は
  // 回した外接の大きさで作る。shape-graphics.js から分けた（spec-4b-2。200 行の目安）。

  // 別の canvas を図形の外接だけの大きさにするときの余白（px）。線の端と角のぶん。
  const LAYER_PADDING = 2;

  function pointsOfPart(part) {
    switch (part.type) {
      case 'rect': return [[part.x, part.y], [part.x + part.width, part.y + part.height]];
      case 'ellipse': return [[part.cx - part.rx, part.cy - part.ry], [part.cx + part.rx, part.cy + part.ry]];
      case 'line': return [part.from, part.to];
      case 'polyline':
      case 'polygon': return part.points;
      default: return part.segments.flatMap((segment) => segment.points);
    }
  }

  // 部品の外接（表示の px）に、線の太さと余白を足したもの。
  function extentOf(shape) {
    const pad = shape.width + LAYER_PADDING;
    const extent = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const [x, y] of shape.parts.flatMap(pointsOfPart)) {
      extent.left = Math.min(extent.left, x - pad);
      extent.top = Math.min(extent.top, y - pad);
      extent.right = Math.max(extent.right, x + pad);
      extent.bottom = Math.max(extent.bottom, y + pad);
    }
    return extent;
  }

  // 図形の外接だけの別の canvas（ページの canvas と同じ座標で描けるよう、左上へずらす）。ページの外に出る分は切る。
  // 作れない ctx（テストの記録用など）と、描く所が無いときは null。
  function layerOf(ctx, extent) {
    const page = ctx.canvas;
    if (typeof page?.ownerDocument?.createElement !== 'function')
      return null;
    const x = Math.max(0, Math.floor(extent.left));
    const y = Math.max(0, Math.floor(extent.top));
    const width = Math.min(page.width, Math.ceil(extent.right)) - x;
    const height = Math.min(page.height, Math.ceil(extent.bottom)) - y;
    if (!(width > 0 && height > 0))
      return null;
    const canvas = page.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const layer = canvas.getContext('2d');
    if (!layer)
      return null;
    layer.translate(-x, -y);
    return { canvas, ctx: layer, x, y };
  }

  // 回した四角・丸の外接（回す前の部品の外接の 4 隅を回して囲む。spec-4b-2 確定事項7）。
  function turnedExtent(extent, turn) {
    if (turn === null)
      return extent;
    const rotate = root.SigK.shapeRotation.rotateViewPoint;
    const corners = [[extent.left, extent.top], [extent.right, extent.top], [extent.left, extent.bottom], [extent.right, extent.bottom]]
      .map((point) => rotate(point, turn.center, turn.angle));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  // canvas を箱の中心まわりに回す（画面の時計回り）。
  function turnContext(ctx, turn) {
    if (turn === null)
      return;
    const [cx, cy] = turn.center;
    ctx.translate(cx, cy);
    ctx.rotate((turn.angle * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapePrintLayer = { LAYER_PADDING, extentOf, layerOf, turnedExtent, turnContext };
})(typeof window !== 'undefined' ? window : globalThis);
