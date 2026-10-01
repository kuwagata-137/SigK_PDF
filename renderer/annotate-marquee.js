(function (root) {
  'use strict';

  // 「選択」の道具の範囲選択（spec-4b-3a 確定事項D。モック screenshots/phase4b-3-marquee.png）。
  //
  // 紙の上の書き込みの無い所を押したら begin、動かすたびに move（.pdf-page の中の <div class="annot-marquee"> の位置と大きさを
  // 変えるだけで、書き込みは描き直さない）、離したら end（枠に完全に収まった書き込みを選ぶ）。素で始めたら押した時点で選択を
  // 外し、Ctrl か Shift で始めたら今の選択に足す。取りやめ（cancel）では押す前の選択に戻す。

  // 引いているもの { index, node, viewport, start, last, add, before, div, moved }。無ければ null。
  let marquee = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function slop() {
    return root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? root.SigK.viewer.getTextLayer(index)?.viewport ?? null;
  }

  // 押した。add は Ctrl か Shift を押して始めたか。
  function begin(event, page, { add = false } = {}) {
    const viewport = viewportOf(page.index);
    if (viewport === null)
      return false;
    event.preventDefault();
    const before = annotate().getSelection();
    marquee = { index: page.index, node: page.node, viewport, start: page.point, last: page.point, add, before, div: null, moved: false };
    if (!add)
      annotate().selectKeys([]);
    return true;
  }

  function box(current) {
    return root.SigK.annotationMarquee.boxOf(current.start, current.last, { width: current.viewport.width, height: current.viewport.height });
  }

  function draw(current) {
    if (current.div === null) {
      current.div = current.node.ownerDocument.createElement('div');
      current.div.className = 'annot-marquee';
      current.node.append(current.div);
    }
    const { x, y, width, height } = box(current);
    Object.assign(current.div.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  }

  function clearDiv(current) {
    current.div?.remove();
    current.div = null;
  }

  // 倍率の変更でページが捨てられたら取りやめる（spec-4b-2 のつまみと同じ考え方）。
  function move(event) {
    if (marquee === null)
      return false;
    if (marquee.node.isConnected !== true) {
      cancel();
      return true;
    }
    marquee.last = pointIn(marquee.node, event);
    const [dx, dy] = [marquee.last[0] - marquee.start[0], marquee.last[1] - marquee.start[1]];
    if (Math.abs(dx) > slop() || Math.abs(dy) > slop())
      marquee.moved = true;
    if (marquee.moved)
      draw(marquee);
    return true;
  }

  // そのページの、枠に完全に収まった書き込みの鍵（描く順）。
  function enclosed(current) {
    const view = root.SigK.viewer;
    const src = view.getPlan()[current.index]?.src;
    if (!Number.isInteger(src))
      return [];
    const entries = root.SigK.annotationState.annotsOnPage(view.getAnnotations(), view.getImported(), src);
    return root.SigK.annotationMarquee.enclosedKeys(entries, box(current), (entry) => root.SigK.annotationFrame.boundsOf(entry, current.viewport));
  }

  // 離した。引いていれば true（押し離しの残りの経路へは流さない）。押しただけ（3px 以内）なら選択は begin のまま。
  function end(event) {
    const current = marquee;
    marquee = null;
    if (current === null)
      return false;
    clearDiv(current);
    if (current.node.isConnected !== true) {
      annotate().selectKeys(current.before);
      return true;
    }
    current.last = pointIn(current.node, event);
    const [dx, dy] = [current.last[0] - current.start[0], current.last[1] - current.start[1]];
    if (!current.moved && Math.abs(dx) <= slop() && Math.abs(dy) <= slop())
      return true;
    const keys = enclosed(current);
    const selection = root.SigK.annotationSelection;
    const pageOf = (key) => root.SigK.annotateSelect.pageOf(key);
    const src = root.SigK.viewer.getPlan()[current.index]?.src;
    const kept = current.add ? current.before.filter((key) => pageOf(key) === src) : [];
    annotate().selectKeys(selection.merged(kept, keys));
    return true;
  }

  // 取りやめ（Esc・取り消し・ページを捨てた）。押す前の選択に戻す。引いていなければ false。
  function cancel() {
    const current = marquee;
    marquee = null;
    if (current === null)
      return false;
    clearDiv(current);
    annotate().selectKeys(current.before);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateMarquee = { begin, move, end, cancel, isActive: () => marquee !== null };
})(typeof window !== 'undefined' ? window : globalThis);
