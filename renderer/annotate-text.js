(function (root) {
  'use strict';

  // テキスト注釈の指揮（spec-4-2 確定事項3〜7・11〜12・15〜21）。
  //
  // 置く（place）・直す（beginEdit）・下書きを注釈にする（commitDraft）・動かす（move）を、annotation-state.js の純粋な操作と
  // page-edit.commitAnnots（1 本の履歴）に結ぶ。入力欄そのものは free-text-editor.js、
  // 押し離しの振り分けは annotate-pointer.js、道具と選択は annotate.js が持つ。

  const state = { doc: null };

  function annotate() {
    return root.SigK.annotate;
  }

  function editor() {
    return root.SigK.freeTextEditor;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function findEntry(key) {
    const view = viewer();
    return annotationState().findAnnot(view.getAnnotations(), view.getImported(), key);
  }

  function layout() {
    return root.SigK.freeTextLayout;
  }

  // 本文と大きさから箱の大きさ（表示の向き・pt）。幅は画面のフォントで測る（確定事項14）。組み立ては free-text-layout.js。
  function boxOf(text, fontSize) {
    return layout().boxOf(text, fontSize, (line) => root.SigK.freeTextShape.measure(state.doc, line, fontSize));
  }

  // 右端・下端をはみ出す箱は紙の中へ寄せる（起草者判断）。
  function fitOrigin(origin, size, index) {
    return layout().fitOrigin(origin, size, editor()?.pageOf(index)?.viewport);
  }

  // 履歴に積んで選び直す。読み込んだものを変えると写しが added の末尾に来る（確定事項16）。
  function commit(next, { before, target }) {
    const after = target.ref !== undefined ? next.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after } });
    annotate().select(after);
    return true;
  }

  // ---- 置く（確定事項3） ----

  // テキストの道具で紙を押して離した点（.pdf-page 基準の CSS px）に入力欄を出す。
  function place({ index, point }) {
    const page = editor()?.pageOf(index);
    const src = viewer()?.getPlan()[index]?.src;
    if (!isOpen() || page === null || page === undefined || !Number.isInteger(src))
      return false;
    annotate().select(null);
    const origin = page.viewport.convertToPdfPoint(point[0], point[1]).map((value) => Math.round(value * 100) / 100);
    editor().begin({
      key: null,
      entry: null,
      src,
      index,
      origin,
      text: '',
      fontSize: annotate().getFontSize(),
      color: annotate().colorOf('text'),
      rotation: page.viewport.rotation ?? 0,
    });
    return true;
  }

  // ---- 直す（確定事項5） ----

  function beginEdit(key) {
    if (!isOpen() || key === null || key === undefined)
      return false;
    const entry = findEntry(key);
    if (entry === null || entry.kind !== 'text')
      return false;
    const index = viewer().getPlan().findIndex((page) => page.src === entry.src);
    if (index < 0)
      return false;
    annotate().select(key);
    editor().begin({
      key,
      entry,
      src: entry.src,
      index,
      origin: geometry().frameOrigin(entry.rect, entry.rotation),
      text: entry.text,
      fontSize: entry.fontSize,
      color: entry.color,
      rotation: entry.rotation,
    });
    return true;
  }

  function editSelected() {
    return beginEdit(annotate().getSelected());
  }

  // ---- 下書きを注釈にする（確定事項4・5・20。free-text-commit.js） ----

  function commitDraft(draft) {
    return root.SigK.freeTextCommit.commitDraft(draft);
  }

  // ---- 動かす（確定事項6） ----

  // delta は紙の座標での差分（pt）。箱の大きさは本文から取り直す（読み込んだ /Rect の余白を引きずらない。値は annotation-moves.js が作る）。
  function move(key, delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const entry = findEntry(key);
    if (entry === null || entry.kind !== 'text')
      return false;
    const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, root.SigK.annotationMoves.movedPatch(entry, delta));
    return commit(next, { before: key, target: entry });
  }

  // 文字の大きさの変更は annotate-text-style.js（spec-4b-4a で移した）。

  // 開いている入力欄を確定して閉じる（保存・印刷・タブ切替・モード切替の前に呼ぶ。確定事項8）。
  function finishEditing() {
    if (editor()?.isEditing() !== true)
      return false;
    editor().finish();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotateTextReady === true)
      return false;
    win.__sigkAnnotateTextReady = true;
    state.doc = doc;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateText = { init, place, beginEdit, editSelected, commitDraft, move, finishEditing, boxOf, fitOrigin };
})(typeof window !== 'undefined' ? window : globalThis);
