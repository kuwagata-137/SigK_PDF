(function (root) {
  'use strict';

  // 図形が消しゴムでなぞった跡に触れたかの純粋層（spec-4b-5b 確定事項20。決定62 ①②）。DOM に触れない。
  //
  // 触れたとは、なぞった跡（点の並び trail。紙の座標）と図形の線（線の中心）との距離が、消しゴムの半径 radius と描く線の太さの半分の
  // 和以下のこと。矢印の先（開いた矢じり・塗った三角）も線に数える。中を塗った四角・丸・閉じた多角形と塗った三角は、跡が中に入っても
  // 触れたとする。中を塗っていないものは、内側をなぞっても触れない（決定62 ②）。雲形は雲の線で、破線は切れ目を含めた線で見る。
  // 回した図形は、跡を回す前の座標へ戻して見る（回転は距離を変えない）。ペン・マーカーは ink-cut.js が切る（ここでは見ない）。

  // ベジェ 1 本を折れ線にするときの分け数。
  const CURVE_STEPS = 12;

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function outline() {
    return root.SigK.shapeOutline;
  }

  function cubicPoint([p0, p1, p2, p3], t) {
    const s = 1 - t;
    const at = (index) => s * s * s * p0[index] + 3 * s * s * t * p1[index] + 3 * s * t * t * p2[index] + t * t * t * p3[index];
    return [at(0), at(1)];
  }

  // 輪郭の点列（{ op, points } の並び。shape-outline.js・cloud-geometry.js の形）を折れ線の並びにする。
  function flatten(segments) {
    const lines = [];
    let line = null;
    for (const { op, points } of segments) {
      if (op === 'M') {
        line = [points[0]];
        lines.push(line);
      } else if (op === 'L') {
        line.push(points[0]);
      } else if (op === 'C') {
        const start = line.at(-1);
        for (let step = 1; step <= CURVE_STEPS; step += 1)
          line.push(cubicPoint([start, ...points], step / CURVE_STEPS));
      } else if (op === 'Z') {
        line.push(line[0]);
      }
    }
    return lines;
  }

  // 点 p が多角形（頂点の並び）の中か。
  function inside(p, vertices) {
    let result = false;
    for (let index = 0, prev = vertices.length - 1; index < vertices.length; prev = index, index += 1) {
      const [a, b] = [vertices[index], vertices[prev]];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
        result = !result;
    }
    return result;
  }

  // 四角・丸の線（回す前の座標）。線なしは箱そのものの縁で、太さ 0。
  function boxShape(entry) {
    const stroked = entry.color !== null;
    const filled = style().fillOf(entry) !== null;
    let lines = null;
    let width = 0;
    if (style().lineStyleOf(entry) === 'cloudy') {
      const cloud = root.SigK.cloudGeometry.cloudOf({ kind: entry.kind, box: entry.rect, intensity: style().cloudIntensityOf(entry), lineWidth: entry.lineWidth });
      if (cloud !== null) {
        lines = flatten(cloud.segments);
        width = stroked ? cloud.drawWidth : 0;
      }
    }
    if (lines === null) {
      width = stroked ? outline().drawWidthOf(entry.rect, entry.lineWidth) : 0;
      lines = flatten(entry.kind === 'square' ? outline().rectOutline(entry.rect, width) : outline().ellipseOutline(entry.rect, width));
    }
    return { lines, width, region: filled ? lines[0] : null };
  }

  // 直線・矢印の線と、矢印の先の輪郭（塗った三角は中も）。
  function lineShape(entry) {
    const [from, to] = entry.paths[0];
    const lines = [entry.paths[0]];
    let region = null;
    if (entry.kind === 'arrow') {
      const closed = root.SigK.arrowHead.isClosed(entry);
      lines.push(root.SigK.arrowHead.outlineOf(from, to, entry.lineWidth, closed));
      if (closed)
        region = (point) => root.SigK.arrowHead.insideHead(point, from, to, entry.lineWidth);
    }
    return { lines, width: entry.lineWidth, region };
  }

  function polygonShape(entry) {
    const vertices = entry.paths[0];
    const closed = entry.closed === true;
    return {
      lines: [closed ? [...vertices, vertices[0]] : vertices],
      width: entry.color === null ? 0 : entry.lineWidth,
      region: closed && style().fillOf(entry) !== null ? vertices : null,
    };
  }

  // 図形の線（回す前の座標の折れ線の並び）・描く太さ・中に入ったら触れたとする範囲（頂点の並びか、点を受けて真偽を返す関数か null）。
  // 消しゴムが見ない種類は null。
  function shapeOf(entry) {
    switch (entry?.kind) {
      case 'square':
      case 'circle': return boxShape(entry);
      case 'line':
      case 'arrow': return lineShape(entry);
      case 'cross': return { lines: root.SigK.crossGeometry.localDiagonals(entry.rect), width: entry.lineWidth, region: null };
      case 'polygon': return polygonShape(entry);
      default: return null;
    }
  }

  function cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }

  // 線分 a→b と c→d の距離（交われば 0）。
  function segmentDistance(a, b, c, d) {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
      return 0;
    const toSegment = root.SigK.shapeGeometry.distanceToSegment;
    return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
  }

  function segmentsOf(points) {
    if (points.length === 1)
      return [[points[0], points[0]]];
    const segments = [];
    for (let index = 1; index < points.length; index += 1)
      segments.push([points[index - 1], points[index]]);
    return segments;
  }

  function near(lines, trail, reach) {
    const trailSegments = segmentsOf(trail);
    return lines.some((line) => segmentsOf(line).some(([a, b]) => trailSegments.some(([c, d]) => segmentDistance(a, b, c, d) <= reach)));
  }

  function inRegion(region, point) {
    return typeof region === 'function' ? region(point) : inside(point, region);
  }

  // 図形がなぞった跡に触れたか（決定62 ①②）。図形でない種類と表示のみは false。
  function touches(entry, trail, radius) {
    if (entry?.readonly === true || !Array.isArray(trail) || trail.length === 0)
      return false;
    const shape = shapeOf(entry);
    if (shape === null)
      return false;
    const angle = rotation().angleOf(entry);
    const local = angle === 0 ? trail : trail.map((point) => rotation().toLocal(point, entry.rect, angle));
    if (near(shape.lines, local, radius + shape.width / 2))
      return true;
    return shape.region !== null && local.some((point) => inRegion(shape.region, point));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.eraserReach = { CURVE_STEPS, flatten, segmentDistance, touches };
})(typeof window !== 'undefined' ? window : globalThis);
