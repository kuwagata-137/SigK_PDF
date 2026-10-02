(function (root) {
  'use strict';

  // テキストの書式（文字の大きさ）を選んでいるテキストに当てるか、次に置く値として覚える指揮（spec-4-2 確定事項2・21・34、
  // spec-4b-3a 確定事項J、spec-4b-4a 確定事項A3・G5）。当てる値は free-text-style.js が作る。2 件以上を選んでいれば、
  // annotate-bulk.js の applyField でテキストにだけまとめて当てる。

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
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

  // 選んでいるテキストがあればその書き込みを変え、次に置く大きさとしても覚える。2 件以上ならテキストにだけまとめて当てる。
  function setFontSize(size) {
    if (!root.SigK.annotationPresets.isFontSize(size))
      return false;
    if (annotate().getSelection().length > 1)
      return root.SigK.annotateBulk.applyField('fontSize', size);
    const entry = annotate().selectedEntry();
    const patch = root.SigK.freeTextStyle.patchFor('fontSize', size, entry);
    if (patch !== null)
      updateSelected(entry, patch, 'fontSize');
    annotate().rememberFontSize(size);
    root.SigK.annotationProps?.refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTextStyle = { setFontSize };
})(typeof window !== 'undefined' ? window : globalThis);
