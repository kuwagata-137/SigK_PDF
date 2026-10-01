(function (root) {
  'use strict';

  // 2 件以上を選んでいるときの右パネル（spec-4b-3a 確定事項I。モック screenshots/phase4b-3-multi.png）。
  //
  // 見出しは「書き込み N 件（種類・種類）」、回転・文字の大きさ・本文・作成者・対象の文字は隠し、ページを出し、削除を押せるようにする。
  // annotation-props.js の refresh が、2 件以上のときにここへ回す。

  function styleRows() {
    return root.SigK.annotationStyleRows;
  }

  // 見出しの種類（描く順に、重なりを除いて「・」でつなぐ。表示のみは subtype の名前）。
  function kindsOf(entries) {
    const labels = entries.map((entry) => root.SigK.annotationIndex.labelOf(entry));
    return [...new Set(labels)].join('・');
  }

  function displayNumberOf(src) {
    const index = root.SigK.viewer?.getPlan().findIndex((page) => page.src === src) ?? -1;
    return index < 0 ? '' : String(index + 1);
  }

  function show(doc, id, visible) {
    const node = doc.getElementById(id);
    if (node !== null)
      node.hidden = !visible;
  }

  function render(doc, entries) {
    doc.getElementById('props-kind').textContent = `書き込み ${entries.length} 件（${kindsOf(entries)}）`;
    // 見た目の行は、1 件でも持てる欄を出し、そろっていない値は「混在」にする（確定事項I1）。
    styleRows()?.render(entries.map((entry) => root.SigK.annotationStylePatch.targetOf(entry)));
    root.SigK.annotationNoteRows?.render({ text: null, author: null, editable: false });
    root.SigK.annotationAngleRow?.render(null);
    show(doc, 'props-size-row', false);
    show(doc, 'props-text-row', false);
    show(doc, 'props-page-row', true);
    doc.getElementById('props-page').textContent = displayNumberOf(entries[0]?.src);
    doc.getElementById('props-hint').textContent = root.SigK.annotationHints.HINTS.multi;
    doc.getElementById('props-delete').removeAttribute('aria-disabled');
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationBulkProps = { kindsOf, render };
})(typeof window !== 'undefined' ? window : globalThis);
