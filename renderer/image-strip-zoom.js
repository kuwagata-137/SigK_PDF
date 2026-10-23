(function (root) {
  'use strict';

  // 「変換する画像」の帯の紙の倍率（docs/07 決定83）。画像の枠は 104×72px×ツールモードの紙の倍率（strips.css が --paper-zoom で掛ける）、
  // 間は 12px のまま。見えている画像の数え方（image-strip.js がサムネイルを頼む範囲）と、倍率が変わったときの描き直しを持つ。
  // 大きくした枠でぼやけないよう、頼むサムネイルの大きさは image-thumbs.js が倍率から決める。

  const ITEM_WIDTH = 104;
  const GAP = 12;

  // 画像 1 枚ぶんの横の幅（枠＋間）。100% で 116px。
  const itemStep = () => Math.round(ITEM_WIDTH * (root.SigK.toolsZoom?.get() ?? 1)) + GAP;

  // 見えている画像 [first, last)（左右に prefetch 枚の先読み）。幅が分からない（隠れている・テスト）ときは 8 枚分と見る。
  function visible(items, count, prefetch) {
    const step = itemStep();
    const width = items.clientWidth || step * 8;
    return {
      first: Math.max(0, Math.floor(items.scrollLeft / step) - prefetch),
      last: Math.min(count, Math.ceil((items.scrollLeft + width) / step) + prefetch),
    };
  }

  function init(doc, win) {
    if (win.__sigkImageStripZoomReady === true)
      return false;
    win.__sigkImageStripZoomReady = true;
    // 倍率が変わったら帯を描き直し、新しい大きさのサムネイルを頼む（届くまでは前のサムネイルを引き伸ばして見せる）。
    root.SigK.toolsZoom?.onChange(() => root.SigK.imageStrip?.render());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageStripZoom = { ITEM_WIDTH, GAP, itemStep, visible, init };
})(typeof window !== 'undefined' ? window : globalThis);
