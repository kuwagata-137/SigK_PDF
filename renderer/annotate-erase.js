(function (root) {
  'use strict';

  // 消しゴムの道具の押し離し（spec-4b-5b 確定事項18〜24。決定62）。
  //
  // 紙の上を押すと、書き込みの上でも選ばず掴まずに消し始め（eraser-draft.js が跡と下見を持つ）、離したときに 1 世代にまとめて当てる
  // （丸ごと消すものと、線が残らないペン・マーカーは removeEach、切ったペン・マーカーは updateEach で、commitAnnots を 1 回）。何にも
  // 触れなければ積まない。当てたら選択を外す。Esc・左＋右・Ctrl+Z・道具やモードを替える・保存や印刷の前は、なぞっている途中を
  // 取りやめる（cancel）。消しゴムを持っている間、紙の上では直径 16px の輪（.eraser-ring）をカーソルの代わりに出す（確定事項24）。

  // scale は押したときのページの倍率（なぞっている間に変われば取りやめる。点検 3）。
  const state = { doc: null, node: null, ring: null, scale: null };

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function draft() {
    return root.SigK.eraserDraft;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function holding() {
    return annotate()?.getTool() === 'eraser';
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function entriesOf(src) {
    const view = viewer();
    return root.SigK.annotationState.annotsOnPage(view.getAnnotations(), view.getImported(), src);
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  // 消しゴムを持って紙の上を左ボタンで押したら消し始める。始めたら true（ほかの押下の経路へは流さない）。
  function begin(event) {
    if (!holding() || !inAnnotMode() || viewer()?.getState().open !== true)
      return false;
    const page = root.SigK.annotatePress.pageAt(event);
    if (page === null)
      return false;
    const viewport = viewportOf(page.index);
    const src = viewer().getPlan()[page.index]?.src;
    if (viewport === null || !Number.isInteger(src))
      return false;
    event.preventDefault();
    state.node = page.node;
    state.scale = viewport.scale;
    draft().begin({ index: page.index, src, viewport, point: page.point, entries: entriesOf(src) });
    viewer().redrawAnnotations();
    return true;
  }

  function srcOfDraft() {
    return viewer().getPlan()[draft().pageIndex()]?.src;
  }

  // 押したときと同じ倍率か。変わっていれば、押したときの倍率で紙の点に直せない（点検 3）。
  function sameScale() {
    return viewportOf(draft().pageIndex())?.scale === state.scale;
  }

  // 動かした。なぞっている間は跡を伸ばして下見を描き直す。持っているだけなら輪を動かす。左を離した mouseup が届かなかった（窓の外で
  // 離した・Alt+Tab で捕捉が外れた）・倍率が変わったときは、当てずにやめる（点検 1・3。確定事項23）。
  function move(event) {
    hover(event);
    if (!draft().isErasing())
      return false;
    if (((event.buttons ?? 0) & 1) === 0 || !sameScale()) {
      cancel();
      return false;
    }
    draft().extend(pointIn(state.node, event), entriesOf(srcOfDraft()));
    viewer().redrawAnnotations();
    return true;
  }

  // 離した。当てて 1 世代にする。なぞっていなければ false。
  function end(event) {
    if (!draft().isErasing())
      return false;
    if (!sameScale())
      return cancel();
    draft().extend(pointIn(state.node, event), entriesOf(srcOfDraft()));
    const done = draft().finish();
    state.node = null;
    commit(done);
    viewer().redrawAnnotations();
    return true;
  }

  function commit({ remove, update }) {
    if (remove.length === 0 && update.size === 0)
      return false;
    const view = viewer();
    const before = view.getAnnotations();
    const imported = view.getImported();
    const bulk = root.SigK.annotationBulk;
    const updated = bulk.updateEach(before, imported, [...update.keys()], (entry) => {
      const paths = update.get(entry.ref ?? entry.id);
      return { paths, ...root.SigK.shapeGeometry.rectOfEntry(entry, { paths }) };
    }).annots;
    const after = bulk.removeEach(updated, imported, remove);
    if (after === before)
      return false;
    root.SigK.pageEdit.commitAnnots(after, { annot: { before: root.SigK.annotationSelection.annotKeys(annotate().getSelection()), after: null } });
    annotate().select(null);
    return true;
  }

  function cancel() {
    if (!draft().cancel())
      return false;
    state.node = null;
    viewer()?.redrawAnnotations();
    return true;
  }

  // ---- 輪のカーソル（確定事項24） ----

  function ring() {
    if (state.ring === null) {
      state.ring = state.doc.createElement('div');
      state.ring.className = 'eraser-ring';
      state.ring.setAttribute('aria-hidden', 'true');
      state.doc.body.append(state.ring);
    }
    return state.ring;
  }

  // 消しゴムを持って紙の上にいる間だけ、押す点を中心に輪を出す。
  function hover(event) {
    const over = holding() && inAnnotMode() && (draft().isErasing() || (event.target?.closest?.('.pdf-page') ?? null) !== null);
    if (!over) {
      hideRing();
      return;
    }
    const node = ring();
    node.hidden = false;
    node.style.left = `${event.clientX}px`;
    node.style.top = `${event.clientY}px`;
    // 紙の上のカーソルは、輪を出している間だけ消す（動かす前は十字のまま。点検 9）。
    state.doc.documentElement.setAttribute('data-eraser-ring', '');
  }

  function hideRing() {
    if (state.ring !== null)
      state.ring.hidden = true;
    state.doc?.documentElement.removeAttribute('data-eraser-ring');
  }

  function init(doc, win) {
    if (win.__sigkAnnotateEraseReady === true)
      return false;
    win.__sigkAnnotateEraseReady = true;
    state.doc = doc;
    doc.documentElement.addEventListener('mouseleave', hideRing);
    // 窓のフォーカスが外れたらやめる（離しが届かないことがあるため。点検 1）。
    win.addEventListener('blur', () => cancel());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateErase = { init, begin, move, end, cancel, hideRing, isErasing: () => draft()?.isErasing() === true };
})(typeof window !== 'undefined' ? window : globalThis);
