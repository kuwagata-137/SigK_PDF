(function (root) {
  'use strict';

  // 選んでいる書き込みの枠（spec-4-1 確定事項6、spec-4-4 確定事項11・32）。
  //
  // annotation-layer.js から移した（spec-4b-2。200 行の目安。中身は変えていない）。箱（CSS px）に余白を足した破線の
  // <rect class="annot-frame"> を返す。ノートは画面の箱（倍率に依らず一定）、それ以外は四角群の外接。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // 選択の枠の余白（CSS px）。四角群の外接にこれだけ足す。
  const FRAME_PADDING = 3;

  function quads() {
    return root.SigK.markupQuads;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  // 枠の元になる箱（CSS px）。
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

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationFrame = { FRAME_PADDING, boundsOf, frameOf };
})(typeof window !== 'undefined' ? window : globalThis);
