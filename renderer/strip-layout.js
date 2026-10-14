(function (root) {
  'use strict';

  // ツールモードの帯の寸法と、見えている所の計算（spec-2-5 確定事項D2・D8。見本 screenshots/strips2-merge.png）。DOM に触れない。
  //
  // 寸法は JS が決めて style に書く（jsdom では寸法を測れないため。見える所の計算をテストできる）。帯の高さはどの帯も同じで、
  // 紙は高さ 104px にそろえ、横長の紙は幅 180px で止める。描くのは見えている帯（上下に 1 本ずつ先読み）の、見えている紙
  // （左右に 4 枚ずつ先読み）だけで、全部の帯の合計で 160 枚まで（およそ 20MB）。

  const SHEET_HEIGHT = 104;
  const SHEET_MAX_WIDTH = 180;
  const SHEET_MIN_WIDTH = 24;
  // 紙 1 枚の枠（.strip-page の padding 3px と枠線 1px の両側）と、紙の間（gap）・列の端（.strip-pages の padding）。
  const CELL_EXTRA = 8;
  const CELL_GAP = 12;
  const ROW_PAD = 2;
  // 帯 1 本の高さ（枠線 2・上の余白 7・見出し 26・紙の列〔上 6・紙の枠 8・紙 104・番号との間 3・番号 14・下 8・横のスクロールバー 6〕・下の余白 4）。
  const STRIP_HEIGHT = 2 + 7 + 26 + (6 + CELL_EXTRA + SHEET_HEIGHT + 3 + 14 + 8 + 6) + 4;
  const STRIP_GAP = 10;
  const COLUMN_PAD = 12;
  // #strips の幅から紙の列の見えている幅を出すときに引く分（#strips の左右の余白 14・帯の左右の余白 10・枠線 1）。
  const PAGES_INSET = 2 * (14 + 10 + 1);
  const PREFETCH_STRIPS = 1;
  const PREFETCH_CELLS = 4;
  const LIMIT = 160;
  const PARALLEL = 2;

  // 紙の大きさ（px）。size は plan を当てたあとの寸法（回転・切り取りのあと。viewer の sizes）。
  function sheetOf(size) {
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (!(width > 0) || !(height > 0))
      return { width: Math.round(SHEET_HEIGHT * 0.707), height: SHEET_HEIGHT };
    const natural = SHEET_HEIGHT * width / height;
    if (natural <= SHEET_MAX_WIDTH)
      return { width: Math.max(SHEET_MIN_WIDTH, Math.round(natural)), height: SHEET_HEIGHT };
    return { width: SHEET_MAX_WIDTH, height: Math.max(1, Math.round(SHEET_MAX_WIDTH * height / width)) };
  }

  // 紙の列。lefts は各セルの左端（列の左端から）、widths はセルの幅（紙の幅＋枠）、total は列の幅。
  function row(sizes) {
    const sheets = (sizes ?? []).map(sheetOf);
    const lefts = [];
    const widths = [];
    let x = ROW_PAD;
    for (const sheet of sheets) {
      lefts.push(x);
      widths.push(sheet.width + CELL_EXTRA);
      x += sheet.width + CELL_EXTRA + CELL_GAP;
    }
    return { sheets, lefts, widths, total: sheets.length === 0 ? 0 : x - CELL_GAP + ROW_PAD };
  }

  // 右端が start より右にある最初のセル（二分探索）。
  function firstAfter(line, start) {
    let low = 0;
    let high = line.lefts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (line.lefts[middle] + line.widths[middle] <= start)
        low = middle + 1;
      else
        high = middle;
    }
    return low;
  }

  // 見えているセル [first, last) と、先読みを足した [from, to)。見えていなければ first === last。
  function visibleCells(line, scrollLeft, width, prefetch = PREFETCH_CELLS) {
    const count = line.lefts.length;
    if (count === 0 || !(width > 0))
      return { first: 0, last: 0, from: 0, to: 0 };
    const first = firstAfter(line, scrollLeft);
    let last = first;
    while (last < count && line.lefts[last] < scrollLeft + width)
      last += 1;
    return { first, last, from: Math.max(0, first - prefetch), to: Math.min(count, last + prefetch) };
  }

  const stripTop = (index) => COLUMN_PAD + index * (STRIP_HEIGHT + STRIP_GAP);

  // 見えている帯 [first, last) と、先読みを足した [from, to)。
  function visibleStrips(count, scrollTop, height, prefetch = PREFETCH_STRIPS) {
    if (count === 0 || !(height > 0))
      return { first: 0, last: 0, from: 0, to: 0 };
    const step = STRIP_HEIGHT + STRIP_GAP;
    const first = Math.min(count, Math.max(0, Math.floor((scrollTop - COLUMN_PAD + STRIP_GAP) / step)));
    let last = first;
    while (last < count && stripTop(last) < scrollTop + height)
      last += 1;
    return { first, last, from: Math.max(0, first - prefetch), to: Math.min(count, last + prefetch) };
  }

  // 描く順。見えているものを先に（帯の順・紙の順）、先読みはそのあと。items は { strip, page, near }（near は先読み）。
  function drawOrder(items) {
    return [...items].sort((a, b) => Number(a.near) - Number(b.near) || a.strip - b.strip || a.page - b.page);
  }

  // 帯の並びが変わったか（DOM を並べ直すかどうか）。
  function moved(previous, next) {
    return previous.length !== next.length || previous.some((id, index) => id !== next[index]);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripLayout = {
    SHEET_HEIGHT, SHEET_MAX_WIDTH, STRIP_HEIGHT, STRIP_GAP, COLUMN_PAD, PAGES_INSET, LIMIT, PARALLEL,
    sheetOf, row, visibleCells, stripTop, visibleStrips, drawOrder, moved,
  };
})(typeof window !== 'undefined' ? window : globalThis);
