(function (root) {
  'use strict';

  // 紙の上に重ねる注釈の層（spec-4-1 確定事項5・37）。
  //
  // .pdf-page の中、canvas のあと・テキストレイヤーの前に <svg class="annot-layer"> を
  // 置く。ハイライトは mix-blend-mode: multiply の多角形（文字が透ける）、下線・
  // 取り消し線は <line>。pointer-events は無く、当たり判定は annotate.js が四角で行う。
  //
  // 同じ絵を canvas 2D にも描ける（paint）。印刷が未保存の注釈を映すのに使う
  // （確定事項28）。SVG と canvas で描き方を分けると、画面と紙で見た目がずれる。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 選択の枠の余白（CSS px）。四角群の外接にこれだけ足す。
  const FRAME_PADDING = 3;

  function quads() {
    return root.SigK.markupQuads;
  }

  // 層を作ってページの枠へ入れる。返す要素はページと同じ寿命で、捨てるのは
  // 枠ごと（page-render.js の releasePage）。
  function mount(doc, node, viewport) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'annot-layer');
    svg.setAttribute('width', String(Math.round(viewport.width)));
    svg.setAttribute('height', String(Math.round(viewport.height)));
    svg.setAttribute('aria-hidden', 'true');
    node.append(svg);
    return svg;
  }

  function shapeOf(doc, entry, points) {
    if (entry.kind === 'highlight') {
      const polygon = doc.createElementNS(SVG_NS, 'polygon');
      const [ul, ur, ll, lr] = points;
      polygon.setAttribute('points', [ul, ur, lr, ll].map((point) => point.join(',')).join(' '));
      polygon.setAttribute('fill', entry.color);
      polygon.setAttribute('class', 'highlight');
      return polygon;
    }
    const line = doc.createElementNS(SVG_NS, 'line');
    const [from, to] = quads().lineEndpoints(points, entry.kind);
    line.setAttribute('x1', String(from[0]));
    line.setAttribute('y1', String(from[1]));
    line.setAttribute('x2', String(to[0]));
    line.setAttribute('y2', String(to[1]));
    line.setAttribute('stroke', entry.color);
    line.setAttribute('stroke-width', String(quads().lineWidth(points)));
    line.setAttribute('stroke-linecap', 'butt');
    line.setAttribute('class', entry.kind);
    return line;
  }

  // 選択の枠。四角群の外接（CSS px）に余白を足した破線。
  function frameOf(doc, entry, viewport) {
    const corners = entry.quads.flatMap((quad) => quads().quadToViewport(quad, viewport));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(Math.min(...xs) - FRAME_PADDING));
    rect.setAttribute('y', String(Math.min(...ys) - FRAME_PADDING));
    rect.setAttribute('width', String(Math.max(...xs) - Math.min(...xs) + FRAME_PADDING * 2));
    rect.setAttribute('height', String(Math.max(...ys) - Math.min(...ys) + FRAME_PADDING * 2));
    rect.setAttribute('rx', '3');
    rect.setAttribute('class', 'annot-frame');
    return rect;
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  // 層を描き直す。entries は annotationState.annotsOnPage の並び（下から上）。
  // selected は選んでいる注釈の id か ref（無ければ null）。
  function draw(svg, entries, viewport, { selected = null } = {}) {
    const doc = svg.ownerDocument;
    svg.replaceChildren();
    let frame = null;
    for (const entry of entries) {
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('data-annot', keyOf(entry));
      group.setAttribute('data-kind', entry.kind);
      if (entry.opacity !== undefined && entry.opacity < 1)
        group.setAttribute('opacity', String(entry.opacity));
      for (const quad of entry.quads)
        group.append(shapeOf(doc, entry, quads().quadToViewport(quad, viewport)));
      svg.append(group);
      if (selected !== null && keyOf(entry) === selected)
        frame = frameOf(doc, entry, viewport);
    }
    // 枠は最後に置く（いちばん上）。
    if (frame !== null)
      svg.append(frame);
    return svg.childNodes.length;
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項28）。ctx は viewport と同じ座標系
  // （CSS px 相当）で受ける。ハイライトは multiply で塗る。
  function paint(ctx, entries, viewport) {
    for (const entry of entries) {
      ctx.save();
      ctx.globalAlpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
      ctx.globalCompositeOperation = entry.kind === 'highlight' ? 'multiply' : 'source-over';
      ctx.fillStyle = entry.color;
      ctx.strokeStyle = entry.color;
      ctx.lineCap = 'butt';
      for (const quad of entry.quads) {
        const points = quads().quadToViewport(quad, viewport);
        if (entry.kind === 'highlight') {
          const [ul, ur, ll, lr] = points;
          ctx.beginPath();
          ctx.moveTo(ul[0], ul[1]);
          ctx.lineTo(ur[0], ur[1]);
          ctx.lineTo(lr[0], lr[1]);
          ctx.lineTo(ll[0], ll[1]);
          ctx.closePath();
          ctx.fill();
        } else {
          const [from, to] = quads().lineEndpoints(points, entry.kind);
          ctx.lineWidth = quads().lineWidth(points);
          ctx.beginPath();
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(to[0], to[1]);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    return entries.length;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationLayer = { FRAME_PADDING, mount, draw, paint, keyOf };
})(typeof window !== 'undefined' ? window : globalThis);
