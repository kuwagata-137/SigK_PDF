(function (root) {
  'use strict';

  // 編集モードで「選んでいる書き込み」を持ち、選ぶ・当てる・消す（spec-4-1 確定事項6・7、spec-4-4 確定事項31、spec-4b-1b 確定事項8、
  // spec-4b-2 確定事項21、spec-4b-3a 確定事項A）。
  //
  // 選択は鍵の並び（選んだ順。最後が「主」）で持ち、並びの書き込みはいつも同じページにある（決定52 ②）。並びの操作そのものは
  // annotation-selection.js の純関数。getSelected() は 1 件のときだけその鍵を返す（つまみ・回転の行・Enter のように 1 件向けの
  // 経路は、複数を選んでいる間は自然に止まる）。複数を扱う経路は getSelection()・isSelected() を見る。

  const state = {
    keys: [],
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function selection() {
    return root.SigK.annotationSelection;
  }

  function props() {
    return root.SigK.annotationProps;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function entryOf(key) {
    if (!isOpen() || typeof key !== 'string')
      return null;
    return annotationState().findAnnot(viewer().getAnnotations(), viewer().getImported(), key);
  }

  // 書き込みのページ（元の文書のページ番号）。引けなければ null。
  function pageOf(key) {
    return entryOf(key)?.src ?? null;
  }

  // 引けない鍵（消された・取り消しで無くなった）を落とし、主と同じページのものだけを残す（確定事項A2・A3）。
  function normalize(keys) {
    const live = selection().unique(keys).filter((key) => entryOf(key) !== null);
    const page = live.length === 0 ? null : pageOf(live.at(-1));
    return live.filter((key) => pageOf(key) === page);
  }

  // 読むたびに、引けなくなった鍵を落とす。
  function getSelection() {
    const live = normalize(state.keys);
    if (live.length !== state.keys.length)
      state.keys = live;
    return [...live];
  }

  // 1 件のときだけその鍵。0 件・2 件以上なら null（確定事項A4）。
  function getSelected() {
    const keys = getSelection();
    return keys.length === 1 ? keys[0] : null;
  }

  function primaryKey() {
    return getSelection().at(-1) ?? null;
  }

  function primaryEntry() {
    return entryOf(primaryKey());
  }

  // 1 件のときだけその書き込み（今までの約束）。
  function selectedEntry() {
    return entryOf(getSelected());
  }

  function selectedEntries() {
    return getSelection().map(entryOf);
  }

  function isSelected(key) {
    return getSelection().includes(key);
  }

  // 選択を替える。スライダーの下見とつまみのドラッグは捨てる（spec-4b-1b 確定事項8、spec-4b-2 確定事項21）。一覧の行も揃える
  // （spec-4-4 確定事項31）。
  function selectKeys(keys) {
    root.SigK.annotateTransform?.cancel();
    root.SigK.annotatePreview?.cancel();
    state.keys = normalize(Array.isArray(keys) ? keys : []);
    viewer()?.redrawAnnotations();
    props()?.refresh();
    root.SigK.annotationList?.syncSelected(getSelection());
    return getSelection();
  }

  // 1 件に替える（null で外す）。今までの約束どおり、選べた鍵（選べなければ null）を返す。
  function select(key) {
    selectKeys(key === null || key === undefined ? [] : [key]);
    return getSelected();
  }

  // Ctrl＋クリック（確定事項B3・K1）。選んでいれば外し、いなければ足す（主と別のページなら、その 1 件だけに替える）。
  function toggleKey(key) {
    const keys = getSelection();
    if (keys.includes(key))
      return selectKeys(selection().withoutKey(keys, key));
    return selectKeys(selection().onOnePage(keys, key, pageOf));
  }

  // まだ選んでいなければ足す（同じく別のページなら 1 件に替える）。選んでいれば何もしない。
  function addKey(key) {
    const keys = getSelection();
    if (keys.includes(key))
      return keys;
    return selectKeys(selection().onOnePage(keys, key, pageOf));
  }

  // 点（.pdf-page 基準の CSS px）に当たる注釈（annotation-hit.js。上に描いたものが優先）。
  function hitTest(index, point) {
    return root.SigK.annotationHit.hitTest(index, point);
  }

  // 選んでいる書き込みを全部消して 1 世代（確定事項H1）。
  function remove() {
    // つまみのドラッグ中なら先に取りやめる（spec-4b-2 確定事項21）。
    root.SigK.annotateTransform?.cancel();
    const keys = getSelection();
    if (keys.length === 0)
      return false;
    const view = viewer();
    const annots = root.SigK.annotationBulk.removeEach(view.getAnnotations(), view.getImported(), keys);
    state.keys = [];
    root.SigK.pageEdit.commitAnnots(annots, { annot: { before: selection().annotKeys(keys), after: null } });
    props()?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateSelect = {
    getSelection,
    getSelected,
    primaryKey,
    primaryEntry,
    selectedEntry,
    selectedEntries,
    isSelected,
    pageOf,
    select,
    selectKeys,
    toggleKey,
    addKey,
    hitTest,
    remove,
  };
})(typeof window !== 'undefined' ? window : globalThis);
