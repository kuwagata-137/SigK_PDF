(function (root) {
  'use strict';

  // 右パネルのスライダーと数値欄の組（spec-4b-1b 確定事項7・8）。線の太さ（1〜40pt）と不透明度（10〜100%）が使う。
  //
  // スライダーを動かしている間（input）は数値欄を追わせて onPreview、離したとき（change）と数値欄の確定（Enter か欄の外）で
  // onCommit を呼ぶ。数値欄は範囲の外を端へ、小数を四捨五入する（0 → 1、41 → 40、35.4 → 35）。読めなければ元の値へ戻す。
  // 窓が非活性だと blur が飛ばないので、Enter の側でも確定する。

  // 数値欄の値を範囲へ丸める。読めなければ null。
  function clampOf(text, min, max) {
    const trimmed = String(text).trim();
    const value = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(value))
      return null;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function bind(range, number, { min, max, onPreview, onCommit }) {
    range.addEventListener('input', () => {
      number.value = range.value;
      onPreview(Number(range.value));
    });
    range.addEventListener('change', () => onCommit(Number(range.value)));
    const commitNumber = () => {
      const value = clampOf(number.value, min, max);
      if (value === null) {
        number.value = range.value;
        return;
      }
      number.value = String(value);
      range.value = String(value);
      onCommit(value);
    };
    number.addEventListener('change', commitNumber);
    number.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commitNumber();
    });
  }

  // 値を見せる。数値欄に打っている途中なら数値欄は上書きしない（読み込んだ小数の太さは数値欄にそのまま出る）。
  function show(range, number, value) {
    range.value = String(value);
    if (number.ownerDocument.activeElement !== number)
      number.value = String(value);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.propsRange = { clampOf, bind, show };
})(typeof window !== 'undefined' ? window : globalThis);
