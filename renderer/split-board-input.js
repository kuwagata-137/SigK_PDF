(function (root) {
  'use strict';

  // 分割の盤を押す・なぞる・キーで動かす（spec-2-2b 確定事項C3・E1・G2①・G3）。
  //
  // 押しただけでは選択を変えない。動かさずに離せば click で選び（Shift なら前に選んだページとの間）、5px 以上動かせば
  // なぞるとみなして、押したページから指の下のページまでを選ぶ（page-grid.js と同じ作法。本物のマウスでは pointerdown が
  // click より先に来るので、押した瞬間に選び直すと Shift＋クリックが効かなくなる）。なぞり終えたときの click は 1 回捨てる。
  // 盤の端に寄せている間は自動でスクロールする。✂ と［つなげる］の上ではなぞり始めない。
  //
  // なぞる途中の Esc は、なぞる前の選択に戻して止める。document の keydown を Esc の振り分け（viewer-keys.js）より先に登録する
  // （app.js の init の順）ので、preventDefault を見て escape-order.js は何もしない。盤の上のキーは盤の器で止め、裏のページビューへ流さない。

  const DRAG_THRESHOLD = 5;
  const AUTO_SCROLL = Object.freeze({ edge: 36, step: 18, interval: 30 });
  const ROW_GAP = 12;
  const BOARD_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter', 'PageUp', 'PageDown']);

  const drag = { pressed: null, startX: 0, startY: 0, active: false, before: null, timer: 0, last: null, swallowClick: false };
  const state = { current: null };
  let el = null;

  const edit = () => root.SigK.toolsSplitEdit;
  const selection = () => root.SigK.splitSelection;
  const layout = () => root.SigK.splitLayout;
  const view = () => root.SigK.splitBoardView;

  const isOnControl = (target) => target?.closest?.('.sb-cut, .sb-join') != null;

  function pageOf(target) {
    const node = target?.closest?.('.sb-page') ?? null;
    return node === null ? null : Number(node.dataset.page);
  }

  // 指の下のページを選ぶ。座標は盤の器（スクロールで一緒に動く）から見た位置にする。
  function selectUnder(point) {
    const placed = view().layout();
    if (placed === null)
      return;
    const rect = el.canvas.getBoundingClientRect();
    const page = layout().pageAt(placed, point.clientX - rect.left, point.clientY - rect.top);
    if (page === null)
      return;
    state.current = page;
    edit().setSelection(selection().dragTo(drag.pressed, page));
  }

  function stopAutoScroll() {
    if (drag.timer === 0)
      return;
    el.win.clearInterval(drag.timer);
    drag.timer = 0;
  }

  // 端に寄せている間だけスクロールを続け、そのたびに指の下を選び直す（指を止めても中身が動くため）。
  function updateAutoScroll(point) {
    const rect = el.scroll.getBoundingClientRect();
    const step = root.SigK.pageGridRules.autoScrollStep({
      y: point.clientY - rect.top, viewportHeight: el.scroll.clientHeight, edge: AUTO_SCROLL.edge, step: AUTO_SCROLL.step,
    });
    stopAutoScroll();
    if (step === 0)
      return;
    drag.timer = el.win.setInterval(() => {
      el.scroll.scrollTop += step;
      selectUnder(drag.last);
    }, AUTO_SCROLL.interval);
  }

  function endDrag() {
    stopAutoScroll();
    Object.assign(drag, { pressed: null, active: false, before: null, last: null });
  }

  // なぞる途中の取りやめ。なぞり始めていれば、なぞる前の選択に戻す。
  function cancelHeld() {
    if (drag.pressed === null)
      return false;
    const { active, before } = drag;
    endDrag();
    if (active)
      edit().setSelection(before);
    return true;
  }

  function onPointerDown(event) {
    drag.swallowClick = false;
    if (event.button !== 0 || isOnControl(event.target))
      return;
    const page = pageOf(event.target);
    if (page === null)
      return;
    el.scroll.focus?.({ preventScroll: true });
    Object.assign(drag, { pressed: page, startX: event.clientX, startY: event.clientY, active: false, before: edit().selection() });
  }

  function onPointerMove(event) {
    if (drag.pressed === null)
      return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD)
        return;
      drag.active = true;
    }
    drag.last = { clientX: event.clientX, clientY: event.clientY };
    selectUnder(drag.last);
    updateAutoScroll(drag.last);
  }

  function onPointerUp() {
    if (drag.active)
      drag.swallowClick = true;
    endDrag();
  }

  function onClick(event) {
    if (drag.swallowClick) {
      drag.swallowClick = false;
      return;
    }
    if (isOnControl(event.target))
      return;
    const page = pageOf(event.target);
    if (page === null)
      return;
    state.current = page;
    edit().select(page, { shift: event.shiftKey });
  }

  function onDoubleClick(event) {
    const page = pageOf(event.target);
    if (page !== null && !isOnControl(event.target))
      root.SigK.splitZoom?.open(page);
  }

  // ---- 盤の上のキー（確定事項G3） ----

  // 上下の段へ。いまのページの真上・真下に近いページ（箱をまたぐ）。
  function vertical(placed, base, direction) {
    const rect = layout().pageRect(placed, base);
    const y = direction > 0 ? rect.y + rect.height * 1.5 + ROW_GAP : rect.y - rect.height / 2 - ROW_GAP;
    return layout().pageAt(placed, rect.x + rect.width / 2, y) ?? base;
  }

  function targetOf(key, base, placed, last) {
    if (key === 'Home')
      return 0;
    if (key === 'End')
      return last;
    if (key === 'ArrowLeft')
      return Math.max(0, base - 1);
    if (key === 'ArrowRight')
      return Math.min(last, base + 1);
    return vertical(placed, base, key === 'ArrowDown' ? 1 : -1);
  }

  function onBoardKey(event) {
    if (event.target !== el.scroll || !BOARD_KEYS.has(event.key) || event.ctrlKey || event.altKey || event.metaKey)
      return;
    event.preventDefault();
    event.stopPropagation();
    const placed = view().layout();
    if (placed === null)
      return;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      el.scroll.scrollTop += (event.key === 'PageDown' ? 1 : -1) * el.scroll.clientHeight * 0.9;
      view().schedule();
      return;
    }
    const last = edit().board().pageCount - 1;
    const base = Math.min(state.current ?? selection().range(edit().selection())?.from ?? 0, last);
    if (event.key === ' ') {
      state.current = base;
      edit().select(base);
      return;
    }
    if (event.key === 'Enter') {
      root.SigK.splitZoom?.open(base);
      return;
    }
    const next = targetOf(event.key, base, placed, last);
    state.current = next;
    if (event.shiftKey)
      edit().select(next, { shift: true });
    view().revealPage(next);
  }

  // なぞる途中の Esc（確定事項G2①）。
  function onDocumentKey(event) {
    if (event.key !== 'Escape' || drag.pressed === null)
      return;
    event.preventDefault();
    event.stopPropagation();
    cancelHeld();
  }

  function init(doc, win) {
    if (win.__sigkSplitBoardInputReady === true)
      return false;
    const scroll = doc.getElementById('split-board-scroll');
    if (scroll === null)
      return false;
    win.__sigkSplitBoardInputReady = true;
    el = { doc, win, scroll, canvas: doc.getElementById('split-board-canvas') };
    scroll.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    // タッチでスクロールすると pointerup の代わりに pointercancel が来る。押した控えを残さない。
    doc.addEventListener('pointercancel', () => cancelHeld());
    scroll.addEventListener('click', onClick);
    scroll.addEventListener('dblclick', onDoubleClick);
    scroll.addEventListener('keydown', onBoardKey);
    doc.addEventListener('keydown', onDocumentKey);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardInput = {
    DRAG_THRESHOLD, init, cancelHeld,
    current: () => state.current,
    isDragging: () => drag.active,
    resetCurrent: () => { state.current = null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
