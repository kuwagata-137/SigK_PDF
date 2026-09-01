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

  function fitWidthZoom({ pageWidth, viewportWidth }) {
    if (!(pageWidth > 0) || !(viewportWidth > 0))
      return 1;
    return clampZoom((viewportWidth - SIDE_MARGIN * 2) / (pageWidth * CSS_UNITS));
  }

  function fitPageZoom({ pageWidth, pageHeight, viewportWidth, viewportHeight }) {
    if (!(pageHeight > 0) || !(viewportHeight > 0))
      return fitWidthZoom({ pageWidth, viewportWidth });
    const byWidth = fitWidthZoom({ pageWidth, viewportWidth });
    const byHeight = (viewportHeight - PAGE_MARGIN * 2) / (pageHeight * CSS_UNITS);
    return clampZoom(Math.min(byWidth, byHeight));
  }

  // sizes は pdf.js の getViewport({ scale: 1 }) が返す寸法（回転済み）の配列。
  // 幅の違うページが混ざっていても中央に揃うよう、いちばん広いページに合わせた
  // 器（contentWidth）を作り、その中での左端を各ページに持たせる。
  function layoutPages({ sizes, zoom }) {
    const scale = zoom * CSS_UNITS;
    let top = PAGE_MARGIN;
    const pages = sizes.map((size, index) => {
      const height = Math.round(size.height * scale);
      const page = { index, top, left: 0, width: Math.round(size.width * scale), height };
      top += height + PAGE_GAP;
      return page;
    });

    const contentWidth = pages.reduce((widest, page) => Math.max(widest, page.width), 0);
    for (const page of pages)
      page.left = Math.round((contentWidth - page.width) / 2);

    const totalHeight = pages.length === 0 ? 0 : top - PAGE_GAP + PAGE_MARGIN;
    return { pages, contentWidth, totalHeight };
  }

  // サムネイルの配置。ページビューとは法則が違う（spec-1-3 確定事項3）。
  // ページビューは「倍率が一律で、幅が紙ごとに変わる」。ここは
  // 「幅を揃えて、高さが紙ごとに変わる」。
  //
  // 返す形は layoutPages と揃える。top と height を同じ意味で持たせておけば、
  // visibleRange() と currentPageIndex() をそのまま使える。
  function layoutThumbnails({
    sizes,
    columnWidth,
    gap = THUMB_GAP,
    margin = THUMB_MARGIN,
    caption = THUMB_CAPTION,
    frame = THUMB_FRAME,
  }) {
    const sheetWidth = Math.max(1, Math.round(columnWidth - frame * 2));
    let top = margin;

    const pages = sizes.map((size, index) => {
      // 幅が取れない壊れたページでも、枠だけは並べて番号を出す。
      const ratio = size.width > 0 ? size.height / size.width : 1;
      const sheetHeight = Math.max(1, Math.round(ratio * sheetWidth));
      const height = sheetHeight + frame * 2 + caption;
      const page = { index, top, height, sheetWidth, sheetHeight };
      top += height + gap;
      return page;
    });

    const totalHeight = pages.length === 0 ? 0 : top - gap + margin;
    return { pages, sheetWidth, totalHeight };
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
    THUMB_GAP,
    THUMB_FRAME,
    THUMB_CAPTION,
    THUMB_MARGIN,
    THUMB_AHEAD,
    MAX_THUMBS,
    MAX_THUMB_SCALE,
    clampZoom,
    nextZoom,
    prevZoom,
    fitWidthZoom,
    fitPageZoom,
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
