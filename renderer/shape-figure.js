(function (root) {
  'use strict';

  // 図形・ペン 1 つを表示の座標で描く部品の純粋層（spec-4-3 確定事項8・11・25、spec-4b-1b 確定事項29〜33・40〜42）。
  // DOM に触れない。
  //
  // 画面の SVG と印刷の canvas（shape-graphics.js）が同じ部品を描くので、画面と紙で見た目がずれない。幾何は紙の座標（pt）で
  // 決めて viewport で表示へ直す（回転した紙でも同じ点になる）。実線の四角・丸は rect・ellipse の部品、破線と雲形は保存の外観と
  // 同じ紙の座標の点列（shape-outline.js・cloud-geometry.js）を表示へ直した path にする（始点と向きが保存とそろい、破線の
  // 切れ目が同じ位置に来る。確定事項41）。四角・丸の線は箱の内側に収め、描く線幅は短い辺の半分で頭打ちにする（確定事項30）。
  // 線なしは箱そのものを塗る。矢印の先は arrow-head.js（保存の外観と同じ式）で紙の座標に置いてから直し、
  // 破線の矢印でも実線で描く（確定事項32）。
  //
  // 戻り値は { stroke, fill, width, cap, join, parts }。stroke・fill は '#rrggbb' か null（なし）、width は表示の px の線幅。
  // parts は表示の座標の部品の並びで、{ type: 'rect', x, y, width, height }・{ type: 'ellipse', cx, cy, rx, ry }・
  // { type: 'line', from, to }・{ type: 'polyline', points }・{ type: 'path', segments }（segments は shape-outline.js の形）・
  // { type: 'polygon', points, paint }（塗った三角。paint の色で塗り、線は引かない。spec-4b-5a 確定事項7）・
  // { type: 'polygon', points, fillable }（閉じた多角形。spec-4b-5a 確定事項10）。
  // 塗りは fillable の部品（四角・丸）にだけ当てる。破線の部品は dash（px の配列）と cap を持つ。

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function outline() {
    return root.SigK.shapeOutline;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function scaleOf(viewport) {
    return viewport.scale ?? 1;
  }

  // 紙の座標の箱 [x1 y1 x2 y2] を表示の px の箱にする。回転した紙では角の対応が変わるので min/max で組む。
  function viewBoxOf(rect, viewport) {
    const a = viewport.convertToViewportPoint(rect[0], rect[1]);
    const b = viewport.convertToViewportPoint(rect[2], rect[3]);
    const x = Math.min(a[0], b[0]);
    const y = Math.min(a[1], b[1]);
    return { x: round(x), y: round(y), width: round(Math.abs(b[0] - a[0])), height: round(Math.abs(b[1] - a[1])) };
  }

  function toViewOf(viewport) {
    return (point) => viewport.convertToViewportPoint(point[0], point[1]);
  }

  // 紙の座標の点列（shape-outline.js・cloud-geometry.js の形）を表示の座標へ直す。
  function viewSegmentsOf(segments, viewport) {
    const toView = toViewOf(viewport);
    return segments.map(({ op, points }) => ({ op, points: points.map(toView) }));
  }

  function dashPart(segments, dash, viewport, fillable) {
    const scale = scaleOf(viewport);
    return { type: 'path', segments: viewSegmentsOf(segments, viewport), fillable, dash: dash.map((value) => value * scale), cap: 'butt' };
  }

  // 実線の四角・丸（今までの rect・ellipse）。inset は表示の px で、線があれば描く線幅の半分、線なしは 0（箱そのもの）。
  function boxPart(kind, box, inset) {
    const x = round(box.x + inset);
    const y = round(box.y + inset);
    const width = round(Math.max(0, box.width - inset * 2));
    const height = round(Math.max(0, box.height - inset * 2));
    if (kind === 'square')
      return { type: 'rect', x, y, width, height, fillable: true };
    return { type: 'ellipse', cx: round(x + width / 2), cy: round(y + height / 2), rx: round(width / 2), ry: round(height / 2), fillable: true };
  }

  // 四角・丸（確定事項29〜33）。雲形は雲の path（線なしでも書き込みの太さで組む。箱が小さすぎれば普通の四角・丸）、
  // 線のある破線は輪郭の path、ほかは rect・ellipse。
  function boxFigure(entry, viewport, stroked) {
    const scale = scaleOf(viewport);
    if (style().lineStyleOf(entry) === 'cloudy') {
      const cloud = root.SigK.cloudGeometry.cloudOf({
        kind: entry.kind, box: entry.rect, intensity: style().cloudIntensityOf(entry), lineWidth: entry.lineWidth,
      });
      if (cloud !== null)
        return { width: cloud.drawWidth * scale, join: 'round', parts: [{ type: 'path', segments: viewSegmentsOf(cloud.segments, viewport), fillable: true }] };
    }
    const width = outline().drawWidthOf(entry.rect, entry.lineWidth);
    const dash = stroked ? style().dashOf(entry) : null;
    if (dash !== null) {
      const segments = entry.kind === 'square' ? outline().rectOutline(entry.rect, width) : outline().ellipseOutline(entry.rect, width);
      return { width: width * scale, parts: [dashPart(segments, dash, viewport, true)] };
    }
    return { width: width * scale, parts: [boxPart(entry.kind, viewBoxOf(entry.rect, viewport), stroked ? (width * scale) / 2 : 0)] };
  }

  // 直線・矢印。破線は軸だけで、開いた矢じりの翼（翼 → 終点 → 翼）は実線。塗った三角（spec-4b-5a 確定事項7）は、軸を三角の底の
  // 中点で止め、三角を線の色で塗る部品（paint。線は引かない）にする。
  function lineParts(entry, viewport) {
    const toView = toViewOf(viewport);
    const [from, to] = entry.paths[0];
    const dash = style().dashOf(entry);
    const closed = root.SigK.arrowHead.isClosed(entry);
    const head = closed ? root.SigK.arrowHead.closedHead(from, to, entry.lineWidth) : null;
    const end = head === null ? to : head.base;
    const axis = dash === null
      ? { type: 'line', from: toView(from), to: toView(end) }
      : dashPart(outline().polylineOutline([from, end]), dash, viewport, false);
    if (entry.kind !== 'arrow')
      return [axis];
    if (head !== null)
      return [axis, { type: 'polygon', points: [head.left, to, head.right].map(toView), paint: entry.color }];
    const [left, right] = geometry().arrowHead(from, to, entry.lineWidth);
    return [axis, { type: 'polyline', points: [left, to, right].map(toView) }];
  }

  // ×印（spec-4b-5a 確定事項9）。回す前の箱の対角線 2 本（回すのは shape-graphics.js の <g>）。破線は 1 本ずつ点列にする。
  function crossParts(entry, viewport) {
    const toView = toViewOf(viewport);
    const dash = style().dashOf(entry);
    return root.SigK.crossGeometry.localDiagonals(entry.rect).map(([from, to]) => (dash === null
      ? { type: 'line', from: toView(from), to: toView(to) }
      : dashPart(outline().polylineOutline([from, to]), dash, viewport, false)));
  }

  // 多角形（spec-4b-5a 確定事項10）。回す前の頂点の折れ線で、閉じたものは polygon（塗れる）、開いたものは polyline。破線は輪郭の点列
  // （閉じたものは Z で閉じ、始点の角も保存の外観の h と同じ丸い角にする）。回すのは shape-graphics.js の <g>。
  function polygonParts(entry, viewport) {
    const toView = toViewOf(viewport);
    const vertices = entry.paths[0];
    const closed = entry.closed === true;
    const dash = style().dashOf(entry);
    if (dash !== null) {
      const segments = outline().polylineOutline(vertices);
      return [dashPart(closed ? [...segments, { op: 'Z', points: [] }] : segments, dash, viewport, closed)];
    }
    return [closed ? { type: 'polygon', points: vertices.map(toView), fillable: true } : { type: 'polyline', points: vertices.map(toView) }];
  }

  function figureOf(entry, viewport) {
    const rounded = entry.kind !== 'square';
    const base = {
      stroke: entry.color ?? null,
      fill: null,
      width: entry.lineWidth * scaleOf(viewport),
      cap: rounded ? 'round' : 'butt',
      join: rounded ? 'round' : 'miter',
    };
    if (style().isBoxedKind(entry.kind))
      return { ...base, fill: style().fillOf(entry), ...boxFigure(entry, viewport, base.stroke !== null) };
    if (entry.kind === 'ink')
      return { ...base, parts: entry.paths.map((path) => ({ type: 'polyline', points: path.map(toViewOf(viewport)) })) };
    if (entry.kind === 'cross')
      return { ...base, parts: crossParts(entry, viewport) };
    if (entry.kind === 'polygon')
      return { ...base, fill: style().canFill(entry) ? style().fillOf(entry) : null, parts: polygonParts(entry, viewport) };
    return { ...base, parts: lineParts(entry, viewport) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeFigure = { viewBoxOf, figureOf };
})(typeof window !== 'undefined' ? window : globalThis);
