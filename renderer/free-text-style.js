(function (root) {
  'use strict';

  // テキストの書式の欄（spec-4b-4a 確定事項A・G5）。テキストにだけある欄の値の当て方を持つ。1 件でも複数でも同じ形で、
  // annotation-style-patch.js の appliesTo・patchFor が、テキストだけの欄をここへ回す。
  //
  //   fontSize … 文字の大きさ。箱は表示の左上を保ったまま、本文を測り直した大きさにする

  const FIELDS = Object.freeze(['fontSize']);

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function isText(entry) {
    return entry?.kind === 'text';
  }

  // 当てられるか。表示のみには当てない。
  function appliesTo(field, entry, value) {
    if (!FIELDS.includes(field) || !isText(entry) || entry.readonly === true)
      return false;
    return field !== 'fontSize' || root.SigK.annotationPresets.isFontSize(value);
  }

  // 箱を本文から作り直した形（表示の左上を保つ）。
  function reframed(entry, fontSize) {
    const origin = geometry().frameOrigin(entry.rect, entry.rotation);
    const box = root.SigK.annotateText.boxOf(entry.text, fontSize);
    return root.SigK.freeTextLayout.frameOf(origin, box, entry.rotation);
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    if (entry.fontSize === value)
      return null;
    return { fontSize: value, ...reframed(entry, value) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextStyle = { FIELDS, appliesTo, patchFor, reframed };
})(typeof window !== 'undefined' ? window : globalThis);
