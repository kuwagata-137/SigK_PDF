(function (root) {
  'use strict';

  // 選んでいる書き込みの枠とつまみの層（spec-4-1 確定事項6、spec-4-4 確定事項11・32、spec-4b-2 確定事項9〜14・23）。
  //
  // 枠とつまみは、紙の器（.pdf-page。overflow:hidden）の外の #view-pages に置く 1 枚の <svg class="annot-frame-layer"> に描く。
  // 選んでいる書き込みのページの位置に重ね、紙の外の灰色の上にもはみ出す（紙の上端の近くの図形でも回転のつまみが見えて押せる）。
  // 四角・丸は回した枠と 8 点のつまみと回転のつまみ、直線・矢印は線に沿った破線と両端のつまみ（位置は shape-handles.js）、
  // ほかの種類は今までの四角の枠（箱に余白を足した破線）。掴んで動かしている間は、書き込みと同じだけ translate する。
  // page-render.js が層を描き直すたびに sync を呼ぶ。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 選択の枠の余白（CSS px）。四角群の外接にこれだけ足す。
  const FRAME_PADDING = 3;

  // 層の要素と、いま枠を出しているもの { index, key, entry, viewport, shape }。
  let layer = null;
  let shown = null;

  function quads() {
    return root.SigK.markupQuads;
  }

  function handles() {
    return root.SigK.shapeHandles;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  function element(doc, tag, attributes) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes))
      node.setAttribute(name, value);
    return node;
  }

  // 枠の元になる箱（CSS px）。ノートは画面の箱（倍率に依らず一定）、それ以外は四角群の外接。
  function boundsOf(entry, viewport) {
    if (root.SigK.annotationEntry.isNoteKind(entry.kind)) {
      const box = root.SigK.noteGraphics.boxOf(entry, viewport);
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    const corners = entry.quads.flatMap((quad) => quads().quadToViewport(quad, viewport));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }

  // 今までの選択の枠。箱（CSS px）に余白を足した破線。
  function frameOf(doc, entry, viewport) {
    const box = boundsOf(entry, viewport);
    return element(doc, 'rect', {
      x: fmt(box.x - FRAME_PADDING), y: fmt(box.y - FRAME_PADDING),
      width: fmt(box.width + FRAME_PADDING * 2), height: fmt(box.height + FRAME_PADDING * 2),
      rx: '3', class: 'annot-frame',
    });
  }

  // 回転のつまみの中の矢印（半径 8 の丸の中に、開いた円弧と矢じり）。
  function rotateIcon(doc, [x, y]) {
    const group = element(doc, 'g', { class: 'annot-rotate-icon' });
    group.append(
      element(doc, 'path', { d: `M ${fmt(x + 3.6)} ${fmt(y - 1.2)} A 3.8 3.8 0 1 1 ${fmt(x + 1.2)} ${fmt(y - 3.6)}` }),
      element(doc, 'polyline', { points: `${fmt(x + 0.2)},${fmt(y - 5.6)} ${fmt(x + 1.9)},${fmt(y - 3.5)} ${fmt(x - 0.3)},${fmt(y - 1.9)}` }),
    );
    return group;
  }

  function handleElement(doc, handle) {
    const rotate = handle.kind === 'rotate';
    const circle = element(doc, 'circle', {
      cx: fmt(handle.at[0]), cy: fmt(handle.at[1]), r: String(rotate ? handles().ROTATE_RADIUS : handles().HANDLE_RADIUS),
      class: rotate ? 'annot-handle rotate' : 'annot-handle', 'data-handle': handle.id,
    });
    return rotate ? [circle, rotateIcon(doc, handle.at)] : [circle];
  }

  // 枠とつまみの <g>。つまみを出さない書き込みは今までの四角の枠だけ。
  function groupOf(doc, entry, viewport, shape) {
    const group = element(doc, 'g', { class: 'annot-frame-group' });
    if (shape === null) {
      group.append(frameOf(doc, entry, viewport));
      return group;
    }
    const { frame, stem } = shape;
    group.append(frame.type === 'line'
      ? element(doc, 'line', { x1: fmt(frame.from[0]), y1: fmt(frame.from[1]), x2: fmt(frame.to[0]), y2: fmt(frame.to[1]), class: 'annot-frame' })
      : element(doc, 'polygon', { points: frame.points.map((point) => point.map(fmt).join(',')).join(' '), class: 'annot-frame' }));
    if (stem !== null)
      group.append(element(doc, 'line', { x1: fmt(stem.from[0]), y1: fmt(stem.from[1]), x2: fmt(stem.to[0]), y2: fmt(stem.to[1]), class: 'annot-frame-stem' }));
    group.append(...shape.handles.flatMap((handle) => handleElement(doc, handle)));
    return group;
  }

  function ensureLayer(doc, pagesEl) {
    if (layer !== null && layer.parentNode === pagesEl)
      return layer;
    layer = element(doc, 'svg', { class: 'annot-frame-layer', 'aria-hidden': 'true' });
    pagesEl.append(layer);
    return layer;
  }

  function clear() {
    layer?.replaceChildren();
    shown = null;
  }

  // 1 ページの層を描き直したときに呼ぶ。選んでいる書き込みがこのページにあれば枠とつまみを描き、無くてこのページに出して
  // いたなら消す。entries は描いた書き込み（下見を当てたもの）、editing は入力欄を開いているテキスト（枠を出さない）。
  function sync({ doc, pagesEl, pageNode, index, entries, viewport, selected = null, editing = null }) {
    const target = selected === null || selected === editing ? null : entries.find((entry) => keyOf(entry) === selected) ?? null;
    if (target === null || pagesEl === null || pagesEl === undefined || pageNode === null || pageNode === undefined) {
      if (shown?.index === index)
        clear();
      return false;
    }
    const svg = ensureLayer(doc, pagesEl);
    svg.style.left = pageNode.style.left;
    svg.style.top = pageNode.style.top;
    svg.setAttribute('width', String(Math.round(viewport.width)));
    svg.setAttribute('height', String(Math.round(viewport.height)));
    const shape = handles()?.handlesOf(target, viewport) ?? null;
    svg.replaceChildren(groupOf(doc, target, viewport, shape));
    shown = { index, key: selected, entry: target, viewport, shape };
    return true;
  }

  // ページを捨てたとき（page-render.js の releasePage）。そのページに出していれば消す。
  function releasePage(index) {
    if (shown?.index === index)
      clear();
  }

  // 掴んで動かしている間、枠とつまみを書き込みと同じだけずらす（確定事項23）。0, 0 で戻す。
  function translate(dx, dy) {
    const group = layer?.firstChild ?? null;
    if (group !== null)
      group.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationFrame = {
    FRAME_PADDING,
    boundsOf,
    frameOf,
    sync,
    releasePage,
    clear,
    translate,
    // 出している枠（annotate-transform.js がつまみの当たりに使う）。無ければ null。
    shown: () => shown,
    element: () => layer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
