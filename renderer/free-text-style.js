(function (root) {
  'use strict';

  // テキストの書式の欄（spec-4b-4a 確定事項A・G5）。テキストにだけある欄の値の当て方を持つ。1 件でも複数でも同じ形で、
  // annotation-style-patch.js の appliesTo・patchFor が、テキストだけの欄をここへ回す。
  //
  //   fontSize … 文字の大きさ。箱は中身の左上（文字の位置）を保ったまま組み直す。固定の幅は保ち、1 字を下回れば 1 字にする
  //              （確定事項B5・C4）

  const FIELDS = Object.freeze(['fontSize']);

  function isText(entry) {
    return entry?.kind === 'text';
  }

  // 当てられるか。表示のみには当てない。
  function appliesTo(field, entry, value) {
    if (!FIELDS.includes(field) || !isText(entry) || entry.readonly === true)
      return false;
    return field !== 'fontSize' || root.SigK.annotationPresets.isFontSize(value);
  }

  // 文字の大きさを変える patch（箱も組み直す）。
  function fontSizePatch(entry, fontSize) {
    const patch = { fontSize };
    if (typeof entry.width === 'number' && entry.width < fontSize)
      patch.width = fontSize;
    return { ...patch, ...root.SigK.freeTextMetrics.reframe(entry, patch) };
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    if (entry.fontSize === value)
      return null;
    return fontSizePatch(entry, value);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextStyle = { FIELDS, appliesTo, patchFor };
})(typeof window !== 'undefined' ? window : globalThis);
