(function (root) {
  'use strict';

  // ページの配置と倍率の計算。DOM にも pdf.js にも触れない純関数だけを置く。
  // Node から require() して直接テストできるようにするためである（docs/02 第4章）。

  // PDF の座標は 1/72 インチ単位、画面の CSS ピクセルは 1/96 インチ単位である。
  // pdf.js の scale:1 は 72dpi 相当で、そのまま出すと実物より小さい。
  // 利用者に見せる倍率（zoom）と pdf.js へ渡す scale を分け、
  // scale = zoom × CSS_UNITS で変換する（spec-1-1 確定事項6）。
  const CSS_UNITS = 96 / 72;

  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  const MIN_ZOOM = ZOOM_STEPS[0];
  const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

  // shell.css の #view の padding・gap と同じ値にする。片方だけ変えると
  // スクロール位置の計算が実際の描画とずれる。
  const PAGE_GAP = 16;
  const PAGE_MARGIN = 18;
  const SIDE_MARGIN = 24;

  const RENDER_AHEAD = 1;
  const MAX_RENDERED = 8;
  const MAX_CANVAS_SCALE = 3;

  // 見開き（spec-2-3 確定事項11・12）。組の2枚の間隔は縦の間隔と同じにする。
  // モックで見て、詰めなくても組として読めると判断した。先読みは 1 だと隣の行の
  // 半分しか用意しないので 2 にする。上限（MAX_RENDERED）は変えない。
  const FACING_GAP = PAGE_GAP;
  const FACING_AHEAD = 2;

  // サムネイル（spec-1-3 確定事項3・6・7）。shell.css の .thumbs1 / .thumb / .cap と
  // 同じ値にする。片方だけ変えると、可視範囲の判定が実際の描画とずれる。
  const THUMB_GAP = 10;      // .thumbs1 の gap
  const THUMB_FRAME = 5;     // .thumb の padding 3px ＋ border 2px
  const THUMB_CAPTION = 17;  // .cap の行の高さ ＋ margin-top
  const THUMB_MARGIN = 10;   // .side-scroll の padding
  // 先読みの枚数。ページビューの1より多くする。240px 幅のパネルには
  // A4 が約2枚しか見えず、1 のままでは4枚しか持てない。少し戻すたびに
  // 描き直しが起きるのを避けるため、実測して 4 にした（spec-1-3 の実測）。
  const THUMB_AHEAD = 4;
  const MAX_THUMBS = 24;
  const MAX_THUMB_SCALE = 2;

  // ページモードの多列グリッド（spec-1-5 確定事項23）。サイドパネルは
  // 180〜420px でドラッグできるので、列数はパネルの幅から決める。固定の2列に
  // すると最小幅で紙が 65px まで縮み、固定の1列だと広げても紙が育たない。
  const MAX_COLUMNS = 3;
  // この幅ごとに1列を足す。
  //
  // **2026-09-01 実測により 110 → 100 へ改めた。**spec-1-5 確定事項23 は
  // 「目標の紙幅 100px ＋ 間隔 10px」で 110 としていたが、その実測表は
  // 縦スクロールバー（約16px）を勘定に入れていなかった。実機では幅 240px の
  // パネルの内容幅が 220px ではなく **204px** になり、110 のままだと
  // 確定事項23 が定める「240px→2列」を満たせず1列になる。
  //
  // 100 にすると列数は確定事項23 の表（180→1／240→2／300→2／340→3／420→3）と
  // すべて一致する。紙幅だけが表より小さくなり、差は列数で違う
  // （1列 −16px／2列 −8px／3列 −6px。スクロールバー16px を列で割った結果である）。
  const THUMB_TARGET_WIDTH = 100;

  function clampZoom(zoom) {
    if (!Number.isFinite(zoom))
      return 1;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  // 段の間の値（幅に合わせる の結果など）から押されたら、その値より大きい／小さい
  // 最も近い段へ動く。同じ段に留まって「押しても変わらない」を起こさないため。
  function nextZoom(zoom) {
    const current = clampZoom(zoom);
    return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? MAX_ZOOM;
  }

  function prevZoom(zoom) {
    const current = clampZoom(zoom);
    return [...ZOOM_STEPS].reverse().find((step) => step < current - 1e-6) ?? MIN_ZOOM;
  }

  // gap は見開きで2枚の間に入る間隔（CSS px）。pageWidth に2枚の幅の和を渡し、
  // 間隔ぶんを先に引いてから合わせる（spec-2-3 確定事項18）。
  function fitWidthZoom({ pageWidth, viewportWidth, gap = 0 }) {
    if (!(pageWidth > 0) || !(viewportWidth > 0))
      return 1;
    return clampZoom((viewportWidth - SIDE_MARGIN * 2 - gap) / (pageWidth * CSS_UNITS));
  }

  function fitPageZoom({ pageWidth, pageHeight, viewportWidth, viewportHeight, gap = 0 }) {
    if (!(pageHeight > 0) || !(viewportHeight > 0))
      return fitWidthZoom({ pageWidth, viewportWidth, gap });
    const byWidth = fitWidthZoom({ pageWidth, viewportWidth, gap });
    const byHeight = (viewportHeight - PAGE_MARGIN * 2) / (pageHeight * CSS_UNITS);
    return clampZoom(Math.min(byWidth, byHeight));
  }

  // 見開きでの組の先頭（spec-2-3 確定事項14）。組は 1-2, 3-4 で固定なので、
  // 0 始まりの添字では偶数が左・奇数が右である。単ページではそのページ自身。
  function spreadStart(index, facing = false) {
    return facing ? index - (index % 2) : index;
  }

  // 「幅に合わせる」「全体」が見る寸法（PDF 単位。確定事項18〜20）。見開きでは
  // 組の2枚の幅の和と高さの最大。末尾の単独ページは幅を2倍して見なす。
  // ページを送るたびに倍率が跳ねないためである。
  function spreadSize(sizes, index, facing = false) {
    const start = spreadStart(index, facing);
    const left = sizes[start];
    if (left === undefined)
      return { width: 0, height: 0 };
    if (!facing)
      return { width: left.width, height: left.height };
    const right = sizes[start + 1];
    if (right === undefined)
      return { width: left.width * 2, height: left.height };
    return { width: left.width + right.width, height: Math.max(left.height, right.height) };
  }

  // sizes は pdf.js の getViewport({ scale: 1 }) が返す寸法（回転済み）の配列。
  // 幅の違うページが混ざっていても中央に揃うよう、いちばん広いページに合わせた
  // 器（contentWidth）を作り、その中での左端を各ページに持たせる。
  //
  // facing（見開き。spec-2-3 確定事項7〜10）では 2 枚を1行に置く。行の高さは
  // 高いほうに合わせて上揃え。横は綴じ目を基準にし、左ページは綴じ目へ右寄せ、
  // 右ページは綴じ目から左寄せにする。幅の違うページが混ざっても綴じ目が
  // 一直線に通る。奇数の末尾は左に単独で置く。
  function layoutPages({ sizes, zoom, facing = false }) {
    const scale = zoom * CSS_UNITS;
    const pages = sizes.map((size, index) => ({
      index,
      top: 0,
      left: 0,
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    }));
    if (pages.length === 0)
      return { pages, contentWidth: 0, totalHeight: 0 };

    return facing ? placeFacing(pages) : placeSingle(pages);
  }

  function placeSingle(pages) {
    let top = PAGE_MARGIN;
    for (const page of pages) {
      page.top = top;
      top += page.height + PAGE_GAP;
    }
    const contentWidth = pages.reduce((widest, page) => Math.max(widest, page.width), 0);
    for (const page of pages)
      page.left = Math.round((contentWidth - page.width) / 2);
    return { pages, contentWidth, totalHeight: top - PAGE_GAP + PAGE_MARGIN };
  }

  function placeFacing(pages) {
    const isLeft = (page) => page.index % 2 === 0;
    const leftHalf = pages.filter(isLeft).reduce((widest, page) => Math.max(widest, page.width), 0);
    const rightHalf = pages.filter((page) => !isLeft(page)).reduce((widest, page) => Math.max(widest, page.width), 0);
    // 右に置くページが1枚も無い（1ページの文書）なら、間隔ぶんの余白を作らない。
    const contentWidth = rightHalf === 0 ? leftHalf : leftHalf + FACING_GAP + rightHalf;

    let top = PAGE_MARGIN;
    for (let start = 0; start < pages.length; start += 2) {
      const row = pages.slice(start, start + 2);
      const rowHeight = Math.max(...row.map((page) => page.height));
      for (const page of row) {
        page.top = top;
        page.left = isLeft(page) ? leftHalf - page.width : leftHalf + FACING_GAP;
      }
      top += rowHeight + PAGE_GAP;
    }
    return { pages, contentWidth, totalHeight: top - PAGE_GAP + PAGE_MARGIN };
  }

  // パネルの内容幅から列数を決める（spec-1-5 確定事項23）。
  //
  // 受け取るのは「パネル幅」ではなく「内容幅」である。パネル幅からは
  // padding 20px と縦スクロールバー約16px が引かれる（パネル240px → 内容204px）。
  //
  // **2026-09-01 実測で除数を 110 → 100 にした。**起草時の実測表が縦スクロールバーを
  // 勘定に入れておらず、110 のままではパネル240px が1列になった。100 にすると
  // 列数は表どおりになり、紙幅だけが小さくなる（1列 −16px／2列 −8px／3列 −6px）。
  //
  // 実測（パネル幅 → 列数・紙幅）: 180→1列 134px ／ 240→2列 87px ／
  // 300→2列 117px ／ 340→3列 84px ／ 420→3列 111px。
  function thumbnailColumns(contentWidth) {
    if (!Number.isFinite(contentWidth))
      return 1;
    const columns = Math.floor((contentWidth + THUMB_GAP) / THUMB_TARGET_WIDTH);
    return Math.min(MAX_COLUMNS, Math.max(1, columns));
  }

  function clampColumns(columns) {
    const count = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 1;
    return Math.min(MAX_COLUMNS, count);
  }

  // 同時に持つサムネイルの上限（確定事項26）。多列では紙が小さくなるため、
  // 枚数が増えても総メモリは1列時を下回る（幅240pxで 1列210px 対 2列105px ＝ 面積比4倍）。
  function maxThumbs(columns) {
    return MAX_THUMBS * clampColumns(columns);
  }

  // 先読みの枚数も列数のぶんだけ増やす。
  //
  // **2026-09-01 実測で足した。**先読みは枚数で数えるので、3列のままの 4 では
  // 1.3 行ぶんにしかならず、上限（72枚）に遠く届かない状態でスクロールのたびに
  // 描き直しが起きていた（実測: 3列・1,000ページで 17 枚どまり）。
  // 上限を列数倍にした以上、先読みも揃えないと上限が意味を持たない。
  function thumbAhead(columns) {
    return THUMB_AHEAD * clampColumns(columns);
  }

  // サムネイルの配置。ページビューとは法則が違う（spec-1-3 確定事項3）。
  // ページビューは「倍率が一律で、幅が紙ごとに変わる」。ここは
  // 「幅を揃えて、高さが紙ごとに変わる」。
  //
  // 返す形は layoutPages と揃える。top と height を同じ意味で持たせておけば、
  // visibleRange() と currentPageIndex() をそのまま使える。
  //
  // columns を渡すと多列に並べる（spec-1-5 確定事項25）。ページモードで使う。
  // **1列のときの返り値は塊③-a と同じにする。**閲覧モードのサイドパネルは
  // 1列のまま変えないため、ここで丸め方を変えると見た目が動いてしまう。
  function layoutThumbnails({
    sizes,
    columnWidth,
    columns = 1,
    gap = THUMB_GAP,
    margin = THUMB_MARGIN,
    caption = THUMB_CAPTION,
    frame = THUMB_FRAME,
  }) {
    const count = Math.min(MAX_COLUMNS, Math.max(1, Math.floor(columns) || 1));
    // 1列では幅をそのまま使う。多列のぶんの割り算と切り捨てを挟むと、
    // 1列の見た目が塊③-a から変わってしまう。
    const cellWidth = count === 1 ? columnWidth : Math.floor((columnWidth - gap * (count - 1)) / count);
    const sheetWidth = Math.max(1, Math.round(cellWidth - frame * 2));
    const width = Math.max(1, cellWidth);

    const pages = [];
    let rowTop = margin;
    let rowHeight = 0;

    sizes.forEach((size, index) => {
      const column = index % count;
      // 行が変わったら、いちばん高い紙のぶんだけ下げる。幅の違うページが
      // 混ざると同じ行でも高さが揃わない。
      if (column === 0 && index > 0) {
        rowTop += rowHeight + gap;
        rowHeight = 0;
      }

      // 幅が取れない壊れたページでも、枠だけは並べて番号を出す。
      const ratio = size.width > 0 ? size.height / size.width : 1;
      const sheetHeight = Math.max(1, Math.round(ratio * sheetWidth));
      const height = sheetHeight + frame * 2 + caption;

      pages.push({
        index,
        top: rowTop,
        left: column * (width + gap),
        width,
        height,
        sheetWidth,
        sheetHeight,
      });
      rowHeight = Math.max(rowHeight, height);
    });

    const totalHeight = pages.length === 0 ? 0 : rowTop + rowHeight + margin;
    return { pages, sheetWidth, totalHeight, columns: count };
  }

  // サムネイルを描くときに pdf.js へ渡す scale。
  // ページビュー（renderScale）と違い CSS_UNITS を掛けない。狙うのは
  // 「幅が sheetWidth ピクセルになること」であって、実寸の何倍かではないため。
  // devicePixelRatio の上限をページビューの3より低い2にするのは、サムネイルが
  // 読むものではなく、最大 MAX_THUMBS 枚を同時に持つためである（確定事項7）。
  function thumbnailScale({ sheetWidth, pageWidth, devicePixelRatio = 1 }) {
    if (!(pageWidth > 0) || !(sheetWidth > 0))
      return 1;
    const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return (sheetWidth / pageWidth) * Math.min(ratio, MAX_THUMB_SCALE);
  }

  function overlapHeight(page, scrollTop, viewportHeight) {
    return Math.min(page.top + page.height, scrollTop + viewportHeight) - Math.max(page.top, scrollTop);
  }

  function visibleRange({ pages, scrollTop, viewportHeight }) {
    const shown = pages.filter((page) => overlapHeight(page, scrollTop, viewportHeight) > 0);
    if (shown.length > 0)
      return { first: shown[0].index, last: shown[shown.length - 1].index };
    // ページとページの隙間にちょうど収まっている場合。近いほうを返す。
    const nearest = currentPageIndex({ pages, scrollTop, viewportHeight });
    return { first: nearest, last: nearest };
  }

  // いちばん広く見えているページを現在ページとする。同じなら若い番号を採る。
  function currentPageIndex({ pages, scrollTop, viewportHeight }) {
    let best = 0;
    let bestScore = -Infinity;
    for (const page of pages) {
      const score = overlapHeight(page, scrollTop, viewportHeight);
      // 1枚も見えていないときは、視野の中心に近いほうを選ぶ。
      const fallback = -Math.abs(page.top + page.height / 2 - (scrollTop + viewportHeight / 2));
      const value = score > 0 ? score : fallback / 1e6;
      if (value > bestScore) {
        bestScore = value;
        best = page.index;
      }
    }
    return best;
  }

  // 描く対象。可視範囲の前後 ahead ページまで広げ、多すぎるときは現在ページの
  // 周りを残して切り詰める。canvas を持ちすぎるとメモリが尽きるため。
  function renderTargets({ count, first, last, current = first, ahead = RENDER_AHEAD, max = MAX_RENDERED }) {
    if (count <= 0)
      return [];
    let start = Math.max(0, first - ahead);
    let end = Math.min(count - 1, last + ahead);
    if (end - start + 1 > max) {
      start = Math.max(start, Math.min(current - Math.floor((max - 1) / 2), end - max + 1));
      end = Math.min(end, start + max - 1);
    }
    const targets = [];
    for (let index = start; index <= end; index += 1)
      targets.push(index);
    return targets;
  }

  function scrollTopForPage({ pages, index }) {
    const page = pages[Math.min(pages.length - 1, Math.max(0, index))];
    if (page === undefined)
      return 0;
    return Math.max(0, page.top - PAGE_MARGIN);
  }

  // canvas は devicePixelRatio を掛けた実解像度で描く。高 DPI で字が滲まないため。
  // 倍率の上限を設けるのは、200MB の文書で canvas がメモリを食い潰さないようにするため。
  function renderScale({ zoom, devicePixelRatio = 1 }) {
    const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return zoom * CSS_UNITS * Math.min(ratio, MAX_CANVAS_SCALE);
  }

  function formatZoom(zoom) {
    return `${Math.round(clampZoom(zoom) * 100)}%`;
  }

  // ページ番号の入力欄の値を 0 起点の添字に直す。範囲外と数字でないものは null。
  function parsePageNumber(value, count) {
    const number = Number.parseInt(String(value).trim(), 10);
    if (!Number.isInteger(number) || number < 1 || number > count)
      return null;
    return number - 1;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewerLayout = {
    CSS_UNITS,
    ZOOM_STEPS,
    MIN_ZOOM,
    MAX_ZOOM,
    PAGE_GAP,
    PAGE_MARGIN,
    SIDE_MARGIN,
    RENDER_AHEAD,
    MAX_RENDERED,
    MAX_CANVAS_SCALE,
    FACING_GAP,
    FACING_AHEAD,
    THUMB_GAP,
    THUMB_FRAME,
    THUMB_CAPTION,
    THUMB_MARGIN,
    THUMB_AHEAD,
    MAX_THUMBS,
    MAX_THUMB_SCALE,
    MAX_COLUMNS,
    THUMB_TARGET_WIDTH,
    thumbnailColumns,
    maxThumbs,
    thumbAhead,
    clampZoom,
    nextZoom,
    prevZoom,
    fitWidthZoom,
    fitPageZoom,
    spreadStart,
    spreadSize,
    layoutPages,
    layoutThumbnails,
    thumbnailScale,
    visibleRange,
    currentPageIndex,
    renderTargets,
    scrollTopForPage,
    renderScale,
    formatZoom,
    parsePageNumber,
  };
})(typeof window !== 'undefined' ? window : globalThis);
