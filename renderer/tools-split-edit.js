(function (root) {
  'use strict';

  // 分割の盤の操作・履歴・選択の指揮（spec-2-2b 確定事項C1〜C9）。
  //
  // 盤（split-board-model.js）を履歴（split-board-history.js）に積み、選択（split-selection.js）と、まとめて分けるの欄の文字を持つ。
  // 画面のボタン・欄・キーは、ここの関数を呼ぶだけにする。盤が変わったら tools-split-view.js の render で画面全体を描き直す。
  // 実行中は盤の操作を受けない（確定事項C12）。大きさ（小・中・大）は描く層（split-thumbs.js）が持つ。

  const state = { history: null, selection: null, bulkText: { every: '3', at: '' }, bulkError: null };

  const model = () => root.SigK.splitBoard;
  const history = () => root.SigK.splitHistory;
  const selection = () => root.SigK.splitSelection;
  const thumbs = () => root.SigK.splitThumbs;
  const split = () => root.SigK.toolsSplit;
  const changed = () => root.SigK.toolsSplitView?.render();

  // 対象が決まったとき（tools-split.js）。盤と履歴を作り直す（確定事項B6）。
  function reset(pageCount) {
    state.history = history().create(model().create(pageCount));
    state.selection = null;
    state.bulkError = null;
    root.SigK.splitBoardInput?.resetCurrent();
  }

  const board = () => (state.history === null ? null : history().current(state.history));
  const locked = () => board() === null || split()?.isRunning() === true;
  const range = () => selection().range(state.selection);

  // 新しい盤を履歴に積む。変わらない操作は積まない。
  function apply(next, { keepSelection = true } = {}) {
    if (locked())
      return false;
    const pushed = history().push(state.history, next);
    const cleared = !keepSelection && state.selection !== null;
    if (!keepSelection)
      state.selection = null;
    if (pushed === state.history) {
      if (cleared)
        changed();
      return false;
    }
    state.history = pushed;
    changed();
    return true;
  }

  const cut = (at) => !locked() && apply(model().cut(board(), at));
  const join = (boxIndex) => !locked() && apply(model().join(board(), boxIndex));

  // 選んだ範囲を 1 つのファイルにする（確定事項C5）。押したあとは選択を外す。
  function makeOne() {
    const picked = range();
    return picked !== null && !locked() && apply(model().makeOne(board(), picked.from, picked.to), { keepSelection: false });
  }

  function setSkipped(flag) {
    const picked = range();
    return picked !== null && !locked() && apply(model().setSkipped(board(), picked.from, picked.to, flag));
  }

  // ---- まとめて分ける（確定事項C7）。欄の文字は押したときに 1 回だけ読む ----

  function fail(kind, message) {
    state.bulkError = { kind, message };
    changed();
    return false;
  }

  function bulk(kind) {
    if (locked())
      return false;
    const now = board();
    const plan = root.SigK.splitPlan;
    if (kind === 'each')
      return apply(model().splitEach(now));
    if (kind === 'clear')
      return apply(model().clearCuts(now));
    const parsed = kind === 'every' ? plan.parseEvery(state.bulkText.every) : plan.parseCuts(state.bulkText.at, now.pageCount);
    if (parsed.error !== undefined)
      return fail(kind, parsed.error);
    state.bulkError = null;
    const next = kind === 'every' ? model().splitEvery(now, parsed.n) : model().splitBefore(now, parsed.numbers);
    if (apply(next))
      return true;
    changed();   // 盤が同じでも、前の誤りの表示は消す
    return false;
  }

  // 欄を打ち直したら、その欄の誤りの表示を消す。
  function setBulkText(kind, text) {
    state.bulkText[kind] = String(text ?? '');
    if (state.bulkError?.kind !== kind)
      return;
    state.bulkError = null;
    changed();
  }

  // ---- 選択（確定事項C3） ----

  function select(page, { shift = false } = {}) {
    const now = board();
    if (locked() || !Number.isInteger(page) || page < 0 || page >= now.pageCount)
      return false;
    state.selection = shift ? selection().extend(state.selection, page) : selection().click(page);
    changed();
    return true;
  }

  // なぞる（split-board-input.js）。押した所から page まで。取りやめで戻すときは前の選択をそのまま渡す。
  function setSelection(next) {
    if (locked())
      return false;
    state.selection = next ?? null;
    changed();
    return true;
  }

  function clearSelection() {
    if (state.selection === null)
      return false;
    state.selection = null;
    changed();
    return true;
  }

  // Esc の順の最後の段（確定事項G2④。escape-order.js）。分割の画面を出しているときだけ、選択を外す。
  const escape = () => root.SigK.tools?.selected() === 'split' && clearSelection();

  // ---- 元に戻す・やり直す（確定事項C8） ----

  function step(direction) {
    if (locked())
      return false;
    const h = state.history;
    const can = direction === 'undo' ? history().canUndo(h) : history().canRedo(h);
    if (!can)
      return false;
    state.history = direction === 'undo' ? history().undo(h) : history().redo(h);
    state.selection = null;
    changed();
    return true;
  }

  function setSize(size) {
    if (!thumbs().setSize(size))
      return false;
    changed();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsSplitEdit = {
    reset, board, cut, join, makeOne, bulk, setBulkText, select, setSelection, clearSelection, escape, setSize,
    skip: () => setSkipped(true),
    unskip: () => setSkipped(false),
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: () => state.history !== null && history().canUndo(state.history),
    canRedo: () => state.history !== null && history().canRedo(state.history),
    selection: () => state.selection,
    bulkText: (kind) => state.bulkText[kind],
    bulkError: () => state.bulkError,
    size: () => thumbs().size(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
