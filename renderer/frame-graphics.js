(function (root) {
  'use strict';

  // 選択の枠とつまみの SVG の部品（spec-4-1 確定事項6、spec-4-4 確定事項11・32、spec-4b-2 確定事項9〜14）。
  //
  // annotation-frame.js から移した（spec-4b-3a。中身は変えていない）。層の置き場・同期・ずらしは annotation-frame.js が持つ。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 選択の枠の余白（CSS px）。四角群の外接にこれだけ足す。
  const FRAME_PADDING = 3;

  function quads() {
    return root.SigK.markupQuads;
  }

  function handles() {
    return root.SigK.shapeHandles;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
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

  const SigK = (root.SigK = root.SigK || {});
  SigK.frameGraphics = { FRAME_PADDING, element, boundsOf, frameOf, groupOf };
})(typeof window !== 'undefined' ? window : globalThis);
