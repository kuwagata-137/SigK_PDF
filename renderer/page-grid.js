(function (root) {
  'use strict';

  // ページモードのサイドパネル（spec-1-5 C・D・E）。
  //
  // 枠を並べるのは thumbnails.js のままである。あちらは「地図として紙を並べる」
  // 層で、閲覧モードと共通の仕組みを持つ。ここが足すのは**ページモードでしか
  // 意味を持たないもの**――選択と、ドラッグによる並べ替えである。
  //
  // 位置の判定（どの紙の手前へ入れるか）は page-plan.js の純粋関数に置いた。
  // jsdom は elementFromPoint も getBoundingClientRect も持たないため、
  // ここに書くと画面テストに載らない（確定事項33）。

  const state = {
    // 表示上の index の集合（確定事項14）。src ではなく表示 index で持つ。
    // 並べ替えたときは移動先の index へ付け替える。
    selection: [],
    // Shift クリックの起点。単独クリックと Ctrl クリックで動き、
    // Shift クリックでは動かない（確定事項15〜17）。
    anchor: null,
  };

  let el = null;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function isPagesMode() {
    return el !== null && el.doc.documentElement.getAttribute('data-mode') === 'pages';
  }

  function pageCount() {
    return viewer()?.getState().pageCount ?? 0;
  }

  function getSelection() {
    return [...state.selection];
  }

  function getAnchor() {
    return state.anchor;
  }

  function thumbNodes() {
    return el === null ? [] : [...el.doc.querySelectorAll('#thumbs .thumb')];
  }

  // 選択の印を付け直す。枠は幅・列数・編集のたびに作り直されるので、
  // thumbnails.js が組み立てた直後にここが呼ばれる。
  //
  // 削除で紙が減っていることもある。実際にある枚数へ選択を丸めるのも
  // ここでやる（消えた紙を選んだままにしない）。
  function syncMarks() {
    if (el === null)
      return false;

    const count = pageCount();
    const kept = state.selection.filter((index) => index < count);
    if (kept.length !== state.selection.length)
      state.selection = kept;

    const chosen = new Set(state.selection);
    // 現在ページの .current とは別に持つ。両方付くことがある（確定事項22）。
    thumbNodes().forEach((node, index) => node.classList.toggle('selected', chosen.has(index)));
    return true;
  }

  function setSelection(indices, { anchor } = {}) {
    state.selection = pagePlan().normalizeIndices(indices, pageCount());
    if (anchor !== undefined)
      state.anchor = anchor;
    // 範囲外へ出た起点は捨てる。残っていると Shift クリックが飛ぶ。
    if (!Number.isInteger(state.anchor) || state.anchor >= pageCount())
      state.anchor = state.selection[0] ?? null;
    syncMarks();
    return getSelection();
  }

  function clearSelection() {
    return setSelection([], { anchor: null });
  }

  function selectAll() {
    return setSelection(pagePlan().selectAll(pageCount()), { anchor: 0 });
  }

  // thumbnails.js のクリックから呼ばれる。ページモードで受け取ったら true を
  // 返し、閲覧モードでは false を返して従来のページ移動へ譲る。
  function handleClick(index, event) {
    if (!isPagesMode())
      return false;

    const next = pagePlan().resolveClick({
      selection: state.selection,
      anchor: state.anchor,
      index,
      ctrl: event?.ctrlKey === true,
      shift: event?.shiftKey === true,
    });
    setSelection(next.selection, { anchor: next.anchor });

    // 選択が1枚になったらページビューをそこへ寄せる（確定事項21）。
    // 複数選んでいる間は動かさない。読んでいる場所が飛ぶのを避ける。
    if (state.selection.length === 1)
      viewer()?.goToPage(state.selection[0]);
    return true;
  }

  // タブごとに持つ（確定事項11・14）。viewer の detach()／attach() に
  // 相乗りする。find.js の capture()／restore() と同じ作法である。
  function capture() {
    return { selection: [...state.selection], anchor: state.anchor };
  }

  function restore(session) {
    state.selection = [...(session?.selection ?? [])];
    state.anchor = session?.anchor ?? null;
    syncMarks();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkPageGridReady === true)
      return false;
    win.__sigkPageGridReady = true;

    el = { doc };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageGrid = {
    init,
    handleClick,
    getSelection,
    getAnchor,
    setSelection,
    clearSelection,
    selectAll,
    syncMarks,
    capture,
    restore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
