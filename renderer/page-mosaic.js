(function (root) {
  'use strict';

  // モザイクの純関数（spec-4b-6b 確定事項1・3・4・5・18）。DOM にも pdf.js にも触れない。
  //
  // plan の元ファイルのページの要素は、モザイクの並び mosaic: [{ box, block }] を持てる。box は紙の座標（回す前・pt。x1 < x2・y1 < y2・
  // 小数 2 桁）の [x1, y1, x2, y2]、block はブロックの一辺（pt）。置いた順に並べ、外したら欄を消す（空の配列にはしない）。
  // 箱の正規化と重なりは page-crop.js を使う。

  // 粗さ 3 段（決定64 ⑦。細かい 4pt・ふつう 8pt・粗い 14pt。既定ふつう）。
  const BLOCKS = Object.freeze({ fine: 4, normal: 8, coarse: 14 });
  const DEFAULT_BLOCK = BLOCKS.normal;
  const BLOCK_SIZES = Object.freeze(Object.values(BLOCKS));

  // ブロックの端を区切るときに、浮動小数の誤差で幅 0 の半端を作らないための遊び（pt）。
  const EPSILON = 1e-6;
  // 確認の文で名指しするページの数（確定事項18。超えたら「ほか」）。
  const NAMED_PAGES = 4;

  function crop() {
    return root.SigK.pageCrop;
  }

  function isBlock(value) {
    return BLOCK_SIZES.includes(value);
  }

  function countOf(entry) {
    return Array.isArray(entry?.mosaic) ? entry.mosaic.length : 0;
  }

  // plan の要素へモザイクを 1 つ足した写し（確定事項1・4）。box は見える範囲 visible に収める。差し込んだページ・粗さが
  // 3 段のどれでもない・収めて幅か高さが 0 なら null。
  function withMosaic(entry, box, block, visible) {
    if (!Number.isInteger(entry?.src) || !isBlock(block))
      return null;
    const clipped = crop().intersectBox(box, visible);
    if (clipped === null)
      return null;
    const before = (entry.mosaic ?? []).map((item) => ({ box: [...item.box], block: item.block }));
    return { ...entry, mosaic: [...before, { box: clipped, block }] };
  }

  // そのページのモザイクを全部外した写し（確定事項16）。
  function withoutMosaic(entry) {
    const next = { ...entry };
    delete next.mosaic;
    return next;
  }

  // 長さ length を step ごとに区切った距離（0 と length を含む）。最後は半端でもよい。i * step で求め、足し算の誤差をためない。
  function stepsOf(length, step) {
    const steps = [0];
    for (let i = 1; i * step < length - EPSILON; i += 1)
      steps.push(i * step);
    steps.push(length);
    return steps;
  }

  // 範囲 box のブロックの区切り（確定事項3・5）。範囲の左上（x1, y2）から block pt ごとに、xs は右へ、ys は下へ（y は減る）。
  // 右と下の端は半端なブロック。紙の座標で決めるので、倍率・回転・保存の画像でも同じ所で区切る。箱か block が正しくなければ null。
  function gridOf(box, block) {
    const b = crop().normalizeBox(box);
    if (b === null || !(block > 0))
      return null;
    return {
      xs: stepsOf(b[2] - b[0], block).map((d, i, all) => (i === all.length - 1 ? b[2] : b[0] + d)),
      ys: stepsOf(b[3] - b[1], block).map((d, i, all) => (i === all.length - 1 ? b[1] : b[3] - d)),
    };
  }

  // モザイクのあるページの位置（今の並びの 0 始まり。確定事項18・25）。
  function indicesOf(plan) {
    return (plan ?? []).flatMap((entry, index) => (countOf(entry) > 0 ? [index] : []));
  }

  // 確認の文の「1・3 ページ目」。NAMED_PAGES を超えたら「1・3・5・7 ページ目ほか」。positions は 0 始まり。
  function pagesLabel(positions) {
    const named = positions.slice(0, NAMED_PAGES).map((index) => index + 1).join('・');
    return `${named} ページ目${positions.length > NAMED_PAGES ? 'ほか' : ''}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageMosaic = { BLOCKS, DEFAULT_BLOCK, BLOCK_SIZES, isBlock, countOf, withMosaic, withoutMosaic, gridOf, indicesOf, pagesLabel };
})(typeof window !== 'undefined' ? window : globalThis);
