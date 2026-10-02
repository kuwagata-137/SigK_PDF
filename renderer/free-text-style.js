(function (root) {
  'use strict';

  // テキストの書式の欄（spec-4b-4a 確定事項A・G3・G5）。テキストにだけある欄の値の当て方を持つ。1 件でも複数でも同じ形で、
  // annotation-style-patch.js の appliesTo・patchFor が、テキストだけの欄をここへ回す。
  //
  //   fontSize     … 文字の大きさ。箱は中身の左上（文字の位置）を保ったまま組み直す。固定の幅は保ち、1 字を下回れば 1 字にする
  //                  （確定事項B5・C4）
  //   bold・italic … 太字・斜体（true か false）。今までの形に付けると、新しい書式で測った最長の段落の幅で固定の幅の新しい形に
  //                  移す（行の並びは変わらない。確定事項A2）

  const FLAGS = Object.freeze(['bold', 'italic']);
  const FIELDS = Object.freeze(['fontSize', ...FLAGS]);

  function metrics() {
    return root.SigK.freeTextMetrics;
  }

  function isText(entry) {
    return entry?.kind === 'text';
  }

  // 当てられるか。表示のみには当てない。
  function appliesTo(field, entry, value) {
    if (!FIELDS.includes(field) || !isText(entry) || entry.readonly === true)
      return false;
    if (field === 'fontSize')
      return root.SigK.annotationPresets.isFontSize(value);
    return typeof value === 'boolean';
  }

  // 今までの形を新しい形へ移すときの固定の幅（pt）。next は当てた後の書式で、その書式で測った最長の段落の幅を 0.01pt に
  // 切り上げる（丸めで段落が折れないように）。下限は 1 字。
  function fixedWidthOf(next) {
    const advance = metrics().advanceFor(next);
    const wrap = root.SigK.freeTextWrap;
    const widthOf = (line) => wrap.widthOf(line, (unit) => advance(unit) * next.fontSize);
    const longest = wrap.paragraphsOf(next.text).reduce((max, line) => Math.max(max, widthOf(line)), 0);
    return Math.max(next.fontSize, Math.ceil(longest * 100 - 1e-6) / 100);
  }

  // 文字の大きさを変える patch（箱も組み直す）。
  function fontSizePatch(entry, fontSize) {
    const patch = { fontSize };
    if (typeof entry.width === 'number' && entry.width < fontSize)
      patch.width = fontSize;
    return { ...patch, ...metrics().reframe(entry, patch) };
  }

  // 太字・斜体を付け外しする patch（箱も組み直す）。
  function flagPatch(entry, field, value) {
    const patch = { [field]: value };
    if (entry.width === undefined)
      patch.width = fixedWidthOf({ ...entry, ...patch });
    return { ...patch, ...metrics().reframe(entry, patch) };
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    if (field === 'fontSize')
      return entry.fontSize === value ? null : fontSizePatch(entry, value);
    return (entry[field] === true) === value ? null : flagPatch(entry, field, value);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextStyle = { FLAGS, FIELDS, appliesTo, patchFor, fixedWidthOf };
})(typeof window !== 'undefined' ? window : globalThis);
