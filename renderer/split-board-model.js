(function (root) {
  'use strict';

  // 分割の盤（spec-2-2b 確定事項B1〜B6・C1〜C7）。DOM にも pdf.js にも触れない。
  //
  // 盤は { pageCount, cuts, skipped }。cuts は「新しい箱がそのページから始まる」0 始まりのページ番号（1〜pageCount−1）の
  // 昇順、skipped は書き出さないページの昇順。箱は分け目で区切った続きの範囲で、そこからできるファイルは箱のページから
  // 書き出さないページを除いたもの。書き出さないページは分け目を作らない。
  //
  // 操作は新しい盤を返し、変わらなければ同じ盤を返す。履歴（split-board-history.js）が「変わったか」を === で見られるように。

  const maxOutputs = () => root.SigK?.splitPlan?.MAX_OUTPUTS ?? 500;

  function create(pageCount) {
    return { pageCount, cuts: [], skipped: [] };
  }

  const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

  function same(a, b) {
    return a.pageCount === b.pageCount && sameList(a.cuts, b.cuts) && sameList(a.skipped, b.skipped);
  }

  const sorted = (values) => [...new Set(values)].sort((a, b) => a - b);

  // 中身が変わったときだけ新しい盤にする。
  function next(board, { cuts = board.cuts, skipped = board.skipped }) {
    const candidate = { pageCount: board.pageCount, cuts: sorted(cuts), skipped: sorted(skipped) };
    return same(board, candidate) ? board : candidate;
  }

  const isCutPosition = (board, at) => Number.isInteger(at) && at >= 1 && at < board.pageCount;
  const isPage = (board, page) => Number.isInteger(page) && page >= 0 && page < board.pageCount;

  // そのページを含む箱の番号。cuts のうち page 以下のものの数（二分探索）。
  function boxOf(board, page) {
    let low = 0;
    let high = board.cuts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (board.cuts[middle] <= page)
        low = middle + 1;
      else
        high = middle;
    }
    return low;
  }

  // 箱の一覧。first・last は書き出すページの先頭と末尾（無ければ null）、file は書き出すページのある箱に振る 1 始まりの番号。
  function boxes(board) {
    const skipped = new Set(board.skipped);
    const starts = [0, ...board.cuts];
    let file = 0;
    return starts.map((start, index) => {
      const end = (starts[index + 1] ?? board.pageCount) - 1;
      let first = null;
      let last = null;
      let skippedCount = 0;
      for (let page = start; page <= end; page += 1) {
        if (skipped.has(page)) {
          skippedCount += 1;
          continue;
        }
        first ??= page;
        last = page;
      }
      const keptCount = end - start + 1 - skippedCount;
      return { index, start, end, keptCount, skippedCount, first, last, file: keptCount > 0 ? (file += 1) : null };
    });
  }

  // ワーカーと名前の規則へ渡す並び（確定事項B4）。番号を振った箱ごとの、書き出すページ。
  function parts(board) {
    const skipped = new Set(board.skipped);
    return boxes(board).filter((box) => box.file !== null).map((box) => {
      const pages = [];
      for (let page = box.start; page <= box.end; page += 1) {
        if (!skipped.has(page))
          pages.push(page);
      }
      return pages;
    });
  }

  function cut(board, at) {
    if (!isCutPosition(board, at))
      return board;
    return next(board, { cuts: [...board.cuts, at] });
  }

  // その箱の頭の分け目を消す（確定事項C2）。最初の箱には頭の分け目が無い。
  function join(board, boxIndex) {
    if (!Number.isInteger(boxIndex) || boxIndex < 1 || boxIndex > board.cuts.length)
      return board;
    return next(board, { cuts: board.cuts.filter((_at, index) => index !== boxIndex - 1) });
  }

  // 範囲を 1 つのファイルにする（確定事項C5）。両端に分け目を入れ、中の分け目と書き出さない印を消す（決定76 ⑩）。
  function makeOne(board, from, to) {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (!isPage(board, low) || !isPage(board, high))
      return board;
    const cuts = board.cuts.filter((at) => at <= low || at > high + 1);
    if (low > 0)
      cuts.push(low);
    if (high + 1 < board.pageCount)
      cuts.push(high + 1);
    return next(board, { cuts, skipped: board.skipped.filter((page) => page < low || page > high) });
  }

  // 書き出さない印を付ける・外す（確定事項C6）。分け目は変えない。
  function setSkipped(board, from, to, flag) {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (!isPage(board, low) || !isPage(board, high))
      return board;
    const inRange = (page) => page >= low && page <= high;
    if (!flag)
      return next(board, { skipped: board.skipped.filter((page) => !inRange(page)) });
    const added = Array.from({ length: high - low + 1 }, (_value, index) => low + index);
    return next(board, { skipped: [...board.skipped, ...added] });
  }

  // ---- まとめて分ける（確定事項C7）。どれも分け目を全部入れ直し、書き出さない印は残す ----

  function splitEvery(board, n) {
    if (!Number.isInteger(n) || n < 1)
      return board;
    const cuts = [];
    for (let at = n; at < board.pageCount; at += n)
      cuts.push(at);
    return next(board, { cuts });
  }

  const splitEach = (board) => splitEvery(board, 1);

  // numbers は「そのページの前で切る」1 始まりのページ番号（split-plan.js の parseCuts が読んだもの）。
  function splitBefore(board, numbers) {
    return next(board, { cuts: (numbers ?? []).map((number) => number - 1).filter((at) => isCutPosition(board, at)) });
  }

  const clearCuts = (board) => next(board, { cuts: [] });

  // 実行できるか（確定事項B5）。分け目も書き出さない印も無ければ、元と同じ 1 本になるだけなので実行させない（決定76 ④）。
  function status(board) {
    const files = boxes(board).filter((box) => box.file !== null).length;
    if (board.cuts.length === 0 && board.skipped.length === 0)
      return { ready: false, reason: 'untouched', files };
    if (files === 0)
      return { ready: false, reason: 'empty', files };
    if (files > maxOutputs())
      return { ready: false, reason: 'too-many', files };
    return { ready: true, reason: null, files };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoard = {
    create, same, boxes, boxOf, parts, status,
    cut, join, makeOne, setSkipped,
    splitEach, splitEvery, splitBefore, clearCuts,
  };
})(typeof window !== 'undefined' ? window : globalThis);
