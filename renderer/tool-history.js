(function (root) {
  'use strict';

  // ツールモードの元に戻す・やり直す（spec-2-5 確定事項I6。PR-4 の起草者の判断 I-j）。
  //
  // 帯のページ編集の履歴（page-edit.js。映しているタブにしか効かない）と、✂ の盤の履歴（split-board-store.js。帯ごと）は別々にある。
  // ツールモードでしたこと（帯の並べ替え・写し・盤の ✂ と印）を、した順に 1 本の記録に控え、Ctrl+Z・Ctrl+Y とツールバーの［元に戻す］
  // ［やり直し］は、この記録の新しい方から、その帯の履歴を戻す・進める。戻しても枠（映しているタブ）は動かさない（tabs.withActive）。
  //
  // 1 回の操作で 2 つの履歴に積むとき（盤の箱の末尾に落とした並べ替えと ✂ の動き）は batch でまとめ、1 回で戻す（盤 → 並びの順）。
  // 戻せない記録（閉じた帯・保存して開き直した帯は、履歴が無いか作り直されている）は飛ばす。記録はツールモードを離れたら捨てる（ほかの
  // モードでした編集と順が混ざるため）。記録が空なら今どおり（分割なら盤、ほかは枠の帯のページ編集）。

  const state = { done: [], undone: [], batch: null };

  const tabs = () => root.SigK.tabs;
  const inTools = () => root.SigK.tools?.isToolsMode() === true;
  const splitting = () => inTools() && root.SigK.tools?.selected() === 'split';

  function changed() {
    root.SigK.pageEdit?.syncActions();
  }

  // kind は 'pages'（ページ編集の履歴）か 'board'（✂ の盤の履歴）。ツールモードの間だけ控える。
  function record(kind, tabId) {
    if (!inTools() || tabId === null || tabId === undefined)
      return false;
    const part = { kind, tabId };
    if (state.batch !== null) {
      state.batch.push(part);
      return true;
    }
    state.done.push({ parts: [part] });
    state.undone = [];
    changed();
    return true;
  }

  // fn の中で控えた記録を 1 つにまとめる。戻り値は fn の戻り値。
  function batch(fn) {
    if (state.batch !== null)
      return fn();
    state.batch = [];
    try {
      return fn();
    } finally {
      const parts = state.batch;
      state.batch = null;
      if (parts.length > 0) {
        state.done.push({ parts });
        state.undone = [];
        changed();
      }
    }
  }

  // 1 つの帯の 1 つの履歴を 1 つ戻す・進める。戻せたら true。
  function stepPart({ kind, tabId }, direction) {
    const view = tabs().peek(tabId);
    if (view === null || view.doc === undefined)
      return false;
    if (kind === 'board') {
      if (splitting() && root.SigK.splitStrip?.hostId() === tabId)
        return root.SigK.toolsSplitEdit[direction]() === true;
      return root.SigK.splitBoardStore.step(tabId, view, direction);
    }
    return tabs().withActive(tabId, () => root.SigK.pageEdit[direction]()) === true;
  }

  // 記録が空のときの相手（今どおり）。
  function fallback(direction) {
    const moved = splitting() ? root.SigK.toolsSplitEdit[direction]() === true : root.SigK.pageEdit[direction]() === true;
    changed();
    return moved;
  }

  function step(direction) {
    const from = direction === 'undo' ? state.done : state.undone;
    const to = direction === 'undo' ? state.undone : state.done;
    while (from.length > 0) {
      const entry = from.pop();
      const parts = direction === 'undo' ? [...entry.parts].reverse() : entry.parts;
      const moved = parts.map((part) => stepPart(part, direction)).some(Boolean);
      if (moved) {
        to.push(entry);
        changed();
        return true;
      }
    }
    return fallback(direction);
  }

  function canStep(direction) {
    const list = direction === 'undo' ? state.done : state.undone;
    if (list.length > 0)
      return true;
    const target = splitting() ? root.SigK.toolsSplitEdit : root.SigK.pageEdit;
    return (direction === 'undo' ? target?.canUndo() : target?.canRedo()) === true;
  }

  function clear() {
    state.done = [];
    state.undone = [];
    state.batch = null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolHistory = {
    record, batch, clear,
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: () => canStep('undo'),
    canRedo: () => canStep('redo'),
  };
})(typeof window !== 'undefined' ? window : globalThis);
