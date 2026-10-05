(function (root) {
  'use strict';

  // 多角形の形の純粋層（spec-4b-5a 確定事項3・10・23・24・40）。DOM にも pdf.js にも触れない。紙の座標（pt）。
  //
  // 多角形は回す前の頂点（paths[0]）と角度で持ち、回転の中心は頂点の外接（rect）の中心。保存の /Vertices は回した位置で、読み戻しでは
  // 外観の /Matrix から読んだ角度で戻す。戻すときの中心は /Rect に頼らず頂点だけから決める（/Rect の丸めで往復がずれないため）。

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function round(value, digits = 2) {
    const scale = 10 ** digits;
    const rounded = Math.round(value * scale) / scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function verticesOf(entry) {
    return entry.paths[0];
  }

  // 頂点の外接に線幅の半分を足した箱（角と端を丸めるので、これで線が収まる。確定事項3・10）。
  function rectOfVertices(vertices, lineWidth) {
    return geometry().boundsOf(vertices, lineWidth / 2);
  }

  // 回した位置の頂点（つまみ・始点合わせ・保存の /Vertices）。digits は丸めの桁。
  function worldVertices(entry, digits = 2) {
    const angle = rotation().angleOf(entry);
    const center = rotation().centerOf(entry.rect);
    return verticesOf(entry).map((point) => (angle === 0 ? [...point] : rotation().rotatePoint(point, center, angle).map((value) => round(value, digits))));
  }

  // 回した位置の頂点 world を、角度 angle の多角形の回す前の頂点に戻す（確定事項40）。外接の中心が回転の中心になるように決める:
  // 原点まわりに戻した頂点 u の外接の中心を cu とすると、回す前の頂点は u + R(cu) − cu（R は角度の回転）。
  function unrotated(world, angle) {
    if (angle === 0)
      return world.map((point) => point.map((value) => round(value)));
    const origin = [0, 0];
    const u = world.map((point) => rotation().rotatePoint(point, origin, -angle));
    // 外接は丸めずに求める（boundsOf は小数 2 桁に丸めるので、中心が 0.005 ずれて頂点の丸めが変わることがある）。
    const xs = u.map((point) => point[0]);
    const ys = u.map((point) => point[1]);
    const cu = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const turned = rotation().rotatePoint(cu, origin, angle);
    return u.map(([x, y]) => [round(x + turned[0] - cu[0]), round(y + turned[1] - cu[1])]);
  }

  // 点が多角形の中か（偶奇の規則）。
  function contains(point, vertices) {
    let inside = false;
    for (let index = 0, prev = vertices.length - 1; index < vertices.length; prev = index, index += 1) {
      const [xi, yi] = vertices[index];
      const [xj, yj] = vertices[prev];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  // 辺までのいちばん近い距離。閉じた多角形は最後の頂点から最初の頂点への辺も見る。
  function distanceToEdges(point, vertices, closed) {
    const ring = closed ? [...vertices, vertices[0]] : vertices;
    let best = Infinity;
    for (let index = 1; index < ring.length; index += 1)
      best = Math.min(best, geometry().distanceToSegment(point, ring[index - 1], ring[index]));
    return best;
  }

  // 当たり（確定事項24）。辺からの距離が tolerance 以内か、閉じて塗りがあれば中。回したものは点を回す前の座標へ戻す。
  function hits(entry, point, tolerance) {
    const local = rotation().toLocal(point, entry.rect, rotation().angleOf(entry));
    const vertices = verticesOf(entry);
    if (distanceToEdges(local, vertices, entry.closed === true) <= tolerance)
      return true;
    return entry.closed === true && (entry.fill ?? null) !== null && contains(local, vertices);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.polygonGeometry = { rectOfVertices, worldVertices, unrotated, contains, distanceToEdges, hits };
})(typeof window !== 'undefined' ? window : globalThis);
