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

  // 次に置くテキストの太字・斜体・塗り・枠線（持つものだけ。spec-4b-4a 確定事項H）。key が 'callout' なら吹き出しの値
  // （spec-4b-4b 確定事項G4）。
  function nextFlags(key) {
    const { bold, italic, fill, border, borderWidth } = annotate().getTextStyle(key);
    return root.SigK.freeTextEntry.copyFields({ width: 'auto', bold, italic, fill, borderColor: border, borderWidth }, {});
  }

  // テキスト（callout なら吹き出し）の道具で紙を押して離した点（.pdf-page 基準の CSS px）に入力欄を出す。吹き出しは、打っている間
  // しっぽの先が本体の下に付いてくる（tipAuto。spec-4b-4b 確定事項D3）。
  function place({ index, point, callout = false }) {
    const page = editor()?.pageOf(index);
    const src = viewer()?.getPlan()[index]?.src;
    if (!isOpen() || page === null || page === undefined || !Number.isInteger(src))
      return false;
    annotate().select(null);
    const origin = page.viewport.convertToPdfPoint(point[0], point[1]).map((value) => Math.round(value * 100) / 100);
    const key = callout ? 'callout' : 'text';
    editor().begin({
      key: null,
      entry: null,
      src,
      index,
      origin,
      text: '',
      fontSize: root.SigK.annotateTextStyle?.fontSizeOf(key) ?? annotate().getFontSize(),
      color: annotate().colorOf(key),
      rotation: page.viewport.rotation ?? 0,
      // 新しく置くテキストは新しい形で、全角 12 字の自動の幅で折り返す（spec-4b-4a 確定事項C2・H2）。太字・斜体は次に付ける値。
      width: root.SigK.freeTextEntry.WIDTH_AUTO,
      ...nextFlags(key),
      ...(callout ? { callout: true, tipAuto: true } : {}),
    });
    return true;
  }

  // ---- 直す（確定事項5） ----

  // 回したテキストの下書きの欄（spec-4b-4b 確定事項D1）。angle と、入力欄を置く回した左上 paperOrigin（紙の座標）。回していなければ空。
  function turnedDraft(entry) {
    const angle = root.SigK.shapeRotation?.angleOf(entry) ?? 0;
    return angle === 0 ? {} : { angle, paperOrigin: root.SigK.freeTextTurn.originOnPaper(entry) };
  }

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
      ...root.SigK.freeTextEntry.copyFields(entry, {}),
      ...turnedDraft(entry),
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
  SigK.annotateText = { init, place, beginEdit, editSelected, commitDraft, move, finishEditing, fitOrigin };
})(typeof window !== 'undefined' ? window : globalThis);
