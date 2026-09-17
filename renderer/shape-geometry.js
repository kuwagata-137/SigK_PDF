(function (root) {
  'use strict';

  // 図形・ペンの幾何の純粋層（spec-4-3 確定事項4・9・10・12・30）。DOM にも pdf.js にも触れない。
  //
  // 紙の座標（pt）で計算し、表示への変換は呼ぶ側（shape-graphics.js・annotate-shape.js）が
  // viewport で行う。矢じりの寸法と翼の式は worker/shape-appearance.js に同じものを持ち、
  // 一致はテストで見張る（プロセスが違うので import できない）。

  // 矢じり: 翼の長さは max(ARROW_MIN_LENGTH, 線幅 × ARROW_LENGTH_RATIO)、線からの開き ARROW_ANGLE。
  const ARROW_MIN_LENGTH = 9;
  const ARROW_LENGTH_RATIO = 6;
  const ARROW_ANGLE = Math.PI / 6;
  // ペンの間引き（表示の px）: 描きながらは直前の点から MIN_STEP 以上、離したら許容 SIMPLIFY_TOLERANCE。
  const MIN_STEP = 2;
  const SIMPLIFY_TOLERANCE = 1;
  // 当たり判定の余裕（表示の px）。線幅の半分に足す。
  const HIT_SLACK = 3;
  // 矩形・楕円の辺の最小（pt）。
  const MIN_SIDE = 1;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function roundPoint(point) {
    return [round(point[0]), round(point[1])];
  }

  function sign(value) {
    return value < 0 ? -1 : 1;
  }

  // 2 点を min/max の箱 [x1 y1 x2 y2] にする。square なら |dx|・|dy| の大きい方を辺にし、引いた向きへ伸ばす。
  function boxOf(from, to, { square = false } = {}) {
    let [x, y] = to;
    if (square) {
      const side = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      x = from[0] + sign(to[0] - from[0]) * side;
      y = from[1] + sign(to[1] - from[1]) * side;
    }
    const x1 = round(Math.min(from[0], x));
    const y1 = round(Math.min(from[1], y));
    const x2 = Math.max(round(Math.max(from[0], x)), x1 + MIN_SIDE);
    const y2 = Math.max(round(Math.max(from[1], y)), y1 + MIN_SIDE);
    return [x1, y1, x2, y2];
  }

  // 終点を 45° 刻みの向きへ吸着させる（長さは保つ）。
  function snapAngle(from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (length === 0)
      return [to[0], to[1]];
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return [from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length];
  }

  // 矢じりの翼 2 点（終点 to から線の逆向きへ開く）。
  function arrowHead(from, to, lineWidth) {
    const length = Math.max(ARROW_MIN_LENGTH, lineWidth * ARROW_LENGTH_RATIO);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const wing = (turn) => [to[0] + Math.cos(angle + turn) * length, to[1] + Math.sin(angle + turn) * length];
    return [wing(Math.PI - ARROW_ANGLE), wing(-(Math.PI - ARROW_ANGLE))];
  }

  // 点群の外接 [minX minY maxX maxY] に pad を足したもの。
  function boundsOf(points, pad = 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return [round(minX - pad), round(minY - pad), round(maxX + pad), round(maxY + pad)];
  }

  // 図形の /Rect と四角。矩形・楕円は箱そのもの、線は描く点（矢じりの翼を含む）の外接に線幅の半分（確定事項10）。
  function rectOfShape({ kind, rect, paths, lineWidth }) {
    let box = rect;
    if (kind === 'line' || kind === 'arrow' || kind === 'ink') {
      const points = paths.flat();
      if (kind === 'arrow')
        points.push(...arrowHead(paths[0][0], paths[0][1], lineWidth));
      box = boundsOf(points, lineWidth / 2);
    }
    return { rect: [...box], quads: [root.SigK.freeTextGeometry.quadOfRect(box)] };
  }

  // 点から線分 a-b への最短距離。長さ 0 の線分は点までの距離。
  function distanceToSegment(point, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSquared = dx * dx + dy * dy;
    let t = 0;
    if (lengthSquared > 0)
      t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
    return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
  }

  function hitsSegments(points, target, tolerance) {
    for (let index = 1; index < points.length; index += 1) {
      if (distanceToSegment(target, points[index - 1], points[index]) <= tolerance)
        return true;
    }
    return false;
  }

  // 点列のどれかの線分に当たるか。矢印は翼 2 本も見る（確定事項12）。
  function hitsPath(paths, point, tolerance, { arrow = false, lineWidth = 1 } = {}) {
    if (paths.some((path) => hitsSegments(path, point, tolerance)))
      return true;
    if (!arrow)
      return false;
    const [from, to] = paths[0];
    const [left, right] = arrowHead(from, to, lineWidth);
    return hitsSegments([left, to, right], point, tolerance);
  }

  // 当たり判定の許容（pt）。線幅の半分に、表示の HIT_SLACK px を紙の座標へ直して足す。
  function hitTolerance(lineWidth, scale) {
    return lineWidth / 2 + HIT_SLACK / (scale > 0 ? scale : 1);
  }

  function farEnough(from, to, minStep) {
    return Math.hypot(to[0] - from[0], to[1] - from[1]) >= minStep;
  }

  // 直前に残した点から minStep 未満の点を捨てる。最後の点は残す。
  function thinPoints(points, minStep) {
    if (points.length === 0)
      return [];
    const kept = [points[0]];
    for (const point of points.slice(1)) {
      if (farEnough(kept[kept.length - 1], point, minStep))
        kept.push(point);
    }
    const last = points[points.length - 1];
    if (kept[kept.length - 1] !== last)
      kept.push(last);
    return kept;
  }

  // Douglas–Peucker。両端を結ぶ線から tolerance より離れた点が無ければ両端だけにする。
  function simplifyPath(points, tolerance) {
    if (points.length < 3)
      return [...points];
    const first = points[0];
    const last = points[points.length - 1];
    let farthest = 0;
    let at = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
      const distance = distanceToSegment(points[index], first, last);
      if (distance > farthest) {
        farthest = distance;
        at = index;
      }
    }
    if (farthest <= tolerance)
      return [first, last];
    const head = simplifyPath(points.slice(0, at + 1), tolerance);
    const tail = simplifyPath(points.slice(at), tolerance);
    return [...head.slice(0, -1), ...tail];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeGeometry = {
    ARROW_MIN_LENGTH,
    ARROW_LENGTH_RATIO,
    ARROW_ANGLE,
    MIN_STEP,
    SIMPLIFY_TOLERANCE,
    HIT_SLACK,
    MIN_SIDE,
    roundPoint,
    boxOf,
    snapAngle,
    arrowHead,
    boundsOf,
    rectOfShape,
    distanceToSegment,
    hitsPath,
    hitTolerance,
    farEnough,
    thinPoints,
    simplifyPath,
  };
})(typeof window !== 'undefined' ? window : globalThis);
