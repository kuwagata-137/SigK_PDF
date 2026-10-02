(function (root) {
  'use strict';

  // テキストの書式（文字の大きさ）を選んでいるテキストに当てるか、次に置く値として覚える指揮（spec-4-2 確定事項2・21・34、
  // spec-4b-3a 確定事項I5・J）。annotate-text.js から移した（spec-4b-4a。中身は変えていない）。

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  // 選んでいる書き込みを patch で直して 1 世代積み、選び直す。読み込んだものは写しに変わり、選択は写しへ移す。
  // gesture は欄の名前（同じ欄を続けて変えたら 1 世代に畳む。spec-4b-3a 確定事項J）。
  function updateSelected(entry, patch, gesture) {
    const annots = viewer().getAnnotations();
    const next = root.SigK.annotationState.updateAnnot(annots, entry, patch);
    if (next === annots)
      return false;
    const before = annotate().getSelected();
    const after = entry.ref !== undefined ? next.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after }, gesture });
    annotate().select(after);
    return true;
  }

  // 選んでいるテキストがあればその書き込みを変え、次に置く大きさとしても覚える。
  function setFontSize(size) {
    // 2 件以上を選んでいる間は文字の大きさの行を隠す（spec-4b-3a 確定事項I5）。
    if (annotate().getSelection().length > 1)
      return false;
    if (!root.SigK.annotationPresets.isFontSize(size))
      return false;
    const entry = annotate().selectedEntry();
    if (entry !== null && entry.kind === 'text' && entry.fontSize !== size) {
      const origin = geometry().frameOrigin(entry.rect, entry.rotation);
      const box = root.SigK.annotateText.boxOf(entry.text, size);
      updateSelected(entry, { fontSize: size, ...root.SigK.freeTextLayout.frameOf(origin, box, entry.rotation) }, 'fontSize');
    }
    annotate().rememberFontSize(size);
    root.SigK.annotationProps?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTextStyle = { setFontSize };
})(typeof window !== 'undefined' ? window : globalThis);
