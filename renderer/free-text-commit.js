(function (root) {
  'use strict';

  // 入力欄の下書きをテキストの書き込みにする（spec-4-2 確定事項4・5・20）。annotate-text.js から移した（spec-4b-4a。中身は
  // 変えていない）。空なら作らず、既存を空にしたら消し、変わっていなければ履歴に積まない。

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function text() {
    return root.SigK.annotateText;
  }

  function metrics() {
    return root.SigK.freeTextMetrics;
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  function findEntry(key) {
    const view = viewer();
    return annotationState().findAnnot(view.getAnnotations(), view.getImported(), key);
  }

  // 履歴に積んで選び直す。読み込んだものを変えると写しが added の末尾に来る（spec-4-2 確定事項16）。
  function commit(next, { before, target }) {
    const after = target === null ? next.added.at(-1).id : (target.ref !== undefined ? next.added.at(-1).id : before);
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after } });
    annotate().select(after);
    return true;
  }

  function commitNew(draft, body) {
    const entry = {
      src: draft.src,
      kind: 'text',
      color: draft.color,
      // 道具の「次に付ける不透明度」（spec-4b-1a 確定事項31。今までは 1 に固定していた）。
      opacity: annotate().getOpacity('text'),
      text: body,
      fontSize: draft.fontSize,
      rotation: draft.rotation,
      ...root.SigK.freeTextEntry.copyFields(draft, {}),
    };
    const size = metrics().sizeOf(entry);
    const origin = text().fitOrigin(draft.origin, size, draft.index);
    const next = annotationState().addAnnot(viewer().getAnnotations(), {
      id: annotationState().newId(),
      ...entry,
      ...root.SigK.freeTextLayout.frameOf(origin, size, draft.rotation),
    });
    return commit(next, { before: null, target: null });
  }

  function commitExisting(draft, current, body) {
    const annots = viewer().getAnnotations();
    if (body === '') {
      root.SigK.pageEdit.commitAnnots(annotationState().removeAnnot(annots, current), { annot: { before: draft.key, after: null } });
      annotate().select(null);
      return true;
    }
    if (body === current.text && draft.fontSize === current.fontSize && draft.color === current.color) {
      viewer().redrawAnnotations();
      return false;
    }
    const changed = { text: body, fontSize: draft.fontSize, color: draft.color };
    const next = annotationState().updateAnnot(annots, current, {
      ...changed,
      ...root.SigK.freeTextLayout.frameOf(draft.origin, metrics().sizeOf({ ...current, ...changed }), draft.rotation),
    });
    return commit(next, { before: draft.key, target: current });
  }

  // 入力欄を閉じたとき（free-text-editor.finish）。戻り値は履歴に積んだかどうか。
  function commitDraft(draft) {
    const view = viewer();
    if (view === undefined || !isOpen()) {
      view?.redrawAnnotations();
      return false;
    }
    const body = root.SigK.freeTextGeometry.linesOf(draft.text).join('\n').replace(/\s+$/, '');
    if (draft.entry === null) {
      if (body.trim() === '') {
        view.redrawAnnotations();
        return false;
      }
      return commitNew(draft, body);
    }
    const current = findEntry(draft.key);
    if (current === null) {
      view.redrawAnnotations();
      return false;
    }
    return commitExisting(draft, current, body.trim() === '' ? '' : body);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextCommit = { commitDraft };
})(typeof window !== 'undefined' ? window : globalThis);
