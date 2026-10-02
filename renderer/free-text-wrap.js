(function (root) {
  'use strict';

  // テキストの折り返しの純粋層（spec-4b-4a 確定事項C1・E1。事前調査 E）。DOM に触れない（字の送り幅は advance として外から受ける）。
  //
  // 1 字ずつ詰める: 送り幅の和が幅を超える字から次の行へ送る。行には最低 1 字を置く。明示の改行は残す。空白も字として幅を持ち、
  // 行末でもぶら下げない（入力欄の CSS white-space: break-spaces と同じ）。字の単位は書記素（line-break: anywhere が切る単位。
  // 絵文字の異体字セレクタや結合文字を切り離さない）。
  //
  // 入力欄（textarea）の幅は、折った行の幅そのものでなく「入る行の最長」と「送った字を足した行の最短」の真ん中に置く。
  // 境界の字（行の幅をわずかに超える字）を DOM が入れてしまうのを防ぎ、入力中と確定後の行をそろえる（事前調査 E: 0/3,600）。

  // 幅の比べの許し（pt）。送り幅の和の小数の誤差だけを吸う。
  const EPSILON = 1e-6;
  // 送った行が無いときに入力欄の幅へ足す分（pt）。画素への丸めで最後の字が送られないように。
  const EDITOR_SLACK = 1;

  let segmenter;

  function unitsOf(paragraph) {
    if (segmenter === undefined)
      segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;
    if (segmenter === null)
      return [...paragraph];
    return Array.from(segmenter.segment(paragraph), (part) => part.segment);
  }

  // 本文を明示の改行で分ける。CR は捨てる（free-text-geometry.js の linesOf と同じ）。
  function paragraphsOf(text) {
    return String(text).replace(/\r/g, '').split('\n');
  }

  // 1 行の幅（pt）。advance(unit) は字の送り幅（pt）。
  function widthOf(line, advance) {
    return unitsOf(line).reduce((sum, unit) => sum + advance(unit), 0);
  }

  // 1 段落を幅で折った行。{ text, width（pt）, units（字の数）, next（送った字を足した幅。送っていなければ null） }。
  function wrapParagraph(paragraph, width, advance) {
    const rows = [];
    let line = '';
    let sum = 0;
    let units = 0;
    for (const unit of unitsOf(paragraph)) {
      const step = advance(unit);
      if (units > 0 && sum + step > width + EPSILON) {
        rows.push({ text: line, width: sum, units, next: sum + step });
        line = '';
        sum = 0;
        units = 0;
      }
      line += unit;
      sum += step;
      units += 1;
    }
    rows.push({ text: line, width: sum, units, next: null });
    return rows;
  }

  function rowsOf(text, width, advance) {
    return paragraphsOf(text).flatMap((paragraph) => wrapParagraph(paragraph, width, advance));
  }

  // 折り返した行（文字列の並び）。
  function wrapLines(text, width, advance) {
    return rowsOf(text, width, advance).map((row) => row.text);
  }

  // 入力欄の中身の幅（pt）。DOM は「2 字以上の行がその幅に入る」かつ「送った字を足すと入らない」ときに同じ行で折る。
  // 1 字だけの行（幅より広い字）は DOM も 1 字で置くので、幅の決め手にしない。
  function editorWidthOf(text, width, advance) {
    const rows = rowsOf(text, width, advance);
    const longest = rows.reduce((max, row) => Math.max(max, row.width), 0);
    const limits = rows.filter((row) => row.next !== null).map((row) => row.next);
    if (limits.length === 0)
      return longest + EDITOR_SLACK;
    const fit = rows.filter((row) => row.units > 1).reduce((max, row) => Math.max(max, row.width), 0);
    return (fit + Math.min(...limits)) / 2;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextWrap = { EPSILON, EDITOR_SLACK, unitsOf, paragraphsOf, widthOf, wrapLines, editorWidthOf };
})(typeof window !== 'undefined' ? window : globalThis);
