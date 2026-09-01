(function (root) {
  'use strict';

  // ページ編集の適用層（spec-1-5 B・F・H）。
  //
  // plan を変える経路をここ1本に集める。並べ替え（page-grid.js のドラッグ）も
  // 回転も削除も、最後は commit() を通る。そうしておくと「編集したときに
  // やること」――履歴に積む・画面へ配る・選択を付け替える・未保存の印を出す――
  // を1か所に書けば済む。
  //
  // 履歴は plan のスナップショット列で持つ（確定事項8）。逆操作を書かないので、
  // 操作の種類が増えても undo の実装は増えない。

  const state = {
    // { stack, at }。文書ごとに作り直し、タブごとに持ち回る（確定事項11）。
    history: null,
  };

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function grid() {
    return root.SigK.pageGrid;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  // 文書を開いた時点の並びを1世代目に置く。開くたびに作り直すので、
  // 前の文書の履歴が残らない。
  function reset(plan) {
    state.history = pagePlan().createHistory(plan ?? []);
    return state.history;
  }

  function history() {
    if (state.history === null)
      reset(viewer()?.getPlan() ?? []);
    return state.history;
  }

  function canUndo() {
    return isOpen() && pagePlan().canUndo(history());
  }

  function canRedo() {
    return isOpen() && pagePlan().canRedo(history());
  }

  // 履歴の深さ。起動確認（SIGK_SMOKE_PAGES）が読む。
  function getHistoryState() {
    const current = history();
    return { depth: current.stack.length, at: current.at };
  }

  // 編集を1世代として確定する（確定事項13。1回のユーザー操作で1世代）。
  //
  // before は「この操作をする前の並びにおける対象の位置」、after は「した後の
  // 位置」である。戻したときに何が戻ったのかを選択で示すのに使う（確定事項12）。
  function commit(plan, { before = [], after = [] } = {}) {
    if (!isOpen())
      return false;

    state.history = pagePlan().pushHistory(history(), plan, { before, after });
    viewer().applyPlan(plan);
    grid()?.setSelection(after);
    return true;
  }

  function step(direction) {
    if (!isOpen())
      return false;

    const moved = direction < 0 ? pagePlan().undo(history()) : pagePlan().redo(history());
    if (!moved.changed)
      return false;

    state.history = moved.history;
    viewer().applyPlan(moved.plan);
    // 戻した世代で操作の対象だったページを選び直す。何が戻ったのかが
    // 分からないと、取り消せたのかどうかも分からない。
    grid()?.setSelection(moved.selection);
    return true;
  }

  function undo() {
    return step(-1);
  }

  function redo() {
    return step(1);
  }

  // ---- タブごとの持ち回り（確定事項11） ----

  function capture() {
    return { history: state.history };
  }

  function restore(session) {
    state.history = session?.history ?? null;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageEdit = {
    reset,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    getHistoryState,
    capture,
    restore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
