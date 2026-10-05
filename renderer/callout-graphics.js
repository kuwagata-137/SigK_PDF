(function (root) {
  'use strict';

  // 吹き出しの輪郭を画面（SVG の <path>）と印刷（canvas 2D）に描く部品（spec-4b-4b 確定事項E6・D3）。free-text-shape.js の svgOf・
  // paint と、入力中の本体（annotation-layer.js）が呼ぶ。輪郭の点は callout-shape.js の outlineOf（回す前の紙の座標）で、回した吹き出しは
  // 箱の中心のまわりに回し（free-text-turn.js）、表示の座標へ直して描く。塗りと枠線（枠線は箱の内側。線の結びは丸）を 1 本の輪郭に当てる。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function shape() {
    return root.SigK.calloutShape;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function hasBorder(entry) {
    return (entry.borderColor ?? null) !== null;
  }

  // 輪郭の点の並び（表示の座標）。
  function viewSegmentsOf(entry, viewport) {
    const inset = hasBorder(entry) ? entry.borderWidth / 2 : 0;
    const segments = shape().outlineOf(entry.rect, shape().localTipOf(entry), { fontSize: entry.fontSize, inset });
    const toView = (point) => viewport.convertToViewportPoint(...root.SigK.freeTextTurn.turnPoint(point, entry));
    return segments.map(({ op, points }) => ({ op, points: points.map(toView) }));
  }

  function pathData(entry, viewport) {
    return viewSegmentsOf(entry, viewport).map(({ op, points }) => [op, ...points.flat().map(fmt)].join(' ')).join(' ');
  }

  // SVG の輪郭。塗りも枠線も無ければ null。
  function svgOf(doc, entry, viewport) {
    if ((entry.fill ?? null) === null && !hasBorder(entry))
      return null;
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'callout-outline');
    path.setAttribute('d', pathData(entry, viewport));
    path.setAttribute('fill', entry.fill ?? 'none');
    path.setAttribute('stroke', hasBorder(entry) ? entry.borderColor : 'none');
    if (hasBorder(entry))
      path.setAttribute('stroke-width', fmt(entry.borderWidth * (viewport.scale ?? 1)));
    path.setAttribute('stroke-linejoin', 'round');
    return path;
  }

  // canvas 2D の輪郭（塗ってから線を引く）。alpha は重ねる不透明度。
  function paint(ctx, entry, viewport, alpha = 1) {
    if ((entry.fill ?? null) === null && !hasBorder(entry))
      return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const { op, points } of viewSegmentsOf(entry, viewport)) {
      if (op === 'M')
        ctx.moveTo(...points[0]);
      else if (op === 'L')
        ctx.lineTo(...points[0]);
      else if (op === 'C')
        ctx.bezierCurveTo(...points.flat());
      else
        ctx.closePath();
    }
    if ((entry.fill ?? null) !== null) {
      ctx.fillStyle = entry.fill;
      ctx.fill();
    }
    if (hasBorder(entry)) {
      ctx.strokeStyle = entry.borderColor;
      ctx.lineWidth = entry.borderWidth * (viewport.scale ?? 1);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  // 輪郭の外接（表示の座標 { left, top, right, bottom }）。印刷の別の層の大きさに使う。
  function viewExtentOf(entry, viewport) {
    const points = viewSegmentsOf(entry, viewport).flatMap((segment) => segment.points);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  // 入力中の吹き出しの本体（確定事項D3・D4）。下書きの文字で箱を組み、直している吹き出しは回した箱の左上の角を保つ（確定と同じ）。
  // 置いたばかりのもの（draft.callout が true）の先は本体の下・左寄りに付いていく。吹き出しでなければ null。
  function draftEntryOf(draft) {
    if (draft === null || draft === undefined || (draft.callout !== true && draft.callout?.tip === undefined))
      return null;
    const base = { ...draft, kind: 'text' };
    delete base.callout;
    const size = root.SigK.freeTextMetrics.sizeOf(base);
    const frame = root.SigK.freeTextLayout.frameOf(draft.origin, size, draft.rotation);
    const entry = draft.entry ?? null;
    const rect = entry === null ? frame.rect : root.SigK.freeTextTurn.turned(entry, frame).rect;
    const tip = draft.callout === true ? shape().defaultTipOf(draft.origin, size, draft.rotation, draft.fontSize) : [...draft.callout.tip];
    const opacity = entry?.opacity ?? root.SigK.annotate?.getOpacity('callout') ?? 1;
    const turned = entry?.angle === undefined ? {} : { angle: entry.angle };
    return { ...base, rect, ...turned, callout: { tip }, opacity };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutGraphics = { pathData, svgOf, paint, viewExtentOf, draftEntryOf };
})(typeof window !== 'undefined' ? window : globalThis);
