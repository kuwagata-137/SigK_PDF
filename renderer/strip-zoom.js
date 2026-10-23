(function (root) {
  'use strict';

  // ツールモードの紙の倍率を変えたとき（tools-zoom.js）に、帯の画面を組み直し、見ていた紙の所へ送る（docs/07 決定83）。
  //
  // 変える前に、マウスの下（ボタン・キーでは帯の画面の左上）にある帯と、その帯の中の高さの割合、帯ごとの横のスクロールの割合を控える
  // （capture）。組み直したあと、控えた帯の同じ割合の所が同じ高さに来るように縦に送り、横は帯ごとに同じ割合の所へ送る（restore）。
  // マウスの下の帯は、マウスの下の紙が同じ所に来るようにする。分割の盤を広げた帯は盤の高さで数える（strip-view.js の heights）。

  let el = null;

  const layout = () => root.SigK.stripLayout;
  const strips = () => root.SigK.strips;

  // 帯の画面の中の点（見えている所の左上から）。anchor が無ければ左上。
  function pointIn(anchor) {
    if (anchor === null)
      return { x: 0, y: 0 };
    const box = el.strips.getBoundingClientRect();
    return { x: anchor.clientX - box.left - el.strips.clientLeft, y: anchor.clientY - box.top - el.strips.clientTop };
  }

  function pagesOf(id) {
    const node = strips().rowNode(id);
    return node === null ? null : root.SigK.stripRow.pagesOf(node);
  }

  const totalOf = (id) => strips().lineOf(id)?.total ?? 0;

  function capture(anchor) {
    if (el === null || strips()?.isShown() !== true)
      return null;
    const ids = strips().getState().ids;
    if (ids.length === 0)
      return null;
    const heights = strips().heights();
    const tops = layout().tops(heights);
    const point = pointIn(anchor);
    const y = el.strips.scrollTop + point.y;
    // 点が帯と帯の間なら、上の帯の終わりに寄せる。
    let index = 0;
    while (index + 1 < ids.length && tops[index + 1] <= y)
      index += 1;
    const rows = ids.map((id, at) => {
      const pages = pagesOf(id);
      const total = totalOf(id);
      if (pages === null || !(total > 0))
        return null;
      const x = at === index && anchor !== null ? Math.max(0, anchor.clientX - pages.getBoundingClientRect().left) : 0;
      return { id, x, ratio: (pages.scrollLeft + x) / total };
    });
    // 1 本目の帯の上の余白にある点は、余白ごと保つ（割合を負にしておく。0 で切ると、余白の分だけ下へ送り、見出しが上に隠れた）。
    const fraction = Math.min(1, (y - tops[index]) / heights[index]);
    return { index, fraction, y: point.y, rows };
  }

  function restore(held) {
    if (held === null || el === null)
      return;
    const heights = strips().heights();
    const tops = layout().tops(heights);
    if (held.index < heights.length)
      el.strips.scrollTop = Math.max(0, tops[held.index] + held.fraction * heights[held.index] - held.y);
    for (const row of held.rows) {
      const pages = row === null ? null : pagesOf(row.id);
      const total = row === null ? 0 : totalOf(row.id);
      if (pages !== null && total > 0)
        pages.scrollLeft = Math.max(0, row.ratio * total - row.x);
    }
  }

  function init(doc, win) {
    if (win.__sigkStripZoomReady === true)
      return false;
    const node = doc.getElementById('strips');
    if (node === null)
      return false;
    win.__sigkStripZoomReady = true;
    el = { strips: node };
    // 倍率が変わったら帯を組み直す（隠れている間は、出したときに組み直す）。
    root.SigK.toolsZoom.onChange(() => strips().sync());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripZoom = { init, capture, restore };
})(typeof window !== 'undefined' ? window : globalThis);
