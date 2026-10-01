(function (root) {
  'use strict';

  // 選んでいる書き込みを掴んでまとめて動かす（spec-4-2 確定事項6、spec-4-3 確定事項5、spec-4-4 確定事項2、spec-4b-3a 確定事項F）。
  //
  // annotate-pointer.js から移した（spec-4b-2。200 行の目安）。押したときに begin、動かすたびに move（動かせる書き込みの <g> と、
  // 枠の層のその鍵の組を CSS で translate するだけで描き直さない。spec-4b-2 確定事項23）、離したときに end（紙の座標の差分に直して
  // まとめて 1 世代。annotate-bulk.js）。Shift を押している間は、画面の px で動きの大きい方の向きだけを残す（確定事項F5）。
  // Ctrl を押している間は写しを作る形になり、元は元の位置に戻って写し（annotation-ghosts.js）が動く。引いている途中の Ctrl の
  // 押し離しも効く（確定事項G1・G2）。

  // 掴んで動かしているもの { keys, index, viewport, node, start(px), last(px), shift, copy, groups, moved }。無ければ null。
  let drag = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function frame() {
    return root.SigK.annotationFrame;
  }

  function ghosts() {
    return root.SigK.annotationGhosts;
  }

  function slop() {
    return root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
  }

  function entryOf(key) {
    const view = root.SigK.viewer;
    return root.SigK.annotationState.findAnnot(view.getAnnotations(), view.getImported(), key);
  }

  function setCursor(cursor) {
    const html = drag?.node.ownerDocument.documentElement ?? null;
    if (html === null)
      return;
    if (cursor === null)
      html.removeAttribute('data-transform-cursor');
    else
      html.setAttribute('data-transform-cursor', cursor);
  }

  // 書き込みの <g>。層が描き直されて外れていたら引き直す（事前調査 E。毎回は引かない）。
  function groupsOf(current) {
    for (const key of current.keys) {
      const group = current.groups.get(key) ?? null;
      if (group === null || group.isConnected !== true)
        current.groups.set(key, current.node.querySelector(`.annot-layer g[data-annot="${key}"]`));
    }
    return [...current.groups.values()].filter((group) => group !== null);
  }

  // 押した点からの動き（画面の px）。Shift なら大きい方の向きだけ（等しいときは横）。
  function offsetOf(current) {
    const dx = current.last[0] - current.start[0];
    const dy = current.last[1] - current.start[1];
    if (!current.shift)
      return [dx, dy];
    return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
  }

  // 選んでいる書き込み key の上で押したらドラッグの準備。押した書き込みが動かせないなら掴まない（確定事項F2）。
  // 文字選択を始めさせない。
  function begin(event, page, key) {
    const entry = entryOf(key);
    if (entry === null || entry.readonly === true || !annotate().isSelected(key) || !root.SigK.annotationMoves.isMovable(entry))
      return false;
    const viewport = root.SigK.freeTextEditor?.pageOf(page.index)?.viewport ?? root.SigK.viewer.getTextLayer(page.index)?.viewport;
    if (viewport === undefined || viewport === null)
      return false;
    event.preventDefault();
    const start = [event.clientX, event.clientY];
    drag = {
      keys: root.SigK.annotateBulk.movableKeys(), index: page.index, viewport, node: page.node,
      start, last: start, shift: event.shiftKey === true, copy: event.ctrlKey === true, groups: new Map(), moved: false,
    };
    return true;
  }

  // 写しを作る形なら元は動かさず写しを動かし、動かす形なら元を動かす。枠はどちらでも動く方に付いていく。
  function paint(current) {
    const [dx, dy] = offsetOf(current);
    const transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
    const groups = groupsOf(current);
    if (current.copy && current.moved) {
      for (const group of groups)
        group.style.transform = '';
      if (!ghosts().isShown())
        ghosts().show(groups);
      ghosts().translate(dx, dy);
    } else {
      ghosts().clear();
      for (const group of groups)
        group.style.transform = transform;
    }
    frame()?.translate(dx, dy, current.keys);
    if (current.moved)
      setCursor(current.copy ? 'copy' : 'move');
  }

  function clearPaint(current) {
    ghosts().clear();
    for (const group of groupsOf(current))
      group.style.transform = '';
    frame()?.translate(0, 0);
  }

  // 書き込みの <g> と、枠のその鍵の組（spec-4b-2 確定事項23）を同じだけずらす。倍率の変更でページが捨てられたら取りやめる。
  function move(event) {
    if (drag === null)
      return false;
    if (drag.node.isConnected !== true) {
      cancel();
      return true;
    }
    drag.last = [event.clientX, event.clientY];
    drag.shift = event.shiftKey === true;
    drag.copy = event.ctrlKey === true;
    if (Math.abs(drag.last[0] - drag.start[0]) > slop() || Math.abs(drag.last[1] - drag.start[1]) > slop())
      drag.moved = true;
    paint(drag);
    return true;
  }

  // Shift と Ctrl の押し離しは、マウスを動かさなくても効かせる（確定事項F5・G1）。
  function onKey(event) {
    if (drag === null || (event.key !== 'Shift' && event.key !== 'Control'))
      return;
    if (event.key === 'Shift')
      drag.shift = event.type === 'keydown';
    else
      drag.copy = event.type === 'keydown';
    paint(drag);
  }

  // 離したら紙の座標での差分に直してまとめて 1 世代積む。動いていなければ false（押し離しの残りの経路でクリックとして扱う）。
  function end(event) {
    const current = drag;
    if (current === null)
      return false;
    current.last = [event.clientX, event.clientY];
    current.shift = event.shiftKey === true;
    current.copy = event.ctrlKey === true;
    const [dx, dy] = offsetOf(current);
    clearPaint(current);
    setCursor(null);
    drag = null;
    if (!current.moved && Math.abs(current.last[0] - current.start[0]) <= slop() && Math.abs(current.last[1] - current.start[1]) <= slop())
      return false;
    const from = current.viewport.convertToPdfPoint(current.start[0], current.start[1]);
    const to = current.viewport.convertToPdfPoint(current.start[0] + dx, current.start[1] + dy);
    const delta = [to[0] - from[0], to[1] - from[1]];
    if (current.copy)
      root.SigK.annotateBulk.copySelected(delta);
    else
      root.SigK.annotateBulk.moveSelected(delta);
    return true;
  }

  // 取りやめ（Esc・取り消し・ページを捨てた）。元の位置に戻す。掴んでいなければ false。
  function cancel() {
    const current = drag;
    if (current === null)
      return false;
    clearPaint(current);
    setCursor(null);
    drag = null;
    return true;
  }

  function init(doc) {
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('keyup', onKey);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateGrab = { init, begin, move, end, cancel, isGrabbing: () => drag !== null };
})(typeof window !== 'undefined' ? window : globalThis);
