(function (root) {
  'use strict';

  // 書き込みの当たり判定（spec-4-3 確定事項12、spec-4-4 確定事項13）。
  //
  // annotate.js の hits・hitTest と、shape-geometry.js の線の当たり（hitsPath・hitTolerance）を移した（spec-4b-2。200 行の
  // 目安。中身は変えていない）。hitsPath・hitTolerance は純関数で、hitTest は viewer から今のページの書き込みを引いて見る。

  // 当たり判定の余裕（表示の px）。線幅の半分に足す。
  const HIT_SLACK = 3;

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function hitsSegments(points, target, tolerance) {
    for (let index = 1; index < points.length; index += 1) {
      if (geometry().distanceToSegment(target, points[index - 1], points[index]) <= tolerance)
        return true;
    }
    return false;
  }

  // 点列のどれかの線分に当たるか。矢印は先の輪郭（開いた矢じりは翼 2 本、塗った三角は 3 辺）も見て、塗った三角は中も当たる
  // （spec-4-3 確定事項12、spec-4b-5a 確定事項25）。
  function hitsPath(paths, point, tolerance, { arrow = false, lineWidth = 1, closed = false } = {}) {
    if (paths.some((path) => hitsSegments(path, point, tolerance)))
      return true;
    if (!arrow)
      return false;
    const [from, to] = paths[0];
    const head = root.SigK.arrowHead;
    return hitsSegments(head.outlineOf(from, to, lineWidth, closed), point, tolerance) || (closed && head.insideHead(point, from, to, lineWidth));
  }

  // 当たり判定の許容（pt）。線幅の半分に、表示の HIT_SLACK px を紙の座標へ直して足す。
  function hitTolerance(lineWidth, scale) {
    return lineWidth / 2 + HIT_SLACK / (scale > 0 ? scale : 1);
  }

  // 吹き出しのしっぽの線の太さ（枠線の太さ。枠線が無ければ 0）。
  function tailLineOf(entry) {
    return (entry.borderColor ?? null) === null ? 0 : entry.borderWidth ?? 0;
  }

  // 回した四角・丸に点が当たるか。点を回す前の座標へ戻して箱で見る（spec-4b-2 確定事項15）。
  function hitsTurnedBox(entry, pdfPoint) {
    const rotation = root.SigK.shapeRotation;
    const [x, y] = rotation.toLocal(pdfPoint, entry.rect, rotation.angleOf(entry));
    const [x1, y1, x2, y2] = entry.rect;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }

  // 1 つの注釈に点が当たるか。直線・矢印・ペンは線からの距離、ノートは画面の箱（表示の点で見る。
  // spec-4-4 確定事項13）、表示のみは当てない、回した四角・丸は回した箱、それ以外は四角（spec-4-3 確定事項12）。
  function hits(entry, pdfPoint, viewport, point) {
    if (entry.readonly === true)
      return false;
    if (annotationState().isNoteKind(entry.kind))
      return root.SigK.noteGraphics.hits(entry, point, viewport);
    // 吹き出しはしっぽの三角も当たる（spec-4b-4b 確定事項C4）。余裕は線と同じ（決定59 の直し）。
    if (entry.kind === 'text' && entry.callout !== undefined
      && root.SigK.calloutShape.hitsTail(entry, pdfPoint, hitTolerance(tailLineOf(entry), viewport.scale ?? 1)))
      return true;
    // ×印は対角線 2 本からの距離（回したものは回す前の座標へ戻す。spec-4b-5a 確定事項21）。
    if (entry.kind === 'cross')
      return root.SigK.crossGeometry.distanceTo(entry, pdfPoint) <= hitTolerance(entry.lineWidth, viewport.scale ?? 1);
    if (root.SigK.shapeRotation?.isRotated(entry) === true)
      return hitsTurnedBox(entry, pdfPoint);
    if (!annotationState().isPathKind(entry.kind))
      return root.SigK.markupQuads.hitTest(entry.quads, pdfPoint);
    const tolerance = hitTolerance(entry.lineWidth, viewport.scale ?? 1);
    return hitsPath(entry.paths, pdfPoint, tolerance, { arrow: entry.kind === 'arrow', lineWidth: entry.lineWidth, closed: root.SigK.arrowHead.isClosed(entry) });
  }

  // 点（.pdf-page 基準の CSS px）に当たる注釈。上に描いたもの（後ろ）が優先。
  function hitTest(index, point) {
    const view = root.SigK.viewer;
    const viewport = root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? view?.getTextLayer(index)?.viewport;
    const src = view?.getPlan()[index]?.src;
    if (viewport === null || viewport === undefined || !Number.isInteger(src))
      return null;
    const pdfPoint = viewport.convertToPdfPoint(point[0], point[1]);
    const entries = annotationState().annotsOnPage(view.getAnnotations(), view.getImported(), src);
    for (let position = entries.length - 1; position >= 0; position -= 1) {
      if (hits(entries[position], pdfPoint, viewport, point))
        return root.SigK.annotationLayer.keyOf(entries[position]);
    }
    return null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationHit = { HIT_SLACK, hitsPath, hitTolerance, hits, hitTest };
})(typeof window !== 'undefined' ? window : globalThis);
