(function (root) {
  'use strict';

  // ページ編集の適用層（spec-1-5 B・F・H）。
  //
  // plan を変える経路をここ1本に集める。並べ替え（page-grid.js のドラッグ）も
  // 回転も削除も、最後は commit() を通る。そうしておくと「編集したときに
  // やること」――履歴に積む・画面へ配る・選択を付け替える・未保存の印を出す――
  // を1か所に書けば済む。
  //
  // 履歴は { plan, annots } のスナップショット列で持つ（確定事項8・spec-4-1 確定事項15）。
  // 逆操作を書かないので、操作の種類が増えても undo の実装は増えない。注釈の
  // 編集（annotate.js）も同じ履歴に積む。Ctrl+Z はモードを問わず最後の編集を戻す。

  const state = {
    // { stack, at }。文書ごとに作り直し、タブごとに持ち回る（確定事項11）。
    history: null,
  };

  // 押せなくする操作の一覧。
  //
  // 抽出と挿入の中身は extract.js・insert.js が持ち、この層の仕事は
  // **押せる・押せないだけ**である。サイドパネルの操作列の状態を1か所に
  // まとめたいので、押したときの呼び出しもここから行う。
  const ACTION_IDS = {
    rotateLeft: 'act-rotate-left',
    rotateRight: 'act-rotate-right',
    extract: 'act-extract',
    insert: 'act-insert',
    remove: 'act-delete',
    undo: 'btn-undo',
    redo: 'btn-redo',
  };

  let el = null;

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

    state.history = editHistory().pushHistory(history(), snapshot(plan), { before, after });
    viewer().applyPlan(plan);
    grid()?.setSelection(after);
    syncActions();
    return true;
  }

  // 注釈の編集を1世代として確定する（spec-4-1 確定事項15）。plan はいまのまま。
  // annot は前後で対象だった注釈の id か ref で、戻したときに選び直すのに使う。
  function commitAnnots(annots, { annot = {} } = {}) {
    if (!isOpen())
      return false;

    state.history = editHistory().pushHistory(history(), snapshot(undefined, annots), { annot });
    viewer().setAnnotations(annots);
    syncActions();
    return true;
  }

  function step(direction) {
    if (!isOpen())
      return false;
    // 入力欄の外から Ctrl+Z が来たら、下書きを確定してから戻す（spec-4-2 確定事項8）。
    root.SigK.annotate?.finishEditing?.();

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
    annotate()?.select(moved.annot ?? null);
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
    setEnabled(ACTION_IDS.extract, root.SigK.extract?.canExtract() === true);
    setEnabled(ACTION_IDS.insert, root.SigK.insert?.canInsert() === true);
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
    bindClick(doc, ACTION_IDS.extract, () => root.SigK.extract?.run());
    bindClick(doc, ACTION_IDS.insert, () => root.SigK.insert?.run());
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
    commitAnnots,
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
