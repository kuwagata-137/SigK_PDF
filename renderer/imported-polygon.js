(function (root) {
  'use strict';

  // 多角形（3 点以上の Polygon と、矢じりの無い 3 点以上の PolyLine）の 1 件を自前の形にする純粋層（spec-4b-5a 確定事項40）。
  //
  // pdf.js の vertices（回した位置の頂点）から、まず回っていない多角形として組み、口の答え（annotation-dict-reader.js の detailsOf）が
  // 来たら withPolygonDetails で塗り・回転・雲形を当てる。回っていれば外観の /Matrix から読んだ角度で頂点を回す前に戻す
  // （polygon-geometry.js の unrotated）。そのため頂点は丸めずに持っておき、当てるときに小数 2 桁にする。線の欄は imported-shape.js。

  function values() {
    return root.SigK.importedValues;
  }

  function polygonGeometry() {
    return root.SigK.polygonGeometry;
  }

  function round(value) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  // 多角形として読む形か。Polygon は 3 点以上、PolyLine は 3 点以上で矢じりが無いもの（/LE が無いか両方 None）。
  function isPolygonData(annotation) {
    const count = Math.floor((annotation?.vertices?.length ?? 0) / 2);
    if (count < 3)
      return false;
    if (annotation.subtype === 'Polygon')
      return true;
    const [start, end] = annotation.lineEndings ?? ['None', 'None'];
    return annotation.subtype === 'PolyLine' && start === 'None' && end === 'None';
  }

  function rawVerticesOf(flat) {
    const vertices = [];
    for (let index = 0; index + 2 <= flat.length; index += 2)
      vertices.push([flat[index], flat[index + 1]]);
    return vertices;
  }

  // 箱と四角を頂点から作り直した形（回す前の頂点 vertices と角度 angle）。
  function placed(entry, vertices, angle) {
    const rect = polygonGeometry().rectOfVertices(vertices, entry.lineWidth);
    const next = { ...entry, paths: [vertices], rect, quads: [root.SigK.shapeRotation.quadOf(rect, angle)] };
    if (angle === 0)
      delete next.angle;
    else
      next.angle = angle;
    return next;
  }

  // 多角形の entry（口の答えを当てる前。頂点は丸めない）。拾えなければ null。
  function importedPolygon(annotation, src) {
    if (!isPolygonData(annotation) || !values().isRect(annotation.rect))
      return null;
    const closed = annotation.subtype === 'Polygon';
    const line = root.SigK.importedShape.lineFieldsOf('polygon', annotation, { fillable: closed });
    if (line === null)
      return null;
    const entry = { ref: annotation.id, src, kind: 'polygon', closed, ...line, opacity: 1 };
    return placed(entry, rawVerticesOf(Array.from(annotation.vertices)), 0);
  }

  // 口の答えを当てる（確定事項40）。塗り（閉じたものだけ）・回転（頂点を回す前に戻す）。雲形・回転を読めない外観は null（表示のみ）。
  // 答えが無ければ回っていないものとして頂点を丸めるだけ。
  function withPolygonDetails(entry, detail) {
    if (detail?.rotation === 'skewed' || detail?.cloudy === true)
      return null;
    const next = { ...entry };
    const fill = entry.closed === true ? values().hexOfComponents(detail?.interior ?? null) : null;
    if (fill !== null)
      next.fill = fill;
    const rotation = detail?.rotation ?? null;
    const world = entry.paths[0];
    if (rotation === null)
      return placed(next, world.map((point) => point.map(round)), 0);
    return placed(next, polygonGeometry().unrotated(world, rotation.angle), rotation.angle);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedPolygon = { isPolygonData, importedPolygon, withPolygonDetails };
})(typeof window !== 'undefined' ? window : globalThis);
