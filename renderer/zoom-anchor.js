(function (root) {
  'use strict';

  // 倍率を変えてもマウスの下の紙の点を保つ（spec-4b-3b 確定事項C4）。DOM に触れない。viewer.js の setZoom が使う。
  //
  // 座標は #view-pages の中の CSS px。pages は viewer-layout.js の layoutPages が返す並び（index・left・top・width・height）。
  // 並べ直す前に、点が乗っているページ（乗っていなければ一番近いページ）とその中の割合を控え、並べ直した後の同じページの
  // 同じ割合の点を返す。ページの間の余白は倍率に依らないので、全体の比で掛けるより、ページを基準にするほうがずれない。

  // 点からページの枠までの距離（中なら 0）。
  function distance(page, [x, y]) {
    const dx = Math.max(page.left - x, 0, x - (page.left + page.width));
    const dy = Math.max(page.top - y, 0, y - (page.top + page.height));
    return Math.hypot(dx, dy);
  }

  function nearest(pages, point) {
    let best = null;
    let bestDistance = Infinity;
    for (const page of pages) {
      const d = distance(page, point);
      if (d < bestDistance) {
        best = page;
        bestDistance = d;
      }
    }
    return best;
  }

  // { index, fx, fy }。ページが無いか大きさが 0 なら null。
  function capture(pages, point) {
    const page = nearest(pages ?? [], point);
    if (page === null || !(page.width > 0) || !(page.height > 0))
      return null;
    return { index: page.index, fx: (point[0] - page.left) / page.width, fy: (point[1] - page.top) / page.height };
  }

  // 並べ直した後の点 [x, y]。控えが無いか、そのページが無ければ null。
  function place(pages, held) {
    if (held === null || held === undefined)
      return null;
    const page = (pages ?? []).find((candidate) => candidate.index === held.index);
    if (page === undefined)
      return null;
    return [page.left + held.fx * page.width, page.top + held.fy * page.height];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.zoomAnchor = { capture, place };
})(typeof window !== 'undefined' ? window : globalThis);
