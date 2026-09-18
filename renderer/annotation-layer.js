(function (root) {
  'use strict';

  // 紙の上に重ねる注釈の層（spec-4-1 確定事項5・37）。
  //
  // .pdf-page の中、canvas のあと・テキストレイヤーの前に <svg class="annot-layer"> を
  // 置く。ハイライトは mix-blend-mode: multiply の多角形（文字が透ける）、下線・
  // 取り消し線は <line>、テキストは free-text-shape.js の <text>（spec-4-2 確定事項10）、
  // 図形・ペンは shape-graphics.js の <g>（spec-4-3 確定事項8）、ノートは note-graphics.js の
  // 付箋（spec-4-4 確定事項8）。描いている途中の下書きも同じ描き手で最後に置く（確定事項3）。
  // 「表示のみ」の注釈（readonly。pdf.js が描く）は描かず、選ばれていれば枠だけ出す
  // （spec-4-4 確定事項32）。pointer-events は無く、当たり判定は annotate.js が行う。
  //
  // 同じ絵を canvas 2D にも描ける（paint）。印刷が未保存の注釈を映すのに使う
  // （確定事項28）。SVG と canvas で描き方を分けると、画面と紙で見た目がずれる。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 選択の枠の余白（CSS px）。四角群の外接にこれだけ足す。
  const FRAME_PADDING = 3;

  function quads() {
    return root.SigK.markupQuads;
  }

  // 図形・ペン（線幅を持つ種類）か。
  function isDrawn(entry) {
    return root.SigK.annotationEntry.isDrawnKind(entry.kind);
  }

  // 属性に書く数。小数 2 桁で十分で、浮動小数のごみを残さない。
  function fmt(value) {
    return String(Math.round(value * 100) / 100);
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
      polygon.setAttribute('points', [ul, ur, lr, ll].map((point) => point.map(fmt).join(',')).join(' '));
      polygon.setAttribute('fill', entry.color);
      polygon.setAttribute('class', 'highlight');
      return polygon;
    }
    const line = doc.createElementNS(SVG_NS, 'line');
    const [from, to] = quads().lineEndpoints(points, entry.kind);
    line.setAttribute('x1', fmt(from[0]));
    line.setAttribute('y1', fmt(from[1]));
    line.setAttribute('x2', fmt(to[0]));
    line.setAttribute('y2', fmt(to[1]));
    line.setAttribute('stroke', entry.color);
    line.setAttribute('stroke-width', fmt(quads().lineWidth(points)));
    line.setAttribute('stroke-linecap', 'butt');
    line.setAttribute('class', entry.kind);
    return line;
  }

  function isNote(entry) {
    return root.SigK.annotationEntry.isNoteKind(entry.kind);
  }

  // 枠の元になる箱（CSS px）。ノートは画面の箱（倍率に依らず一定。spec-4-4 確定事項11）、それ以外は四角群の外接。
  function boundsOf(entry, viewport) {
    if (isNote(entry)) {
      const box = root.SigK.noteGraphics.boxOf(entry, viewport);
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    const corners = entry.quads.flatMap((quad) => quads().quadToViewport(quad, viewport));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }

  // 選択の枠。箱（CSS px）に余白を足した破線。
  function frameOf(doc, entry, viewport) {
    const box = boundsOf(entry, viewport);
    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', fmt(box.x - FRAME_PADDING));
    rect.setAttribute('y', fmt(box.y - FRAME_PADDING));
    rect.setAttribute('width', fmt(box.width + FRAME_PADDING * 2));
    rect.setAttribute('height', fmt(box.height + FRAME_PADDING * 2));
    rect.setAttribute('rx', '3');
    rect.setAttribute('class', 'annot-frame');
    return rect;
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  // 1 つの注釈の <g>。表示のみ（pdf.js が描く）は null。
  function groupOf(doc, entry, viewport) {
    if (entry.readonly === true)
      return null;
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-annot', keyOf(entry));
    group.setAttribute('data-kind', entry.kind);
    if (entry.opacity !== undefined && entry.opacity < 1)
      group.setAttribute('opacity', String(entry.opacity));
    if (entry.kind === 'text') {
      group.append(root.SigK.freeTextShape.svgOf(doc, entry, viewport));
      return group;
    }
    if (isDrawn(entry)) {
      group.append(root.SigK.shapeGraphics.svgOf(doc, entry, viewport));
      return group;
    }
    if (isNote(entry)) {
      group.append(root.SigK.noteGraphics.svgOf(doc, entry, viewport));
      return group;
    }
    for (const quad of entry.quads)
      group.append(shapeOf(doc, entry, quads().quadToViewport(quad, viewport)));
    return group;
  }

  // 描いている途中の図形（spec-4-3 確定事項3）。当たり判定の鍵は持たせない。
  function draftOf(doc, draft, viewport) {
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'annot-draft');
    group.append(root.SigK.shapeGraphics.svgOf(doc, draft, viewport));
    return group;
  }

  // 層を描き直す。entries は annotationState.annotsOnPage の並び（下から上）。
  // selected は選んでいる注釈の id か ref（無ければ null）。editing は入力欄を開いている
  // テキストの id か ref で、それは描かない（入力欄が代わり。spec-4-2 確定事項5）。
  // draft は描いている途中の図形（entry の形）で、枠よりさらに上に描く。
  function draw(svg, entries, viewport, { selected = null, editing = null, draft = null } = {}) {
    const doc = svg.ownerDocument;
    svg.replaceChildren();
    let frame = null;
    for (const entry of entries) {
      if (editing !== null && keyOf(entry) === editing)
        continue;
      const group = groupOf(doc, entry, viewport);
      if (group !== null)
        svg.append(group);
      if (selected !== null && keyOf(entry) === selected)
        frame = frameOf(doc, entry, viewport);
    }
    // 枠は最後に置く（いちばん上）。下書きはその上。
    if (frame !== null)
      svg.append(frame);
    if (draft !== null && draft !== undefined)
      svg.append(draftOf(doc, draft, viewport));
    return svg.childNodes.length;
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項28）。ctx は viewport と同じ座標系
  // （CSS px 相当）で受ける。ハイライトは multiply で塗る。
  function paint(ctx, entries, viewport) {
    for (const entry of entries) {
      if (entry.readonly === true)
        continue;
      if (entry.kind === 'text') {
        root.SigK.freeTextShape.paint(ctx, entry, viewport);
        continue;
      }
      if (isDrawn(entry)) {
        root.SigK.shapeGraphics.paint(ctx, entry, viewport);
        continue;
      }
      if (isNote(entry)) {
        root.SigK.noteGraphics.paint(ctx, entry, viewport);
        continue;
      }
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
