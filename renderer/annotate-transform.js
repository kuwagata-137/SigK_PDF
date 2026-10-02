(function (root) {
  'use strict';

  // つまみで四角・丸の大きさと向き、直線・矢印の端、テキストの幅を変える指揮（spec-4b-2 確定事項15〜22・24〜26、spec-4b-4a 確定事項F）。
  //
  // 押したとき（begin）に、選んでいる書き込みのつまみ（annotation-frame.js が出している位置）に当たればドラッグを始める。
  // 紙の外（灰色）で押しても、選んでいる書き込みのページの座標で見る。動かしている間（move）は shape-resize.js の patch を
  // 下見（annotate-preview.updateShape）で描き、離したとき（end）に 1 世代積む。Esc・選択の変更・Ctrl+Z・Delete・ページの
  // 描き直し（倍率の変更など）は取りやめ（cancel）。マウスを動かしたとき（hover）は、つまみに合うカーソルを html の
  // data-transform-cursor に出す。右パネルの回転の行（annotation-angle-row.js）も、同じ下見と commit を使う。

  // ドラッグ { key, entry, handle, index, viewport, node, press(px), moved, patch }。無ければ null。
  let drag = null;
  let doc = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function preview() {
    return root.SigK.annotatePreview;
  }

  function frame() {
    return root.SigK.annotationFrame;
  }

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  function pageNodeOf(index) {
    return doc?.querySelector(`.pdf-page[data-page="${index + 1}"]`) ?? null;
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  function setCursor(cursor) {
    const html = doc?.documentElement;
    if (html === undefined || html === null)
      return;
    if (cursor === null || cursor === undefined)
      html.removeAttribute('data-transform-cursor');
    else
      html.setAttribute('data-transform-cursor', cursor);
  }

  // 点の下にある、選んでいる書き込みのつまみ。無ければ null。
  function handleUnder(event) {
    const shown = frame()?.shown() ?? null;
    if (shown === null || shown.shape === null || shown.key !== annotate()?.getSelected())
      return null;
    const node = pageNodeOf(shown.index);
    if (node === null)
      return null;
    const point = pointIn(node, event);
    const handle = root.SigK.shapeHandles.handleAt(shown.shape.handles, point);
    return handle === null ? null : { shown, node, point, handle };
  }

  // 押した。つまみに当たればドラッグを始めて true（押し離しの残りの経路へは流さない）。
  function begin(event) {
    if (drag !== null || (event.button !== undefined && event.button !== 0))
      return false;
    const hit = handleUnder(event);
    const entry = hit === null ? null : annotate().selectedEntry();
    if (entry === null || entry.readonly === true)
      return false;
    event.preventDefault();
    drag = { key: hit.shown.key, entry, handle: hit.handle, index: hit.shown.index, viewport: hit.shown.viewport, node: hit.node, press: hit.point, moved: false, patch: null };
    setCursor(hit.handle.cursor);
    return true;
  }

  function patchFor(point, shift) {
    const { entry, handle, viewport, press } = drag;
    const resize = root.SigK.shapeResize;
    if (handle.kind === 'width')
      return root.SigK.freeTextResize.widthPatch(entry, handle.id, press, point, viewport);
    if (handle.kind === 'end')
      return resize.endpointMoved(entry, handle.id, press, point, viewport, { shift });
    if (handle.kind === 'rotate') {
      const center = viewport.convertToViewportPoint(...rotation().centerOf(entry.rect));
      return resize.rotatedBy(entry, press, point, center, { shift });
    }
    return resize.resized(entry, handle.id, viewport.convertToPdfPoint(...press), viewport.convertToPdfPoint(...point), { shift });
  }

  // ページを描き直して（倍率の変更など）枠が出ていないなら、ドラッグはもう続けられない。
  function stale() {
    return drag.node.isConnected !== true || frame()?.shown()?.index !== drag.index;
  }

  // 動かした。押してから 3px（CLICK_SLOP）を超えたら下見を描く。
  function move(event) {
    if (drag === null)
      return false;
    if (stale())
      return !cancel();
    const point = pointIn(drag.node, event);
    const slop = root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
    if (!drag.moved && Math.abs(point[0] - drag.press[0]) <= slop && Math.abs(point[1] - drag.press[1]) <= slop)
      return true;
    drag.moved = true;
    const patch = patchFor(point, event.shiftKey === true);
    if (patch === null)
      return true;
    drag.patch = patch;
    preview().updateShape(drag.key, patch);
    return true;
  }

  // 1 世代積んで選び直す（annotate-shape.js の commit と同じ約束。読み込んだものは写しに付け替わる）。形が元と同じなら積まない。
  function commit(entry, patch) {
    const entries = root.SigK.annotationEntry;
    const picked = entries.pickPatch(patch, entry.kind);
    if (picked === null || entries.sameEntry(entries.applyPatch(entry, picked), entry))
      return false;
    const annots = root.SigK.viewer.getAnnotations();
    const next = root.SigK.annotationState.updateAnnot(annots, entry, patch);
    if (next === annots)
      return false;
    const key = keyOf(entry);
    const after = entry.ref !== undefined ? next.added.at(-1).id : key;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before: key, after } });
    annotate().select(after);
    return true;
  }

  // 離した。動いていれば 1 世代積む。つまみの押し離しは、動いていなくても選択を変えない（確定事項22）。
  function end() {
    if (drag === null)
      return false;
    const current = drag;
    drag = null;
    setCursor(null);
    preview().cancel();
    if (current.moved && current.patch !== null)
      commit(current.entry, current.patch);
    return true;
  }

  // 取りやめ（元の形に戻す。確定事項21）。ドラッグしていなければ false。
  function cancel() {
    if (drag === null)
      return false;
    drag = null;
    setCursor(null);
    preview().cancel();
    return true;
  }

  // マウスを動かしたとき、つまみの上ならそのカーソルを出す（確定事項24）。
  function hover(event) {
    if (drag !== null)
      return;
    setCursor(handleUnder(event)?.handle.cursor ?? null);
  }

  // つまみの上のカーソルを外す（引いていないとき）。ハンドはつまみを見ないので、持ち替えたときに残さない（spec-4b-3b 確定事項A4）。
  function clearCursor() {
    if (drag === null)
      setCursor(null);
  }

  function init(document, win) {
    if (win.__sigkAnnotateTransformReady === true)
      return false;
    win.__sigkAnnotateTransformReady = true;
    doc = document;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTransform = { init, begin, move, end, cancel, hover, clearCursor, commit, isDragging: () => drag !== null };
})(typeof window !== 'undefined' ? window : globalThis);
