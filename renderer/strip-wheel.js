(function (root) {
  'use strict';

  // ツールモードの帯で、ページが横に並ぶ段（PDF の帯の .strip-pages と「変換する画像」の帯の .img-strip-items）にカーソルがあるとき、
  // 素のマウスホイールで段を左右に送る（spec-7-4 確定事項ST1。質問 ST1 の答え「案A ページ段横移動」）。
  //
  // - 見出しの行（番号・ファイル名・ボタン）と、帯の外では、今までどおり帯の並び全体が上下に動く（止めない）。
  // - 段にページが全部収まっている（左右に動く余地が無い）ときも、上下に動く。
  // - 左右の端まで送ったあとは、上下には移らない（段の上では上下に動かさない）。
  // - Ctrl＋ホイールは紙の倍率（tools-zoom.js）、Shift＋ホイールとタッチパッドの横の動きは Chromium が左右に送るので、ここでは触らない。

  const LINE_PX = 40;

  let el = null;

  function rowOf(target) {
    return target?.closest?.('.strip-pages, .img-strip-items') ?? null;
  }

  // ホイールの量を画素にそろえる（deltaMode 0＝画素、1＝行、2＝ページ）。
  function pixelsOf(event, row) {
    if (event.deltaMode === 1)
      return event.deltaY * LINE_PX;
    if (event.deltaMode === 2)
      return event.deltaY * row.clientWidth;
    return event.deltaY;
  }

  // 左右に動く余地があるか。
  function canScroll(row) {
    return row.scrollWidth - row.clientWidth > 1;
  }

  // 段の上の素のホイールなら左右に送って true（既定の上下の動きは止める）。ほかは false で、既定の動きに任せる。
  function onWheel(event) {
    if (event.ctrlKey === true || event.shiftKey === true || event.deltaY === 0)
      return false;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY))
      return false;
    const row = rowOf(event.target);
    if (row === null || !canScroll(row))
      return false;
    event.preventDefault();
    const max = row.scrollWidth - row.clientWidth;
    row.scrollLeft = Math.min(max, Math.max(0, row.scrollLeft + pixelsOf(event, row)));
    return true;
  }

  function init(doc, win) {
    if (win.__sigkStripWheelReady === true)
      return false;
    const strips = doc.getElementById('strips');
    if (strips === null)
      return false;
    win.__sigkStripWheelReady = true;
    el = { doc, strips };
    // 既定の上下の動きを止めるので、passive にしない。
    strips.addEventListener('wheel', onWheel, { passive: false });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripWheel = { LINE_PX, init, onWheel, isReady: () => el !== null };
})(typeof window !== 'undefined' ? window : globalThis);
