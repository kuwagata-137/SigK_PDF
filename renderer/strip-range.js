(function (root) {
  'use strict';

  // 帯で選択したページを、範囲欄の番号にする純関数（版 1.5.0 の②。docs/spec-7-11-view-font.md）。DOM には触らない。
  //
  // 帯の選択（strip-selection.js）は表示の並び（plan）の位置で持つ。範囲欄はファイルのページ番号で読む（ツールは保存してある
  // ファイルを読み直して作るため）。保存していない並べ替え・削除・差し込みがあると、2 つの番号が食い違う（質問 RG2）。
  // ここでは、表示の位置の番号とファイルのページ番号の両方と、2 つが同じかを返し、どちらを使うかは呼ぶ側が決める。
  //
  // 並びの要素は { src, rotate }（元ファイルの 0 始まりのページ）か { insert, rotate }（差し込んだページ。page-plan.js）。

  function isIndex(value) {
    return Number.isInteger(value) && value >= 0;
  }

  // 並びの番号が、ファイルのページ番号と同じか（並べ替え・削除・差し込みが無い）。回転・トリミング・モザイクは番号を変えない。
  function numberingMatches(plan, pageCount) {
    if (!Array.isArray(plan) || plan.length !== pageCount)
      return false;
    return plan.every((page, index) => page?.src === index);
  }

  // 表示の位置（0 始まり）を、1 始まりの番号にする。
  function displayNumbers(indices) {
    return (indices ?? []).filter(isIndex).map((index) => index + 1);
  }

  // 表示の位置（0 始まり）を、ファイルのページ番号（1 始まり）にする。差し込んだページと、並びの外の位置は除く。
  function fileNumbers(plan, indices) {
    return (indices ?? []).filter(isIndex).map((index) => plan?.[index]?.src).filter(isIndex).map((src) => src + 1);
  }

  // { matches, display, file }。display は表示の位置の番号、file はファイルのページ番号の、範囲の記法の文字列（例「2-4, 7」）。
  function describe({ plan, pageCount, indices }) {
    const format = root.SigK.pageRange.formatPageRange;
    return {
      matches: numberingMatches(plan, pageCount),
      display: format(displayNumbers(indices)),
      file: format(fileNumbers(plan, indices)),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripRange = { numberingMatches, displayNumbers, fileNumbers, describe };
})(typeof window !== 'undefined' ? window : globalThis);
