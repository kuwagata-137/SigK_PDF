(function (root) {
  'use strict';

  // 紙の上に重ねる注釈の層（spec-4-1 確定事項5・37）。
  //
  // .pdf-page の中、canvas のあと・テキストレイヤーの前に <svg class="annot-layer"> を
  // 置く。ハイライト・下線・取り消し線は markup-graphics.js、テキストは free-text-shape.js の <text>（spec-4-2 確定事項10）、
  // 図形・ペンは shape-graphics.js の <g>（spec-4-3 確定事項8）、ノートは note-graphics.js の
  // 付箋（spec-4-4 確定事項8）。描いている途中の下書きも同じ描き手で最後に置く（確定事項3）。
  // 「表示のみ」の注釈（readonly。pdf.js が描く）は描かない（選ばれていれば枠だけ出す。spec-4-4 確定事項32。枠は
  // 紙の外の層 annotation-frame.js が描く。spec-4b-2 確定事項9）。pointer-events は無く、当たり判定は annotation-hit.js が行う。
  //
  // 同じ絵を canvas 2D にも描ける（paint）。印刷が未保存の注釈を映すのに使う
  // （確定事項28）。SVG と canvas で描き方を分けると、画面と紙で見た目がずれる。

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 図形・ペン（線幅を持つ種類）か。
  function isDrawn(entry) {
    return root.SigK.annotationEntry.isDrawnKind(entry.kind);
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

  function isNote(entry) {
    return root.SigK.annotationEntry.isNoteKind(entry.kind);
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  // マーカーは <g> ごと紙と乗算する（spec-4b-5b 確定事項7。CSS の .marker）。<g> は 1 つの絵として重なるので、交わりは濃くならない。
  function markBlend(group, entry) {
    if (root.SigK.shapeStyle.isMarker(entry))
      group.setAttribute('class', group.getAttribute('class') === null ? 'marker' : `${group.getAttribute('class')} marker`);
    return group;
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
    markBlend(group, entry);
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
    group.append(...root.SigK.markupGraphics.svgOf(doc, entry, viewport));
    return group;
  }

  // 描いている途中の図形（spec-4-3 確定事項3）。当たり判定の鍵は持たせない。不透明度は確定後と同じに付ける
  // （spec-4b-1a 確定事項32）。
  function draftOf(doc, draft, viewport) {
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'annot-draft');
    if (draft.opacity !== undefined && draft.opacity < 1)
      group.setAttribute('opacity', String(draft.opacity));
    markBlend(group, draft);
    group.append(root.SigK.shapeGraphics.svgOf(doc, draft, viewport));
    return group;
  }

  // 層を描き直す。entries は annotationState.annotsOnPage の並び（下から上）。
  // editing は入力欄を開いているテキストの id か ref で、それは描かない（入力欄が代わり。spec-4-2 確定事項5）。
  // draft は描いている途中の図形（entry の形）で、いちばん上に描く。選択の枠は紙の外の層（annotation-frame.js。
  // spec-4b-2 確定事項9）が描く。
  // textDraft は開いているテキストの入力欄の下書き。吹き出しなら本体（輪郭）だけを描く（文字は入力欄。spec-4b-4b 確定事項D3）。
  // marks は描いている途中の多角形の印（頂点・次の辺・輪。polygon-draft.js の svgOf。spec-4b-5a 確定事項13）。
  function draw(svg, entries, viewport, { editing = null, draft = null, textDraft = null, marks = null } = {}) {
    const doc = svg.ownerDocument;
    svg.replaceChildren();
    for (const entry of entries) {
      if (editing !== null && keyOf(entry) === editing)
        continue;
      const group = groupOf(doc, entry, viewport);
      if (group !== null)
        svg.append(group);
    }
    if (draft !== null && draft !== undefined)
      svg.append(draftOf(doc, draft, viewport));
    if (marks !== null && marks !== undefined)
      svg.append(root.SigK.polygonDraft.svgOf(doc, marks.preview, viewport, marks.look));
    const body = root.SigK.calloutGraphics?.draftEntryOf(textDraft) ?? null;
    const outline = body === null ? null : root.SigK.calloutGraphics.svgOf(doc, body, viewport);
    if (outline !== null) {
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'annot-draft');
      if (body.opacity < 1)
        group.setAttribute('opacity', String(body.opacity));
      group.append(outline);
      svg.append(group);
    }
    return svg.childNodes.length;
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項28）。ctx は viewport と同じ座標系
  // （CSS px 相当）で受ける。
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
      root.SigK.markupGraphics.paint(ctx, entry, viewport);
    }
    return entries.length;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationLayer = { mount, draw, paint, keyOf };
})(typeof window !== 'undefined' ? window : globalThis);
