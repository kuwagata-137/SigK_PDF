(function (root) {
  'use strict';

  // テキストの幅のつまみを引いたときの形（spec-4b-4a 確定事項F2〜F4・A2）。DOM に触れない（行と箱は free-text-metrics.js）。
  // annotate-transform.js が、引いている間の下見と離したときの 1 世代にこの patch を使う。
  //
  // 引いた量は、表示の右の向きに沿った分だけを見る（文字の向き。上下に動かしても幅は変わらない）。右のつまみは中身の左を、
  // 左のつまみは中身の右を動かさない（回したテキストは紙の上でも。spec-4b-4b 確定事項B1）。幅は固定の幅になり（今までの形も、
  // 自動の幅も）、下限は 1 字、0.01pt に丸める。

  function metrics() {
    return root.SigK.freeTextMetrics;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 今の中身の幅（pt）。固定ならその幅、自動と今までの形は最長行の幅。
  function contentWidthOf(entry) {
    return typeof entry.width === 'number' ? entry.width : metrics().layoutOfEntry(entry).contentWidth;
  }

  // side は 'left' か 'right'、press・point は押した点と今の点（表示の座標）。形が変わらなければ null。
  function widthPatch(entry, side, press, point, viewport) {
    if (entry?.kind !== 'text' || (side !== 'left' && side !== 'right'))
      return null;
    const { right } = root.SigK.freeTextHandles.boxOf(entry, viewport);
    const moved = ((point[0] - press[0]) * right[0] + (point[1] - press[1]) * right[1]) / (viewport.scale ?? 1);
    const before = contentWidthOf(entry);
    // 開き直したときに自動の幅と見誤られない値にする（free-text-metrics.js の keepFixed）。
    const width = metrics().keepFixed(entry, round(Math.max(entry.fontSize, before + (side === 'right' ? moved : -moved))));
    if (width === entry.width)
      return null;
    const next = { ...entry, width };
    const origin = root.SigK.freeTextLayout.shiftOrigin(root.SigK.freeTextGeometry.frameOrigin(entry.rect, entry.rotation), entry.rotation,
      [side === 'left' ? round(before - width) : 0, 0]);
    return { width, ...metrics().turned(entry, root.SigK.freeTextLayout.frameOf(origin, metrics().sizeOf(next), entry.rotation)) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextResize = { contentWidthOf, widthPatch };
})(typeof window !== 'undefined' ? window : globalThis);
