(function (root) {
  'use strict';

  // モザイクの道具の押し離し（spec-4b-6b 確定事項10〜17。決定64 ⑦・決定66 ④。見本 screenshots/phase4b-6-mosaic-preview.png）。
  //
  // 紙の上を左ボタンで引くと、破線の四角（.mosaic-draft）で範囲を見せ（3px を超えて動かしてから）、離したらその範囲にモザイクを置く
  // （1 世代。今の粗さ）。四角はそのページの今の見える範囲の中に収める。px の四角と紙の座標の行き来は trim-drag.js の rectFrom・boxOf。
  // Esc・左＋右・取り消しとやり直しの前・道具やモードを替える・保存と印刷の前・窓のフォーカスが外れた・倍率が変わったときは、引いている
  // 途中をやめる（置かない）。粗さと［このページのモザイクを外す］の右パネルは mosaic-props.js、下見の塗りは mosaic-paint.js。

  const state = {
    doc: null,
    // 押して引いているもの { index, node, scale, start, rect（px の四角。3px を超えて動くまでは null）}。無ければ null。
    drag: null,
    // 次に置くモザイクの粗さ（pt。確定事項14・15）。
    block: null,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function mosaic() {
    return root.SigK.pageMosaic;
  }

  function active() {
    return root.SigK.annotate?.getTool() === 'mosaic' && state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  // 引いている途中の破線の四角（確定事項11）。無ければ作り、rect が null なら消す。
  function drawDraft(node, rect) {
    let draft = node.querySelector(':scope > .mosaic-draft');
    if (rect === null) {
      draft?.remove();
      return;
    }
    if (draft === null) {
      draft = node.ownerDocument.createElement('div');
      draft.className = 'mosaic-draft';
      draft.setAttribute('aria-hidden', 'true');
      node.append(draft);
    }
    Object.assign(draft.style, { left: `${rect.x1}px`, top: `${rect.y1}px`, width: `${rect.x2 - rect.x1}px`, height: `${rect.y2 - rect.y1}px` });
  }

  function clearDrafts() {
    for (const draft of state.doc?.querySelectorAll('.mosaic-draft') ?? [])
      draft.remove();
  }

  // 粗さ（確定事項14・15）。3 段のどれでもなければ既定（ふつう）。
  function getBlock() {
    return mosaic().isBlock(state.block) ? state.block : mosaic().DEFAULT_BLOCK;
  }

  // 設定から読み戻す（app.js。覚えない）。
  function applyBlock(block) {
    if (mosaic().isBlock(block))
      state.block = block;
    root.SigK.mosaicProps?.refresh();
    return getBlock();
  }

  // 右パネルで選んだ（覚える。置いたモザイクは変えない）。
  function setBlock(block) {
    if (!mosaic().isBlock(block))
      return false;
    state.block = block;
    root.SigK.shell?.persist?.({ annotMosaicBlock: block });
    root.SigK.mosaicProps?.refresh();
    return true;
  }

  // plan の index のページの要素を作り替えて 1 世代にする（確定事項16・17）。make(entry, visible) が null なら積まない。
  function commitPage(index, make) {
    const plan = viewer().getPlan();
    const entry = plan[index];
    const base = Number.isInteger(entry?.src) ? viewer().getBasePage(entry.src) : null;
    if (base === null)
      return false;
    const next = make(entry, root.SigK.pageCrop.visibleOf(entry, base.view));
    if (next === null)
      return false;
    root.SigK.pageEdit.commit(root.SigK.pagePlan.editPages(plan, new Map([[index, () => next]])), { before: [index], after: [index] });
    root.SigK.mosaicProps?.refresh();
    return true;
  }

  // モザイクを持って紙の上を左ボタンで押した。始めたら true（ほかの押下の経路へは流さない）。紙の外なら false。
  function begin(event) {
    if (!active() || viewer()?.getState().open !== true)
      return false;
    const page = root.SigK.annotatePress.pageAt(event);
    if (page === null)
      return false;
    event.preventDefault();
    // 差し込んだ未保存のページには置かない（確定事項13）。
    if (!Number.isInteger(viewer().getPlan()[page.index]?.src)) {
      root.SigK.viewBanner?.show('差し込んだページは、保存してからモザイクを入れてください。', { tone: 'warn' });
      return true;
    }
    const viewport = viewportOf(page.index);
    if (viewport === null)
      return true;
    state.drag = { index: page.index, node: page.node, scale: viewport.scale, start: page.point, rect: null };
    return true;
  }

  // 引いている点 point まで四角を広げる。3px を超えて動くまでは何もしない。
  function follow(point) {
    const current = state.drag;
    const slop = root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
    if (current.rect === null && Math.abs(point[0] - current.start[0]) <= slop && Math.abs(point[1] - current.start[1]) <= slop)
      return;
    const viewport = viewportOf(current.index);
    current.rect = root.SigK.trimDrag.rectFrom(current.start, point, { width: viewport.width, height: viewport.height });
    drawDraft(current.node, current.rect);
  }

  // 倍率が変わった・ページが捨てられた（確定事項12）。
  function lost() {
    const current = state.drag;
    return current.node.isConnected !== true || viewportOf(current.index)?.scale !== current.scale;
  }

  // 引いている途中をやめる（置かない）。やめたら true。
  function cancel() {
    if (state.drag === null)
      return false;
    state.drag = null;
    clearDrafts();
    return true;
  }

  // 離した（離しが届かなかったときも、最後の四角で）。四角があれば、その範囲にモザイクを置く。
  function place() {
    const { index, rect } = state.drag;
    cancel();
    const viewport = rect === null ? null : viewportOf(index);
    const box = viewport === null ? null : root.SigK.trimDrag.boxOf(rect, viewport);
    if (box === null)
      return false;
    return commitPage(index, (entry, visible) => mosaic().withMosaic(entry, box, getBlock(), visible));
  }

  // 動かした。引いていなければ false。左を離したのが届かなかった（窓の外で離した）ら、最後の四角で置く。
  function move(event) {
    if (state.drag === null)
      return false;
    if (lost())
      return cancel();
    if (((event.buttons ?? 0) & 1) === 0) {
      place();
      return true;
    }
    follow(pointIn(state.drag.node, event));
    return true;
  }

  // 離した。引いていれば true（押し離しの残りの経路へは流さない）。
  function end(event) {
    if (state.drag === null)
      return false;
    if (lost())
      return cancel();
    follow(pointIn(state.drag.node, event));
    place();
    return true;
  }

  // ［このページのモザイクを外す］（確定事項16。決定66 ④）。index のページ（既定は今のページ）のモザイクを全部外す。外したら true。
  function removeOnPage(index = viewer()?.getState().current ?? 0) {
    return commitPage(index, (entry) => (mosaic().countOf(entry) > 0 ? mosaic().withoutMosaic(entry) : null));
  }

  function init(doc, win) {
    if (win.__sigkAnnotateMosaicReady === true)
      return false;
    win.__sigkAnnotateMosaicReady = true;
    state.doc = doc;
    // 窓のフォーカスが外れたら、引いている途中をやめる（確定事項12）。
    win.addEventListener('blur', () => cancel());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateMosaic = { init, begin, move, end, cancel, removeOnPage, getBlock, applyBlock, setBlock, isDragging: () => state.drag !== null };
})(typeof window !== 'undefined' ? window : globalThis);
