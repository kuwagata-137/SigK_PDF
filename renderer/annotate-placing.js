(function (root) {
  'use strict';

  // 離した所に頂点・終点を置く途中の操作（描いている多角形と、線の始点合わせ。spec-4b-5a 確定事項13〜19）の振り分け。
  //
  // annotate-pointer.js が 200 行を超えたので、2 つへの振り分けをここへまとめた。どちらも押しでは何もせず（つまみ・書き込みも見ない）、
  // 離したときに置き、ダブルクリック・動き・右の押しを受ける。中身は annotate-polygon.js と annotate-line-anchor.js。

  function polygon() {
    return root.SigK.annotatePolygon;
  }

  function anchor() {
    return root.SigK.annotateLineAnchor;
  }

  // 多角形を描いているか、始点合わせの始点を決めたか。
  function isActive() {
    return polygon()?.isDrawing() === true || anchor()?.isActive() === true;
  }

  // 右の押しなどでやめる。やめたら true（右クリックのメニューを出さない）。
  function cancel() {
    const dropped = polygon()?.cancel() === true;
    return anchor()?.cancel() === true || dropped;
  }

  // 左ボタンの離し。どちらかが受けたら true（ほかの経路へは流さない）。
  function release(event) {
    return polygon()?.release(event) === true || anchor()?.release(event) === true;
  }

  // ダブルクリック。描いている多角形を開いたまま確定するか、直線・矢印の道具で始点合わせを始めたら true。
  function doubleClick(event) {
    return polygon()?.doubleClick(event) === true || anchor()?.tryStart(event) === true;
  }

  function move(event) {
    polygon()?.move(event);
    anchor()?.move(event);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePlacing = { isActive, cancel, release, doubleClick, move };
})(typeof window !== 'undefined' ? window : globalThis);
