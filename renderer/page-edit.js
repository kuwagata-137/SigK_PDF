(function (root) {
  'use strict';

  // ページ編集の適用層（spec-1-5 B・F・H）。
  //
  // plan を変える経路をここ1本に集める。並べ替え（page-grid.js のドラッグ）も回転も削除（page-actions.js）も、
  // 最後は commit() を通る。そうしておくと「編集したときにやること」――履歴に積む・画面へ配る・選択を付け替える・
  // 未保存の印を出す――を1か所に書けば済む。
  //
  // 履歴は { plan, annots } のスナップショット列で持つ（確定事項8・spec-4-1 確定事項15）。逆操作を書かないので、
  // 操作の種類が増えても undo の実装は増えない。注釈の編集（annotate.js）も同じ履歴に積む。Ctrl+Z はモードを問わず
  // 最後の編集を戻す。

  const state = {
    // { stack, at }。文書ごとに作り直し、タブごとに持ち回る（確定事項11）。
    history: null,
    // 続けて変えている欄 { field, keys（変えた後の鍵の並び）, at }。同じ選択・同じ欄が続いたら 1 世代に畳む（spec-4b-3a
    // 確定事項J）。取り消し・やり直し・開く・タブを替える・保存・ほかの操作の世代で忘れる。
    gesture: null,
  };

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function editHistory() {
    return root.SigK.editHistory;
  }

  function annotate() {
    return root.SigK.annotate;
  }

  // いまの編集の状態。履歴に積むスナップショットの元になる。
  function snapshot(plan = viewer()?.getPlan() ?? [], annots = viewer()?.getAnnotations() ?? null) {
    return { plan, annots };
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
  function reset(plan, annots) {
    state.gesture = null;
    state.history = editHistory().createHistory(snapshot(plan ?? [], annots ?? null));
    return state.history;
  }

  function history() {
    if (state.history === null)
      reset();
    return state.history;
  }

  function canUndo() {
    return isOpen() && editHistory().canUndo(history());
  }

  function canRedo() {
    return isOpen() && editHistory().canRedo(history());
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

    state.gesture = null;
    state.history = editHistory().pushHistory(history(), snapshot(plan), { before, after });
    viewer().applyPlan(plan);
    grid()?.setSelection(after);
    syncActions();
    return true;
  }

  // 注釈の編集を1世代として確定する（spec-4-1 確定事項15）。plan はいまのまま。
  // annot は前後で対象だった注釈の id か ref（複数なら配列）で、戻したときに選び直すのに使う。
  // gesture は見た目の欄の名前（color・fill・lineStyle・lineWidth・opacity・fontSize）。直前の世代と同じ欄を、そのときの
  // 変えた後の選択のまま続けて変えたなら、新しい世代を積まずに一番上の世代を差し替える（spec-4b-3a 確定事項J。
  // spec-1-5 確定事項13「1 回の操作で 1 世代」をこの場合に限って改める）。
  function commitAnnots(annots, { annot = {}, gesture = null } = {}) {
    if (!isOpen())
      return false;

    const recorded = editHistory().record(history(), snapshot(undefined, annots), { annot, gesture, last: state.gesture });
    state.history = recorded.history;
    state.gesture = recorded.gesture;
    viewer().setAnnotations(annots);
    syncActions();
    return true;
  }

  function step(direction) {
    if (!isOpen())
      return false;
    // 描いている途中の多角形があれば、それを捨てるだけで履歴は動かさない（spec-4b-5a 確定事項16）。
    if (root.SigK.annotate?.dropPendingShape?.() === true)
      return true;
    // 入力欄の外から Ctrl+Z が来たら、下書きを確定してから戻す（spec-4-2 確定事項8）。つまみのドラッグ中なら先に取りやめる
    // （spec-4b-2 確定事項21）。
    root.SigK.annotate?.finishEditing?.();
    // 押して引いている途中の操作（つまみ・範囲選択）も取りやめる（spec-4b-3a 確定事項L3）。
    root.SigK.annotate?.abortGestures?.();
    state.gesture = null;

    const moved = direction < 0 ? editHistory().undo(history()) : editHistory().redo(history());
    if (!moved.changed)
      return false;

    state.history = moved.history;
    // 並びが変わっていなければ枠を作り直さない（注釈だけの世代を戻したときに、
    // ページが描き直されてちらつくのを避ける）。
    if (!pagePlan().samePlan(moved.plan, viewer().getPlan()))
      viewer().applyPlan(moved.plan);
    viewer().setAnnotations(moved.annots);
    // 戻した世代で操作の対象だったページを選び直す。何が戻ったのかが
    // 分からないと、取り消せたのかどうかも分からない。注釈も同じ。
    grid()?.setSelection(moved.selection);
    // 複数を選んでいた世代なら、複数選択に戻す（spec-4b-3a 確定事項L2）。
    annotate()?.selectKeys(root.SigK.annotationSelection.keysOf(moved.annot ?? null));
    syncActions();
    return true;
  }

  function undo() {
    return step(-1);
  }

  function redo() {
    return step(1);
  }

  // ---- 操作と画面の結線（回転・削除・押せる/押せない。page-actions.js） ----

  function actions() {
    return root.SigK.pageActions;
  }

  function syncActions() {
    return actions()?.syncActions() === true;
  }

  function init(doc, win) {
    if (win.__sigkPageEditReady === true)
      return false;
    win.__sigkPageEditReady = true;
    actions().init(doc);
    return true;
  }

  // ---- タブごとの持ち回り（確定事項11） ----

  function capture() {
    return { history: state.history };
  }

  function restore(session) {
    state.gesture = null;
    state.history = session?.history ?? null;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageEdit = {
    ACTION_IDS: root.SigK.pageActions?.ACTION_IDS,
    // 続けて変えている欄の覚えを忘れる（保存のあと。spec-4b-3a 確定事項J4）。
    forgetGesture: () => { state.gesture = null; },
    init,
    reset,
    commit,
    commitAnnots,
    rotate: (delta, explicit) => actions().rotate(delta, explicit),
    remove: (explicit) => actions().remove(explicit),
    canDelete: () => actions().canDelete(),
    undo,
    redo,
    canUndo,
    canRedo,
    getHistoryState,
    syncActions,
    capture,
    restore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
