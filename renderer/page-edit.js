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

  // 押せなくする操作の一覧。抽出と挿入は枠だけ置いてあり、結線は塊⑤ である
  // （決定1。どちらもファイルを書く操作で、書き出し経路がまだ無い）。
  const ACTION_IDS = {
    rotateLeft: 'act-rotate-left',
    rotateRight: 'act-rotate-right',
    remove: 'act-delete',
    undo: 'btn-undo',
    redo: 'btn-redo',
  };

  let el = null;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function pageHistory() {
    return root.SigK.pageHistory;
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
    state.history = pageHistory().createHistory(plan ?? []);
    return state.history;
  }

  function history() {
    if (state.history === null)
      reset(viewer()?.getPlan() ?? []);
    return state.history;
  }

  function canUndo() {
    return isOpen() && pageHistory().canUndo(history());
  }

  function canRedo() {
    return isOpen() && pageHistory().canRedo(history());
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

    state.history = pageHistory().pushHistory(history(), plan, { before, after });
    viewer().applyPlan(plan);
    grid()?.setSelection(after);
    syncActions();
    return true;
  }

  function step(direction) {
    if (!isOpen())
      return false;

    const moved = direction < 0 ? pageHistory().undo(history()) : pageHistory().redo(history());
    if (!moved.changed)
      return false;

    state.history = moved.history;
    viewer().applyPlan(moved.plan);
    // 戻した世代で操作の対象だったページを選び直す。何が戻ったのかが
    // 分からないと、取り消せたのかどうかも分からない。
    grid()?.setSelection(moved.selection);
    syncActions();
    return true;
  }

  function undo() {
    return step(-1);
  }

  function redo() {
    return step(1);
  }

  // ---- 操作（確定事項38・40〜42） ----

  // 何に対して掛けるか。選択中のページすべて、選択が無ければ現在のページ
  // （確定事項38）。閲覧モードから回転を押したときにも意味が通る。
  function targetIndices(explicit) {
    if (Array.isArray(explicit) && explicit.length > 0)
      return explicit;
    const selected = grid()?.getSelection() ?? [];
    if (selected.length > 0)
      return selected;
    const current = viewer()?.getState().current ?? 0;
    return [current];
  }

  function rotate(delta, explicit) {
    if (!isOpen())
      return false;
    const indices = targetIndices(explicit);
    const next = pagePlan().rotatePages(viewer().getPlan(), indices, delta);
    // 回した紙はそのまま選ばれ続ける。続けてもう90度回せる。
    return commit(next, { before: indices, after: indices });
  }

  // 削除には確認を出さない（確定事項40）。docs/04 第7章がそう定めているが、
  // **その根拠は「Ctrl+Z で戻せる」ことである**。だから undo を落とすなら
  // 確認を出す側へ倒すこと。
  function remove(explicit) {
    if (!isOpen())
      return false;
    const indices = targetIndices(explicit);
    const current = viewer().getPlan();
    // 最後の1ページは消せない（確定事項41）。pdf-lib の save() が既定で
    // 白紙 A4 を生やす件を、そもそも起こさない。
    if (!pagePlan().canDelete(current, indices))
      return false;

    const result = pagePlan().deletePages(current, indices);
    return commit(result.plan, { before: indices, after: result.selection });
  }

  function canDelete() {
    if (!isOpen())
      return false;
    return pagePlan().canDelete(viewer().getPlan(), targetIndices());
  }

  // ---- 画面の結線（確定事項50・51・53） ----

  function setEnabled(id, enabled) {
    const node = el?.doc.getElementById(id);
    if (node === null || node === undefined)
      return;
    if (enabled)
      node.removeAttribute('aria-disabled');
    else
      node.setAttribute('aria-disabled', 'true');
  }

  // 押せる・押せないを実態に合わせる。選択が変わるたび、編集するたび、
  // タブが移るたびに呼ばれる。
  function syncActions() {
    if (el === null)
      return false;
    const open = isOpen();
    setEnabled(ACTION_IDS.rotateLeft, open);
    setEnabled(ACTION_IDS.rotateRight, open);
    setEnabled(ACTION_IDS.remove, canDelete());
    setEnabled(ACTION_IDS.undo, canUndo());
    setEnabled(ACTION_IDS.redo, canRedo());
    return true;
  }

  function bindClick(doc, id, handler) {
    const node = doc.getElementById(id);
    if (node === null)
      return;
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') === 'true')
        return;
      handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkPageEditReady === true)
      return false;
    win.__sigkPageEditReady = true;

    el = { doc };

    bindClick(doc, ACTION_IDS.rotateLeft, () => rotate(-90));
    bindClick(doc, ACTION_IDS.rotateRight, () => rotate(90));
    bindClick(doc, ACTION_IDS.remove, () => remove());
    bindClick(doc, ACTION_IDS.undo, () => undo());
    bindClick(doc, ACTION_IDS.redo, () => redo());
    syncActions();
    return true;
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
    ACTION_IDS,
    init,
    reset,
    commit,
    rotate,
    remove,
    canDelete,
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
