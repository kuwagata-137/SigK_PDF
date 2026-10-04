(function (root) {
  'use strict';

  // 吹き出しを画面と印刷に描く部品（spec-4b-4b 確定事項C7・D2）。free-text-decor-graphics.js が吹き出しについてここを呼び、
  // 入力中の輪郭は free-text-editor-node.js が使う。
  //
  // 座標は箱の表示の左上を原点にした表示の向き（CSS px。free-text-graphics.js が箱の左上へ移して回してから描く）。輪郭は
  // callout-geometry.js の点列で、塗りと線を 1 本で描き、角は丸く結ぶ（事前調査 D。保存の 1 j と同じ）。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function geometry() {
    return root.SigK.calloutGeometry;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function isCallout(entry) {
    return Array.isArray(entry?.tip);
  }

  // しっぽの先のローカル（pt）。
  function localTipOf(entry) {
    return geometry().localOf(root.SigK.freeTextGeometry.frameOrigin(entry.rect, entry.rotation), entry.rotation, entry.tip);
  }

  // 箱の大きさ（表示の向き・pt）。
  function sizeOf(entry) {
    return root.SigK.freeTextGeometry.frameSize(entry.rect, entry.rotation);
  }

  function lineWidthOf(entry) {
    return (entry.borderColor ?? null) === null ? 0 : entry.borderWidth;
  }

  // 輪郭の点列（ローカル pt）。width・height・tip を渡せば、その形（入力中）。
  function outlineOf(entry, { width, height, tip } = {}) {
    const size = width === undefined ? sizeOf(entry) : { width, height };
    return geometry().outlineOf({ ...size, tip: tip ?? localTipOf(entry), fontSize: entry.fontSize, inset: lineWidthOf(entry) / 2 });
  }

  // SVG の d（px）。
  function pathData(segments, scale) {
    const at = ([x, y]) => `${fmt(x * scale)} ${fmt(y * scale)}`;
    return segments.map(({ op, points }) => (op === 'Z' ? 'Z' : `${op} ${points.map(at).join(' ')}`)).join(' ');
  }

  function pathElement(doc, entry, segments, scale) {
    const node = doc.createElementNS(SVG_NS, 'path');
    const line = lineWidthOf(entry);
    node.setAttribute('class', 'free-text-callout');
    node.setAttribute('d', pathData(segments, scale));
    node.setAttribute('fill', entry.fill ?? 'none');
    node.setAttribute('stroke', line > 0 ? entry.borderColor : 'none');
    node.setAttribute('stroke-width', fmt(line * scale));
    node.setAttribute('stroke-linejoin', 'round');
    return node;
  }

  // SVG の輪郭（文字より先に置く）。
  function svgParts(doc, entry, scale) {
    return [pathElement(doc, entry, outlineOf(entry).segments, scale)];
  }

  // canvas 2D の輪郭（文字より先に描く）。
  function paint(ctx, entry, scale) {
    ctx.beginPath();
    for (const { op, points } of outlineOf(entry).segments) {
      const p = points.map(([x, y]) => [x * scale, y * scale]);
      if (op === 'M')
        ctx.moveTo(...p[0]);
      else if (op === 'L')
        ctx.lineTo(...p[0]);
      else if (op === 'C')
        ctx.bezierCurveTo(...p[0], ...p[1], ...p[2]);
      else
        ctx.closePath();
    }
    if ((entry.fill ?? null) !== null) {
      ctx.fillStyle = entry.fill;
      ctx.fill();
    }
    const line = lineWidthOf(entry);
    if (line > 0) {
      ctx.strokeStyle = entry.borderColor;
      ctx.lineWidth = line * scale;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  // 箱としっぽを含む外接（ローカル px。[左 上 右 下]）。印刷の別の層の大きさに使う。
  function boundsOf(entry, scale) {
    const { width, height } = sizeOf(entry);
    return geometry().boundsOf(width, height, localTipOf(entry), lineWidthOf(entry)).map((value) => value * scale);
  }

  // 紙の座標の点が、しっぽの三角に当たるか（確定事項C4）。回していれば回す前の座標へ戻して見る。tolerance は pt。
  function hitsTail(entry, pdfPoint, tolerance) {
    const turn = root.SigK.shapeRotation;
    const unturned = turn.toLocal(pdfPoint, entry.rect, turn.angleOf(entry));
    const local = geometry().localOf(root.SigK.freeTextGeometry.frameOrigin(entry.rect, entry.rotation), entry.rotation, unturned);
    return geometry().hitsTail(outlineOf(entry), localTipOf(entry), local, tolerance);
  }

  // ---- 入力中の輪郭（確定事項D2・D3） ----

  // 入力欄の下に置く <svg class="callout-editor-outline">。
  function createEditorOutline(doc) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'callout-editor-outline');
    svg.setAttribute('width', '1');
    svg.setAttribute('height', '1');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }

  // 入力中の下書きの輪郭を描き直す。at は箱の表示の左上（CSS px）、angle は画面での角度、size は箱の大きさ（pt）、tip はローカルの先。
  function placeEditorOutline(svg, draft, { at, angle, scale, size, tip }) {
    svg.style.left = `${at[0]}px`;
    svg.style.top = `${at[1]}px`;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = angle === 0 ? '' : `rotate(${angle}deg)`;
    const entry = { ...draft, kind: 'text' };
    const segments = outlineOf(entry, { ...size, tip }).segments;
    svg.replaceChildren(pathElement(svg.ownerDocument, entry, segments, scale));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutGraphics = { isCallout, localTipOf, outlineOf, pathData, svgParts, paint, boundsOf, hitsTail, createEditorOutline, placeEditorOutline };
})(typeof window !== 'undefined' ? window : globalThis);
