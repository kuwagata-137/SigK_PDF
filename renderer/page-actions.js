(function (root) {
  'use strict';

  // ページ編集の操作（回転・削除）と、サイドパネルの操作列・元に戻す・やり直しのボタンの結線（spec-1-5 F・H 確定事項38・40〜42・
  // 50・51・53）。
  //
  // 300 行を超えた page-edit.js から移した（spec-4b-3a。中身は変えていない）。履歴に積む・戻すのは page-edit.js が持ち、
  // ここからは pageEdit.commit・undo・redo を呼ぶ。

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

  function viewer() {
    return root.SigK.viewer;
  }

  function grid() {
    return root.SigK.pageGrid;
  }

  function pageEdit() {
    return root.SigK.pageEdit;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
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
    return pageEdit().commit(next, { before: indices, after: indices });
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
    return pageEdit().commit(result.plan, { before: indices, after: result.selection });
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
    setEnabled(ACTION_IDS.undo, pageEdit().canUndo());
    setEnabled(ACTION_IDS.redo, pageEdit().canRedo());
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

  function init(doc) {
    el = { doc };

    bindClick(doc, ACTION_IDS.rotateLeft, () => rotate(-90));
    bindClick(doc, ACTION_IDS.rotateRight, () => rotate(90));
    bindClick(doc, ACTION_IDS.extract, () => root.SigK.extract?.run());
    bindClick(doc, ACTION_IDS.insert, () => root.SigK.insert?.run());
    bindClick(doc, ACTION_IDS.remove, () => remove());
    bindClick(doc, ACTION_IDS.undo, () => pageEdit().undo());
    bindClick(doc, ACTION_IDS.redo, () => pageEdit().redo());
    syncActions();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageActions = { ACTION_IDS, init, rotate, remove, canDelete, syncActions };
})(typeof window !== 'undefined' ? window : globalThis);
