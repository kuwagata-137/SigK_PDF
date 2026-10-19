(function (root) {
  'use strict';

  // 説明の吹き出しの置き場所（spec-2-5 J4・J9）。DOM に触れない（対象の矩形と画面の大きさは呼び手が測って渡す）。
  //
  //   下に入る                → 対象の下 GAP（8px）に出す。
  //   下に入らず、上に入る    → 対象の上 GAP に出す（画面の下の端のファイル名など）。
  //   上にも下にも入らない    → 下に出して、画面の中へ押し込む。
  //
  // 左端は対象の中心から LEAD（24px）左。画面の左右の端から MARGIN（8px）離す。矢印は対象の中心を指し、吹き出しの端から ARROW_INSET（14px）より内側に収める。
  // anchor は対象の矩形 { left, top, right, bottom }、size は吹き出しの { width, height }、viewport は画面の { width, height }（すべて px）。

  const GAP = 8;
  const MARGIN = 8;
  const ARROW_INSET = 14;
  const LEAD = 24;

  // value を [low, high] に収める。high が low より小さいとき（説明の吹き出しが画面より広いとき）は low を取る。
  function clamp(value, low, high) {
    return Math.max(low, Math.min(value, high));
  }

  // 横の置き場所 { left, arrowX }。
  function placeAcross(anchor, size, viewport) {
    const centerX = (anchor.left + anchor.right) / 2;
    const left = clamp(centerX - LEAD, MARGIN, viewport.width - MARGIN - size.width);
    const arrowX = clamp(centerX - left, ARROW_INSET, size.width - ARROW_INSET);
    return { left, arrowX };
  }

  // 縦の置き場所 { top, side }。下に入れば下、入らず上に入れば上、どちらも入らなければ下に出して画面の中へ押し込む。
  function placeVertical(anchor, size, viewport) {
    const below = anchor.bottom + GAP;
    if (below + size.height <= viewport.height - MARGIN)
      return { top: below, side: 'below' };
    const above = anchor.top - GAP - size.height;
    if (above >= MARGIN)
      return { top: above, side: 'above' };
    return { top: clamp(below, MARGIN, viewport.height - MARGIN - size.height), side: 'below' };
  }

  // 説明の吹き出しの画面の中の位置 { left, top, side, arrowX }。side は 'below'（対象の下）か 'above'（対象の上）。
  function place({ anchor, size, viewport }) {
    const across = placeAcross(anchor, size, viewport);
    const down = placeVertical(anchor, size, viewport);
    return { left: across.left, top: down.top, side: down.side, arrowX: across.arrowX };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipPlace = { GAP, MARGIN, ARROW_INSET, LEAD, place };
})(typeof window !== 'undefined' ? window : globalThis);
