(function (root) {
  'use strict';

  // 分割の盤の選択（spec-2-2b 確定事項C3・C4・G3）。DOM に触れない。
  //
  // 選べるのはつながったページだけ（箱をまたいでよい）。選択は { anchor, from, to }（0 始まり）か null。anchor は
  // Shift を押したときの起点で、最後に「選び始めた」ページ（クリックしたページ・なぞり始めたページ）。

  const none = () => null;
  const isEmpty = (sel) => sel === null || sel === undefined;

  function span(anchor, page) {
    return { anchor, from: Math.min(anchor, page), to: Math.max(anchor, page) };
  }

  const click = (page) => span(page, page);

  // Shift＋クリック。何も選んでいなければクリックと同じ。
  const extend = (sel, page) => (isEmpty(sel) ? click(page) : span(sel.anchor, page));

  // なぞる。押したページからなぞった所まで。
  const dragTo = (pressed, page) => span(pressed, page);

  const range = (sel) => (isEmpty(sel) ? null : { from: sel.from, to: sel.to });

  // 盤のページ数に収める（対象を読み直してページ数が変わったとき）。
  function clamp(sel, pageCount) {
    if (isEmpty(sel) || sel.from >= pageCount)
      return none();
    const last = pageCount - 1;
    return { anchor: Math.min(sel.anchor, last), from: sel.from, to: Math.min(sel.to, last) };
  }

  // 選んだときの操作の行に出す中身（確定事項C4）。全部が書き出さないページなら［書き出す］を出す。
  function bandOf(board, sel) {
    if (isEmpty(sel))
      return null;
    const skipped = new Set(board.skipped);
    let allSkipped = true;
    for (let page = sel.from; page <= sel.to && allSkipped; page += 1)
      allSkipped = skipped.has(page);
    return { from: sel.from, to: sel.to, count: sel.to - sel.from + 1, allSkipped };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitSelection = { none, isEmpty, click, extend, dragTo, range, clamp, bandOf };
})(typeof window !== 'undefined' ? window : globalThis);
