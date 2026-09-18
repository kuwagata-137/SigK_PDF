(function (root) {
  'use strict';

  // ノート注釈の指揮（spec-4-4 確定事項2・4・7・10・14・15・18・39）。
  //
  // 置く（place）・動かす（move）・本文を変える（setContents）・「本文」欄を開く（beginEdit／editSelected）・
  // 作成者（getAuthor／setAuthor／applyAuthor）を、annotation-state.js の純粋な操作と
  // page-edit.commitAnnots（1 本の履歴）に結ぶ。付箋の幾何は note-graphics.js、押し離しの振り分けは
  // annotate-pointer.js、道具と選択は annotate.js、「本文」欄そのものは annotation-props.js が持つ。

  // 作成者の長さの上限（settings.js の ANNOT_AUTHOR_MAX と同じ。プロセスが違うので import できない）。
  const AUTHOR_MAX = 100;

  const state = { doc: null, author: '' };

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function graphics() {
    return root.SigK.noteGraphics;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function findEntry(key) {
    const view = viewer();
    return annotationState().findAnnot(view.getAnnotations(), view.getImported(), key);
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 履歴に積んで選び直す。読み込んだものを変えると写しが added の末尾に来る（annotate-text.js と同じ）。
  function commit(next, { before, target }) {
    const after = target === null ? next.added.at(-1).id : (target.ref !== undefined ? next.added.at(-1).id : before);
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after } });
    annotate().select(after);
    return true;
  }

  // 基準の点（紙の左上）から箱と四角（確定事項10）。
  function frameOf(anchor) {
    const rect = graphics().rectFromAnchor(anchor);
    return { rect, quads: [graphics().quadOfRect(rect)] };
  }

  // 押した点を中心にした画面の箱の左上（CSS px）。紙の端をはみ出す分は中へ寄せる。
  function fitBox(point, viewport) {
    const size = graphics().ICON_PX;
    return [
      Math.max(0, Math.min(point[0] - size / 2, viewport.width - size)),
      Math.max(0, Math.min(point[1] - size / 2, viewport.height - size)),
    ];
  }

  // ---- 置く（確定事項2） ----

  // ノートの道具で紙を押して離した点（.pdf-page 基準の CSS px）に付箋を置き、選んで「本文」欄を開く。
  function place({ index, point }) {
    const viewport = viewportOf(index);
    const src = viewer()?.getPlan()[index]?.src;
    if (!isOpen() || viewport === null || !Number.isInteger(src))
      return false;
    const [x, y] = fitBox(point, viewport);
    const anchor = viewport.convertToPdfPoint(x, y).map(round);
    const next = annotationState().addAnnot(viewer().getAnnotations(), {
      id: annotationState().newId(),
      src,
      kind: 'note',
      color: annotate().colorOf('note'),
      opacity: root.SigK.annotateOpacity?.opacityOf('note') ?? 1,
      text: '',
      author: state.author,
      ...frameOf(anchor),
    });
    commit(next, { before: null, target: null });
    root.SigK.annotationProps?.focusContents();
    return true;
  }

  // ---- 動かす（確定事項14） ----

  // delta は紙の座標での差分（pt）。基準の点に足して箱を作り直す。
  function move(key, delta) {
    if (!isOpen() || !Array.isArray(delta) || delta.length !== 2 || !delta.every(Number.isFinite))
      return false;
    const entry = findEntry(key);
    if (entry === null || entry.kind !== 'note')
      return false;
    const [x, y] = graphics().anchorOf(entry);
    const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, frameOf([x + delta[0], y + delta[1]]));
    return commit(next, { before: key, target: entry });
  }

  // ---- 本文（確定事項4） ----

  // 「本文」欄の確定。変わっていなければ積まない。空でも残す。
  function setContents(text) {
    if (typeof text !== 'string' || !isOpen())
      return false;
    const entry = annotate().selectedEntry();
    if (entry === null || entry.kind !== 'note')
      return false;
    const normalized = text.replace(/\r\n?/g, '\n');
    if (normalized === entry.text)
      return false;
    const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, { text: normalized });
    return commit(next, { before: annotate().getSelected(), target: entry });
  }

  // ノートを選んで「本文」欄にフォーカスを移す（ダブルクリック・Enter）。
  function beginEdit(key) {
    if (!isOpen() || key === null || key === undefined)
      return false;
    const entry = findEntry(key);
    if (entry === null || entry.kind !== 'note')
      return false;
    annotate().select(key);
    return root.SigK.annotationProps?.focusContents() === true;
  }

  function editSelected() {
    return beginEdit(annotate().getSelected());
  }

  // ---- 作成者（確定事項39） ----

  function normalizeAuthor(author) {
    return author.trim().slice(0, AUTHOR_MAX);
  }

  function getAuthor() {
    return state.author;
  }

  // 起動時に settings.json（空なら OS のユーザー名で埋まったもの）から戻す。
  function applyAuthor(author) {
    if (typeof author === 'string')
      state.author = normalizeAuthor(author);
    root.SigK.annotationProps?.refresh();
    return state.author;
  }

  // 「作成者」欄から。覚え、空にしたら OS のユーザー名で埋め直された値を受け取る。
  function setAuthor(author) {
    if (typeof author !== 'string')
      return false;
    state.author = normalizeAuthor(author);
    const api = root.settingsAPI;
    if (api?.available === true) {
      Promise.resolve(api.setUi({ annotAuthor: state.author }))
        .then((result) => {
          if (result?.ok === true && typeof result.ui?.annotAuthor === 'string')
            applyAuthor(result.ui.annotAuthor);
        })
        .catch(() => {});
    }
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotateNoteReady === true)
      return false;
    win.__sigkAnnotateNoteReady = true;
    state.doc = doc;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateNote = { AUTHOR_MAX, init, place, move, setContents, beginEdit, editSelected, getAuthor, applyAuthor, setAuthor };
})(typeof window !== 'undefined' ? window : globalThis);
