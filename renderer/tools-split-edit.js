(function (root) {
  'use strict';

  // 分割の盤の操作・履歴・選択の指揮（spec-2-2b 確定事項C1〜C9、spec-2-5 確定事項G5・G8）。
  //
  // 盤（split-board-model.js）と履歴（split-board-history.js）は、帯（タブ）ごとに split-board-store.js が持つ（決定80 ㉟）。
  // ここは選んでいる帯の盤を取り出して操作し、選択（split-selection.js）と、まとめて分けるの欄の文字を持つ。選択は帯を替えると外す。
  // 画面のボタン・欄・キーは、ここの関数を呼ぶだけにする。盤が変わったら tools-split-view.js の render で画面全体を描き直す。
  // 実行中は盤の操作を受けない（確定事項C12）。大きさ（小・中・大）は描く層（split-thumbs.js）が持つ。

  const state = { tabId: null, selection: null, bulkText: { every: '3', at: '' }, bulkError: null };

  const model = () => root.SigK.splitBoard;
  const history = () => root.SigK.splitHistory;
  const store = () => root.SigK.splitBoardStore;
  const selection = () => root.SigK.splitSelection;
  const thumbs = () => root.SigK.splitThumbs;
  const split = () => root.SigK.toolsSplit;
  const changed = () => root.SigK.toolsSplitView?.render();

  // 盤にする帯。分割の対象が使えるときだけ（パスワード付き・開けなかった帯は盤にしない。spec-2-5 G12）。
  function target() {
    const src = split()?.source() ?? null;
    if (src === null || src.blocked !== null)
      return null;
    const view = root.SigK.tabs?.peek(src.tabId) ?? null;
    return view === null || view.doc === undefined ? null : { tabId: src.tabId, name: src.name, view };
  }

  // 帯が替わったら、選択・まとめて分けるの誤り・今のページを外す。写した先の帯を一時的に映している間（tabs.withActive）は替わったと見ない（I7）。
  function follow(tabId) {
    if (tabId === state.tabId || root.SigK.tabs?.isBorrowing?.() === true)
      return;
    state.tabId = tabId;
    state.selection = null;
    state.bulkError = null;
    root.SigK.splitBoardInput?.resetCurrent();
  }

  // 選んでいる帯の履歴。並びが変わっていれば split-board-store.js がずらす。ページ数が変わって作り直したときは通知バーに出す（G8）。
  function currentHistory() {
    const now = target();
    follow(now?.tabId ?? null);
    if (now === null)
      return null;
    store().prune(root.SigK.tabs.list().map((tab) => tab.id));
    const { history: h, notice } = store().entryFor(now.tabId, now.view);
    if (notice === 'recount') {
      state.selection = null;
      root.SigK.viewBanner?.show(`「${now.name}」のページ数が変わったので、分け目を消しました。`, { tone: 'warn' });
    }
    return h;
  }

  const board = () => {
    const h = currentHistory();
    return h === null ? null : history().current(h);
  };
  const locked = () => board() === null || split()?.isRunning() === true;
  const range = () => selection().range(state.selection);

  // 新しい盤を履歴に積む。変わらない操作は積まない。
  function apply(next, { keepSelection = true } = {}) {
    if (locked())
      return false;
    const h = currentHistory();
    const pushed = history().push(h, next);
    const cleared = !keepSelection && state.selection !== null;
    if (!keepSelection)
      state.selection = null;
    if (pushed === h) {
      if (cleared)
        changed();
      return false;
    }
    store().set(state.tabId, pushed);
    root.SigK.toolHistory?.record('board', state.tabId);
    changed();
    return true;
  }

  const cut = (at) => !locked() && apply(model().cut(board(), at));
  const join = (boxIndex) => !locked() && apply(model().join(board(), boxIndex));
  const moveCut = (from, to) => !locked() && apply(model().moveCut(board(), from, to));

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

  // どれを押しても、前の誤りの表示は消す（盤が同じでも）。次の盤は split-plan.js の bulkNext が組む。
  function bulk(kind) {
    if (locked())
      return false;
    const { next, error } = root.SigK.splitPlan.bulkNext(kind, board(), state.bulkText);
    if (error !== undefined)
      return fail(kind, error);
    const hadError = state.bulkError !== null;
    state.bulkError = null;
    if (apply(next))
      return true;
    if (hadError)
      changed();
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
    const h = currentHistory();
    const can = direction === 'undo' ? history().canUndo(h) : history().canRedo(h);
    if (!can)
      return false;
    store().set(state.tabId, direction === 'undo' ? history().undo(h) : history().redo(h));
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
    board, cut, join, moveCut, makeOne, bulk, setBulkText, select, setSelection, clearSelection, escape, setSize,
    skip: () => setSkipped(true),
    unskip: () => setSkipped(false),
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: () => { const h = currentHistory(); return h !== null && history().canUndo(h); },
    canRedo: () => { const h = currentHistory(); return h !== null && history().canRedo(h); },
    selection: () => state.selection,
    bulkText: (kind) => state.bulkText[kind],
    bulkError: () => state.bulkError,
    size: () => thumbs().size(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
