(function (root) {
  'use strict';

  // 図形・ペンを描く押し離し（spec-4-3 確定事項3）。押したら下書きを始め、動かすたびに描き直し、離したら注釈にする。
  //
  // annotate-pointer.js から移した（spec-4b-3a。中身は変えていない）。判断そのものは annotate-shape.js が持つ。

  const state = {
    // 描いている図形・ペンのページの枠（表示の座標に直すのに使う）。
    drawing: null,
  };

  function annotateShape() {
    return root.SigK.annotateShape;
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  // 図形・ペンの道具を持って紙の上で押したら描き始める。文字選択を始めさせない。
  function begin(event, page) {
    if (annotateShape()?.beginDraft({ index: page.index, point: page.point, shift: event.shiftKey }) !== true)
      return false;
    event.preventDefault();
    state.drawing = { node: page.node };
    return true;
  }

  function move(event) {
    if (state.drawing === null)
      return;
    annotateShape().updateDraft(pointIn(state.drawing.node, event), event.shiftKey);
  }

  // 離した。注釈になったら true（押し離しの残りの経路へは流さない）。
  function end(event) {
    const { drawing } = state;
    state.drawing = null;
    if (drawing === null)
      return false;
    return annotateShape().finishDraft(pointIn(drawing.node, event), event.shiftKey);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateDraw = {
    begin,
    move,
    end,
    isDrawing: () => state.drawing !== null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
