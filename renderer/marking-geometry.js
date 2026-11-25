(function (root) {
  'use strict';

  // マーキング 1 つの形を、紙の座標（pt・y は上向き）の部品にする純粋層（spec-7-9 確定事項F2〜F4）。DOM に触れない。
  //
  // 位置は rect の中心で、rect は描く範囲の外接（線の太さを含む。外の円と中の円の線は円の内側に収める）。部品は
  //   { type: 'circle', center, r, width }          線の円（r は線の中心の半径）
  //   { type: 'disc', center, r }                   塗った円
  //   { type: 'line', from, to, width, cap }        線（cap は 'butt' か 'round'）
  //   { type: 'polyline', points, width, closed }   折れ線（丸い端と角）
  // で、色はどれも書き込みの色。画面と印刷（marking-graphics.js）と、当たり判定（hits）・消しゴム（outlineOf）がここを使う。
  // 保存の外観は worker/marking-geometry.js が同じ式を持つ（test/marking-geometry.test.js が一致を見張る）。

  const SQRT3_HALF = Math.sqrt(3) / 2;
  // 注意マークの「！」（三角形の高さに対する位置と、三角形の幅に対する太さ）。Claude の判断。
  const BANG = Object.freeze({ top: 0.66, bottom: 0.4, dot: 0.22, width: 0.1, dotRatio: 0.6 });
  // 円を折れ線にするときの点の数（消しゴム）。
  const CIRCLE_STEPS = 48;

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function glyphs() {
    return root.SigK.markingGlyphs;
  }

  function centerOf(rect) {
    return [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
  }

  // 描く範囲の幅と高さ（pt）。照準は十字線、番号付き丸は番号がはみ出せばその分も含む。注意マークは正三角形の幅と高さ。
  function sizeOf(marking) {
    const { shape, outer } = marking;
    if (shape === 'caution')
      return [outer, outer * SQRT3_HALF];
    if (shape === 'crosshair')
      return [Math.max(outer, marking.cross), Math.max(outer, marking.cross)];
    if (shape === 'number') {
      const box = glyphs().boxOf(marking.number, marking.fontSize);
      return [Math.max(outer, box.width), Math.max(outer, box.height)];
    }
    return [outer, outer];
  }

  // 中心 center に置いた時の rect と quads（箱の四角 1 つ）。
  function frameOf(marking, center) {
    const [width, height] = sizeOf(marking);
    const rect = [round(center[0] - width / 2), round(center[1] - height / 2), round(center[0] + width / 2), round(center[1] + height / 2)];
    return { rect, quads: [[rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]]] };
  }

  // 円の線の太さ（半径を超えない）と、線の中心の半径。
  function ringOf(diameter, lineWidth) {
    const width = Math.min(lineWidth, diameter / 2);
    return { width, r: Math.max(0, diameter / 2 - width / 2) };
  }

  function circlePart(center, diameter, lineWidth) {
    const { width, r } = ringOf(diameter, lineWidth);
    return { type: 'circle', center, r: round(r), width: round(width) };
  }

  function crossParts(center, length, width) {
    const [cx, cy] = center;
    const half = length / 2;
    return [
      { type: 'line', from: [round(cx - half), cy], to: [round(cx + half), cy], width, cap: 'butt' },
      { type: 'line', from: [cx, round(cy - half)], to: [cx, round(cy + half)], width, cap: 'butt' },
    ];
  }

  // 注意マークの三角形（線の中心の頂点。丸い角で外側の縁が箱に収まるよう、線の太さの半分だけ内側）と「！」。
  function cautionParts(center, outer, lineWidth) {
    const [cx, cy] = center;
    const height = outer * SQRT3_HALF;
    const width = round(Math.min(lineWidth, outer / 6));
    const bottom = cy - height / 2;
    const points = [[cx, cy + height / 2 - width / 2], [cx + outer / 2 - width / 2, bottom + width / 2], [cx - outer / 2 + width / 2, bottom + width / 2]]
      .map((point) => point.map(round));
    const bar = round(outer * BANG.width);
    return [
      { type: 'polyline', points, width, closed: true },
      { type: 'line', from: [cx, round(bottom + height * BANG.top)], to: [cx, round(bottom + height * BANG.bottom)], width: bar, cap: 'round' },
      { type: 'disc', center: [cx, round(bottom + height * BANG.dot)], r: round(bar * BANG.dotRatio) },
    ];
  }

  // 部品の並び（下から上の順）。
  function partsOf(entry) {
    const { marking, lineWidth } = entry;
    const center = centerOf(entry.rect).map(round);
    if (marking.shape === 'caution')
      return cautionParts(center, marking.outer, lineWidth);
    const outer = circlePart(center, marking.outer, lineWidth);
    switch (marking.shape) {
      case 'target': return [outer, { type: 'disc', center, r: round(marking.dot / 2) }];
      case 'double': return [outer, circlePart(center, marking.ring, lineWidth)];
      case 'crosshair': return [outer, ...crossParts(center, marking.cross, outer.width)];
      default: {
        const { strokes, lineWidth: width } = glyphs().strokesOf(marking.number, marking.fontSize, center);
        return [outer, ...strokes.map((points) => ({ type: 'polyline', points, width, closed: false }))];
      }
    }
  }

  // ---- 当たり（確定事項F5。外の円の内側全体と、はみ出した十字線・番号） ----

  function distanceToSegment(point, a, b) {
    return root.SigK.shapeGeometry.distanceToSegment(point, a, b);
  }

  // 点が三角形（頂点の並び）の中か。
  function insideTriangle([x, y], [a, b, c]) {
    const side = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const s1 = side(a, b);
    const s2 = side(b, c);
    const s3 = side(c, a);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  }

  // 注意マークの外側の縁の頂点（箱の上の中央と下の 2 隅）。
  function triangleOf(entry) {
    const [x1, y1, x2, y2] = entry.rect;
    return [[(x1 + x2) / 2, y2], [x2, y1], [x1, y1]];
  }

  // 点が描く範囲の中か（外の円・三角形の内側全体。照準の十字線と番号付き丸の番号がはみ出せば、その範囲も）。tolerance は余裕（pt）。
  function hits(entry, point, tolerance = 0) {
    const { marking } = entry;
    if (marking.shape === 'caution') {
      const triangle = triangleOf(entry);
      return insideTriangle(point, triangle) || triangle.some((at, index) => distanceToSegment(point, at, triangle[(index + 1) % 3]) <= tolerance);
    }
    const center = centerOf(entry.rect);
    if (Math.hypot(point[0] - center[0], point[1] - center[1]) <= marking.outer / 2 + tolerance)
      return true;
    if (marking.shape === 'number') {
      const [x1, y1, x2, y2] = entry.rect;
      return point[0] >= x1 - tolerance && point[0] <= x2 + tolerance && point[1] >= y1 - tolerance && point[1] <= y2 + tolerance;
    }
    if (marking.shape !== 'crosshair')
      return false;
    const reach = ringOf(marking.outer, entry.lineWidth).width / 2 + tolerance;
    return crossParts(center, marking.cross, 0).some((line) => distanceToSegment(point, line.from, line.to) <= reach);
  }

  // 消しゴムが見る線（線の中心の折れ線の並び）と太さと、中に入ったら触れたとする範囲（点を受けて真偽を返す関数）。
  function outlineOf(entry) {
    const lines = [];
    for (const part of partsOf(entry)) {
      if (part.type === 'circle') {
        lines.push(Array.from({ length: CIRCLE_STEPS + 1 }, (_, index) => {
          const angle = (2 * Math.PI * index) / CIRCLE_STEPS;
          return [part.center[0] + part.r * Math.cos(angle), part.center[1] + part.r * Math.sin(angle)];
        }));
      } else if (part.type === 'line') {
        lines.push([part.from, part.to]);
      } else if (part.type === 'polyline') {
        lines.push(part.closed ? [...part.points, part.points[0]] : part.points);
      }
    }
    return { lines, width: entry.lineWidth, region: (point) => hits(entry, point) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingGeometry = { SQRT3_HALF, BANG, centerOf, sizeOf, frameOf, ringOf, partsOf, hits, outlineOf };
})(typeof window !== 'undefined' ? window : globalThis);
