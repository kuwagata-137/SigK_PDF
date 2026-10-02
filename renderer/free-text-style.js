(function (root) {
  'use strict';

  // テキストの書式の欄（spec-4b-4a 確定事項A・G3〜G5）。テキストについての欄の値の当て方を持つ。1 件でも複数でも同じ形で、
  // annotation-style-patch.js の appliesTo・patchFor が、テキストのこれらの欄をここへ回す。
  //
  //   fontSize     … 文字の大きさ。箱は中身の左上（文字の位置）を保ったまま組み直す。固定の幅は保ち、1 字を下回れば 1 字にする
  //                  （確定事項B5・C4）
  //   bold・italic … 太字・斜体（true か false）
  //   fill         … 塗り（'#rrggbb' か null）
  //   border       … 枠線の色（'#rrggbb' か null）。付けるときの太さは今の太さか、次に付ける太さ
  //   lineWidth    … 枠線の太さ（枠線があるときだけ。右パネルの太さの行は図形の線とテキストの枠線の両方に当たる。確定事項G5）
  // 太字・斜体・塗り・枠線を今までの形に付けると、新しい書式で測った最長の段落の幅で固定の幅の新しい形に移す（行の並びは
  // 変わらない。確定事項A2）。余白（飾りの有無・枠線の太さ）と斜体の分が変わっても、文字の位置は動かさない（確定事項B5）。

  const FLAGS = Object.freeze(['bold', 'italic']);
  const FIELDS = Object.freeze(['fontSize', ...FLAGS, 'fill', 'border', 'lineWidth']);

  function metrics() {
    return root.SigK.freeTextMetrics;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  function isText(entry) {
    return entry?.kind === 'text';
  }

  function isColorOrNone(value) {
    return value === null || root.SigK.shapeStyle.isHexColor(value);
  }

  // 当てられるか。表示のみには当てない。
  function appliesTo(field, entry, value) {
    if (!FIELDS.includes(field) || !isText(entry) || entry.readonly === true)
      return false;
    if (field === 'fontSize')
      return presets().isFontSize(value);
    if (field === 'fill' || field === 'border')
      return isColorOrNone(value);
    if (field === 'lineWidth')
      return (entry.borderColor ?? null) !== null && presets().isLineWidth(value);
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

  // 書式（太字・斜体・塗り・枠線）を変える patch（今までの形は新しい形へ移し、箱も組み直す）。
  function stylePatch(entry, patch) {
    const next = entry.width === undefined ? { ...patch, width: fixedWidthOf({ ...entry, ...patch }) } : patch;
    return { ...next, ...metrics().reframe(entry, next) };
  }

  // 枠線を付ける・外す・色を変える patch の書式の部分。付けるときの太さは今の太さか、次に付ける太さ。
  function borderFields(entry, color) {
    if (color === null)
      return { borderColor: null };
    const width = entry.borderWidth ?? root.SigK.annotateTextStyle?.getNextStyle().borderWidth ?? 1;
    return { borderColor: color, borderWidth: width };
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    switch (field) {
      case 'fontSize': return entry.fontSize === value ? null : fontSizePatch(entry, value);
      case 'fill': return (entry.fill ?? null) === value ? null : stylePatch(entry, { fill: value });
      case 'border': return (entry.borderColor ?? null) === value ? null : stylePatch(entry, borderFields(entry, value));
      case 'lineWidth': return entry.borderWidth === value ? null : stylePatch(entry, { borderWidth: value });
      default: return (entry[field] === true) === value ? null : stylePatch(entry, { [field]: value });
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextStyle = { FLAGS, FIELDS, appliesTo, patchFor, fixedWidthOf };
})(typeof window !== 'undefined' ? window : globalThis);
