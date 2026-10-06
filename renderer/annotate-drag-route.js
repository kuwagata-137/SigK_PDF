(function (root) {
  'use strict';

  // 押して引いている操作の振り分け（spec-4b-3a 確定事項B、spec-4b-3b 確定事項A、spec-4b-5a 確定事項17・19）。
  //
  // 200 行の annotate-pointer.js から移した（spec-4b-5b b0。中身は変えていない）。押したときの振り分けは annotate-pointer.js と
  // annotate-press.js が持ち、ここは押したあとの「動かす」と「離す」だけを持つ。表示を引くのは annotate-hand.js、つまみは
  // annotate-transform.js、範囲選択は annotate-marquee.js、掴んで動かす・写すのは annotate-grab.js、描くのは annotate-draw.js、
  // 離した所に頂点・終点を置く途中の操作（描いている多角形・始点合わせ）は annotate-placing.js。

  function annotate() {
    return root.SigK.annotate;
  }

  function grab() {
    return root.SigK.annotateGrab;
  }

  function transform() {
    return root.SigK.annotateTransform;
  }

  function draw() {
    return root.SigK.annotateDraw;
  }

  function marquee() {
    return root.SigK.annotateMarquee;
  }

  function hand() {
    return root.SigK.annotateHand;
  }

  function placing() {
    return root.SigK.annotatePlacing;
  }

  // 消しゴム（spec-4b-5b 確定事項18〜24）。
  function erase() {
    return root.SigK.annotateErase;
  }

  function inAnnotMode(doc) {
    return doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  // 離した。頂点・終点を置いたか、押して引いている操作を終えたら true（押し離しの残りの経路へは流さない）。
  function end(event) {
    if (placing()?.release(event) === true || erase()?.end(event) === true)
      return true;
    return hand().end() || transform()?.end(event) === true || marquee().end(event) || grab().end(event) || draw().end(event);
  }

  // 押して引いている操作を進める。表示を引く → つまみ → 範囲選択 → 掴む・描く の順。
  function move(event, doc) {
    if (hand().move(event) || erase()?.move(event) === true)
      return;
    if (transform()?.move(event) === true)
      return;
    if (marquee().move(event))
      return;
    grab().move(event);
    draw().move(event);
    placing()?.move(event);
    // つまみの上のカーソル（掴んでいない・描いていないとき）。ハンドと消しゴムのときはつまみを見ないので、残っていれば外す。
    if (inAnnotMode(doc) && ['hand', 'eraser'].includes(annotate().getTool()))
      transform()?.clearCursor();
    else if (inAnnotMode(doc) && !grab().isGrabbing() && !draw().isDrawing())
      transform()?.hover(event);
  }

  function isBusy() {
    return hand().isPanning() || grab().isGrabbing() || draw().isDrawing() || marquee().isActive() || transform()?.isDragging() === true
      || erase()?.isErasing() === true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateDragRoute = { end, move, isBusy };
})(typeof window !== 'undefined' ? window : globalThis);
