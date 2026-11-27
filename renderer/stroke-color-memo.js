(function (root) {
  'use strict';

  // 枠線を「なし」にした書き込みの、なしにする前の線の色（docs/spec-7-10-shape-tools.md。決定102 ④・質問 SH5 案A）。
  //
  // 「なし」にすると線の色は null になり（保存では /C を書かない）、元の色は書き込みに残らない。「あり」に戻す時に元の色を当てるため、
  // なしにした後の書き込みの鍵（自前の id。読み込んだものは、なしにした時に作った写しの id）ごとに、元の色を記憶する。記憶はアプリを
  // 開いている間だけで、PDF にも settings.json にも書かない。線種・線の太さ・透明度は、なしの間も書き込みに残るので記憶しない。
  // 記憶が無い書き込み（なしのまま保存した PDF を開き直した時など）には、その種類の次に付ける線の色を当てる（annotate-next-style.js）。

  const memo = new Map();

  function keyOf(entry) {
    return typeof entry?.ref === 'string' ? entry.ref : entry?.id ?? null;
  }

  // key はなしにした後の書き込みの鍵、color はなしにする前の線の色。
  function remember(key, color) {
    if (typeof key !== 'string' || typeof color !== 'string')
      return false;
    memo.set(key, color);
    return true;
  }

  // 「あり」に戻す時に当てる線の色。
  function colorOf(entry) {
    const kept = memo.get(keyOf(entry));
    if (kept !== undefined)
      return kept;
    return root.SigK.annotateNextStyle.colorOf(root.SigK.annotationPresets.kindOf(entry));
  }

  function reset() {
    memo.clear();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.strokeColorMemo = { keyOf, remember, colorOf, reset };
})(typeof window !== 'undefined' ? window : globalThis);
