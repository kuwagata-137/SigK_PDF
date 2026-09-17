(function (root) {
  'use strict';

  // テキスト注釈の指揮（spec-4-2 確定事項3〜7・11〜12・15〜21）。
  //
  // 置く（place）・直す（beginEdit）・下書きを注釈にする（commitDraft）・動かす（move）・
  // 文字の大きさを変える（setFontSize）を、annotation-state.js の純粋な操作と
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

  // 本文と大きさから箱の大きさ（表示の向き・pt）。幅は画面のフォントで測る（確定事項14）。
  function boxOf(text, fontSize) {
    const lines = geometry().linesOf(text);
    return geometry().boxOfLines(lines, fontSize, (line) => root.SigK.freeTextShape.measure(state.doc, line, fontSize));
  }

  // 箱の四隅と四角。origin は表示の左上（紙の座標）。
  function frameOf(origin, size, rotation) {
    const rect = geometry().rectFromOrigin(origin, size, rotation);
    return { rect, quads: [geometry().quadOfRect(rect)] };
  }

  // 右端・下端をはみ出す箱は紙の中へ寄せる（起草者判断）。枠が無ければそのまま。
  function fitOrigin(origin, size, index) {
    const viewport = editor()?.pageOf(index)?.viewport;
    if (viewport === undefined || viewport === null)
      return origin;
    const scale = viewport.scale ?? 1;
    const [x, y] = viewport.convertToViewportPoint(origin[0], origin[1]);
    const fx = Math.max(0, Math.min(x, viewport.width - size.width * scale));
    const fy = Math.max(0, Math.min(y, viewport.height - size.height * scale));
    if (fx === x && fy === y)
      return origin;
    return viewport.convertToPdfPoint(fx, fy).map((value) => Math.round(value * 100) / 100);
  }

  // 履歴に積んで選び直す。読み込んだものを変えると写しが added の末尾に来る（確定事項16）。
  function commit(next, { before, target }) {
    const after = target === null ? next.added.at(-1).id : (target.ref !== undefined ? next.added.at(-1).id : before);
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

  // ---- 下書きを注釈にする（確定事項4・5・20） ----

  function commitNew(draft, text) {
    const size = boxOf(text, draft.fontSize);
    const origin = fitOrigin(draft.origin, size, draft.index);
    const next = annotationState().addAnnot(viewer().getAnnotations(), {
      id: annotationState().newId(),
      src: draft.src,
      kind: 'text',
      color: draft.color,
      opacity: 1,
      text,
      fontSize: draft.fontSize,
      rotation: draft.rotation,
      ...frameOf(origin, size, draft.rotation),
    });
    return commit(next, { before: null, target: null });
  }

  function commitExisting(draft, current, text) {
    const annots = viewer().getAnnotations();
    if (text === '') {
      root.SigK.pageEdit.commitAnnots(annotationState().removeAnnot(annots, current), { annot: { before: draft.key, after: null } });
      annotate().select(null);
      return true;
    }
    if (text === current.text && draft.fontSize === current.fontSize && draft.color === current.color) {
      viewer().redrawAnnotations();
      return false;
    }
    const next = annotationState().updateAnnot(annots, current, {
      text, fontSize: draft.fontSize, color: draft.color, ...frameOf(draft.origin, boxOf(text, draft.fontSize), draft.rotation),
    });
    return commit(next, { before: draft.key, target: current });
  }

  // 入力欄を閉じたとき（free-text-editor.finish）。空なら作らず、既存を空にしたら消す。
  // 変わっていなければ履歴に積まない。戻り値は履歴に積んだかどうか。
  function commitDraft(draft) {
    const view = viewer();
    if (view === undefined || !isOpen()) {
      view?.redrawAnnotations();
      return false;
    }
    const text = geometry().linesOf(draft.text).join('\n').replace(/\s+$/, '');
    if (draft.entry === null) {
      if (text.trim() === '') {
        view.redrawAnnotations();
        return false;
      }
      return commitNew(draft, text);
    }
    const current = findEntry(draft.key);
    if (current === null) {
      view.redrawAnnotations();
      return false;
    }
    return commitExisting(draft, current, text.trim() === '' ? '' : text);
  }

  // ---- 動かす（確定事項6） ----

  // delta は紙の座標での差分（pt）。箱の大きさは本文から取り直す（読み込んだ /Rect の余白を引きずらない）。
  function move(key, delta) {
    if (!isOpen() || !Array.isArray(delta) || !delta.every(Number.isFinite))
      return false;
    const entry = findEntry(key);
    if (entry === null || entry.kind !== 'text')
      return false;
    const [x, y] = geometry().frameOrigin(entry.rect, entry.rotation);
    const origin = [x + delta[0], y + delta[1]].map((value) => Math.round(value * 100) / 100);
    const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, frameOf(origin, boxOf(entry.text, entry.fontSize), entry.rotation));
    return commit(next, { before: key, target: entry });
  }

  // ---- 文字の大きさ（確定事項2・21・34） ----

  // 選んでいるテキストがあればその注釈を変え、次に置く大きさとしても覚える。
  function setFontSize(size) {
    if (!root.SigK.annotationPresets.isFontSize(size))
      return false;
    const entry = annotate().selectedEntry();
    if (entry !== null && entry.kind === 'text' && entry.fontSize !== size) {
      const origin = geometry().frameOrigin(entry.rect, entry.rotation);
      const next = annotationState().updateAnnot(viewer().getAnnotations(), entry, {
        fontSize: size, ...frameOf(origin, boxOf(entry.text, size), entry.rotation),
      });
      commit(next, { before: annotate().getSelected(), target: entry });
    }
    annotate().rememberFontSize(size);
    root.SigK.annotationProps?.refresh();
    return true;
  }

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
  SigK.annotateText = { init, place, beginEdit, editSelected, commitDraft, move, setFontSize, finishEditing, boxOf };
})(typeof window !== 'undefined' ? window : globalThis);
