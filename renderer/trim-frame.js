(function (root) {
  'use strict';

  // トリミングの枠の描き方（spec-4b-6a 確定事項12。見本 screenshots/phase4b-6-trim-frame.png）。
  //
  // そのページの .pdf-page の中に <div class="trim-layer"> を置き、枠の外側を暗くする 4 枚（上・下・左・右）、2px の枠、8 点のつまみ、
  // 「幅 ○ mm × 高さ ○ mm」の札を並べる。層は押しても何も受けない（押し離しは annotate-trim.js がページで受ける）。色と大きさは
  // shell.css（.trim-*）が持ち、ここは位置と大きさだけを付ける。

  // 札と枠の間（px）と、札の高さの見込み。枠の下に入りきらなければ、枠の内側の下端に置く（.pdf-page は外を切るため）。
  const LABEL_GAP = 6;
  const LABEL_HEIGHT = 22;
  const SIDES = ['top', 'bottom', 'left', 'right'];

  function part(doc, layer, className) {
    const node = doc.createElement('div');
    node.className = className;
    layer.append(node);
    return node;
  }

  function place(node, x, y, width, height) {
    Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, width)}px`, height: `${Math.max(0, height)}px` });
  }

  function build(pageNode) {
    const doc = pageNode.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'trim-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (const side of SIDES)
      part(doc, layer, 'trim-shade').dataset.side = side;
    part(doc, layer, 'trim-box');
    for (const { name } of root.SigK.trimDrag.handlesOf({ x1: 0, y1: 0, x2: 0, y2: 0 }))
      part(doc, layer, 'trim-handle').dataset.handle = name;
    part(doc, layer, 'trim-label');
    pageNode.append(layer);
    return layer;
  }

  function shade(layer, side) {
    return layer.querySelector(`.trim-shade[data-side="${side}"]`);
  }

  // 札は枠の左下の外に置く。枠がページの右半分から始まるなら、右端をそろえる（はみ出して切れないように）。
  function placeLabel(node, rect, { width, height }, text) {
    node.textContent = text;
    const below = rect.y2 + LABEL_GAP + LABEL_HEIGHT <= height;
    const top = below ? rect.y2 + LABEL_GAP : rect.y2 - LABEL_GAP - LABEL_HEIGHT;
    const rightSide = rect.x1 > width / 2;
    Object.assign(node.style, { top: `${top}px`, left: rightSide ? '' : `${rect.x1}px`, right: rightSide ? `${width - rect.x2}px` : '' });
  }

  // pageNode の中に枠を描く（無ければ作る）。rect は px の枠、size はそのページの見える範囲の px { width, height }、label は札の文字。
  function draw(pageNode, rect, size, label) {
    const layer = pageNode.querySelector(':scope > .trim-layer') ?? build(pageNode);
    const { width, height } = size;
    place(shade(layer, 'top'), 0, 0, width, rect.y1);
    place(shade(layer, 'bottom'), 0, rect.y2, width, height - rect.y2);
    place(shade(layer, 'left'), 0, rect.y1, rect.x1, rect.y2 - rect.y1);
    place(shade(layer, 'right'), rect.x2, rect.y1, width - rect.x2, rect.y2 - rect.y1);
    place(layer.querySelector('.trim-box'), rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1);
    const centers = new Map(root.SigK.trimDrag.handlesOf(rect).map((at) => [at.name, at]));
    for (const node of layer.querySelectorAll('.trim-handle')) {
      const at = centers.get(node.dataset.handle);
      Object.assign(node.style, { left: `${at.x}px`, top: `${at.y}px` });
    }
    placeLabel(layer.querySelector('.trim-label'), rect, size, label);
    return layer;
  }

  // 枠を消す。keep に渡したページの中の枠だけは残す。
  function clear(doc, keep = null) {
    for (const layer of doc?.querySelectorAll('.trim-layer') ?? []) {
      if (keep === null || layer.parentElement !== keep)
        layer.remove();
    }
  }

  // 枠のつまみと中の上のカーソル（html の data-trim-cursor。shell.css。確定事項13）。null で外す。
  function setCursor(doc, cursor) {
    const html = doc?.documentElement;
    if (cursor === null)
      html?.removeAttribute('data-trim-cursor');
    else
      html?.setAttribute('data-trim-cursor', cursor);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.trimFrame = { draw, clear, setCursor };
})(typeof window !== 'undefined' ? window : globalThis);
