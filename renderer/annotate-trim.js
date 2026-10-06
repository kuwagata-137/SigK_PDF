(function (root) {
  'use strict';

  // トリミングの枠の押し離し（spec-4b-6a 確定事項12〜16・26。決定64 ①。見本 screenshots/phase4b-6-trim-frame.png）。
  //
  // 紙の上を左ボタンで引くと、そのページに枠を出す（3px を超えて動かしてから）。枠があるとき、つまみを掴むと大きさを、中を掴むと
  // 位置を変え、枠の外を引くと引き直す（別のページでも）。Esc・［取消］・道具やモードを替える・左＋右・取り消しとやり直しの前・
  // 保存と印刷の前は枠を捨てる。枠は紙の座標（回す前・pt）で持ち、倍率が変わったら描き直す。枠を px で動かす計算は trim-drag.js、
  // 描き方は trim-frame.js、Enter と［適用］で切るのは trim-tool.js。

  const state = {
    doc: null,
    // 枠 { index（表示上のページ）, box（紙の座標の [x1, y1, x2, y2]）}。無ければ null。
    frame: null,
    // 押して引いているもの { index, node, scale, hit（'draw'＝引き直す・つまみの名前・'inside'）, start, origin（掴んだときの枠の px）,
    // before（押す前の枠）, moved }。無ければ null。
    drag: null,
  };

  function viewer() {
    return root.SigK.viewer;
  }

  function drag() {
    return root.SigK.trimDrag;
  }

  function active() {
    return root.SigK.annotate?.getTool() === 'trim' && state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function viewportOf(index) {
    return root.SigK.freeTextEditor?.pageOf(index)?.viewport ?? viewer()?.getTextLayer(index)?.viewport ?? null;
  }

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  function draw(node, viewport) {
    root.SigK.trimFrame.draw(node, drag().rectOf(state.frame.box, viewport), viewport, root.SigK.trimTool.labelOf(state.frame));
  }

  // 枠を描き直し、右パネルを合わせる。枠のページを描いていなければ、描いたとき（onPageRendered）に描く。
  function changed() {
    const node = state.frame === null ? null : state.doc?.querySelector(`.pdf-page[data-page="${state.frame.index + 1}"]`) ?? null;
    const viewport = state.frame === null ? null : viewportOf(state.frame.index);
    root.SigK.trimFrame.clear(state.doc, viewport === null ? null : node);
    if (node !== null && viewport !== null)
      draw(node, viewport);
    root.SigK.trimProps?.refresh();
  }

  // 押していないとき、枠のつまみと中の上でカーソルを替える（確定事項13）。
  function hover(event) {
    const page = active() && state.frame !== null ? root.SigK.annotatePress.pageAt(event) : null;
    const viewport = page !== null && page.index === state.frame.index ? viewportOf(page.index) : null;
    root.SigK.trimFrame.setCursor(state.doc, viewport === null ? null : drag().cursorOf(drag().hitOf(drag().rectOf(state.frame.box, viewport), page.point)));
  }

  // トリミングを持って紙の上を左ボタンで押した。始めたら true（ほかの押下の経路へは流さない）。紙の外なら false。
  function begin(event) {
    if (!active() || viewer()?.getState().open !== true)
      return false;
    const page = root.SigK.annotatePress.pageAt(event);
    if (page === null)
      return false;
    event.preventDefault();
    // 差し込んだ未保存のページは切らない（確定事項16）。
    if (!Number.isInteger(viewer().getPlan()[page.index]?.src)) {
      root.SigK.viewBanner?.show('差し込んだページは、保存してから切ってください。', { tone: 'warn' });
      return true;
    }
    const viewport = viewportOf(page.index);
    if (viewport === null)
      return true;
    const origin = state.frame?.index === page.index ? drag().rectOf(state.frame.box, viewport) : null;
    const hit = drag().hitOf(origin, page.point) ?? 'draw';
    state.drag = { index: page.index, node: page.node, scale: viewport.scale, hit, start: page.point, origin, before: state.frame, moved: false };
    return true;
  }

  // 引いている点 point まで枠を動かす。3px を超えて動くまでは何もしない（false）。
  function follow(point) {
    const current = state.drag;
    const viewport = viewportOf(current.index);
    const delta = [point[0] - current.start[0], point[1] - current.start[1]];
    const slop = root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
    if (!current.moved && Math.abs(delta[0]) <= slop && Math.abs(delta[1]) <= slop)
      return false;
    current.moved = true;
    const size = { width: viewport.width, height: viewport.height };
    const min = drag().minOf(viewport);
    const rect = current.hit === 'draw' ? drag().rectFrom(current.start, point, size, min) : drag().dragRect(current.origin, current.hit, delta, size, min);
    const box = drag().boxOf(rect, viewport);
    if (box !== null)
      state.frame = { index: current.index, box };
    return true;
  }

  // 倍率が変わった・ページが捨てられた（引く前の枠に戻す。確定事項15）。
  function lost() {
    const current = state.drag;
    return current.node.isConnected !== true || viewportOf(current.index)?.scale !== current.scale;
  }

  function restore() {
    state.frame = state.drag.before;
    state.drag = null;
    changed();
  }

  // 動かした。引いていなければカーソルだけ合わせて false。左を離したのが届かなかった（窓の外で離した）ら、今の枠で終える。
  function move(event) {
    if (state.drag === null) {
      hover(event);
      return false;
    }
    if (lost()) {
      restore();
      return true;
    }
    if (((event.buttons ?? 0) & 1) === 0) {
      state.drag = null;
      changed();
      return false;
    }
    if (follow(pointIn(state.drag.node, event)))
      changed();
    return true;
  }

  // 離した。引いていれば true（押し離しの残りの経路へは流さない）。
  function end(event) {
    if (state.drag === null)
      return false;
    if (lost()) {
      restore();
      return true;
    }
    follow(pointIn(state.drag.node, event));
    state.drag = null;
    changed();
    return true;
  }

  // Esc の 1 段目: 引いている途中なら引く前の枠へ戻す（確定事項15）。
  function cancelDrag() {
    if (state.drag === null)
      return false;
    restore();
    return true;
  }

  // 枠を取り出して消す（Enter・［適用］で切る前。trim-tool.js）。引いている途中もやめる。無ければ null。Esc の 2 段目と［取消］の
  // dropFrame もこれで消す。
  function takeFrame() {
    const frame = state.frame;
    const had = frame !== null || state.drag !== null;
    state.frame = null;
    state.drag = null;
    if (had)
      changed();
    return frame;
  }

  // 道具やモードを替える・左＋右・取り消しとやり直しの前・保存と印刷の前: 引いている途中も枠も捨てる。捨てたら true。
  function discard() {
    const had = state.frame !== null || state.drag !== null;
    takeFrame();
    root.SigK.trimFrame.setCursor(state.doc, null);
    return had;
  }

  // ページを描いた（page-render.js）。枠のページなら描き直す（倍率の変更・スクロールで描き直したとき）。
  function onPageRendered(index, node, viewport) {
    if (state.frame?.index === index)
      draw(node, viewport);
  }

  function init(doc, win) {
    if (win.__sigkAnnotateTrimReady === true)
      return false;
    win.__sigkAnnotateTrimReady = true;
    state.doc = doc;
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTrim = {
    init, begin, move, end, cancelDrag, takeFrame, discard, onPageRendered,
    dropFrame: () => takeFrame() !== null,
    getFrame: () => (state.frame === null ? null : { index: state.frame.index, box: [...state.frame.box] }),
    hasFrame: () => state.frame !== null,
    isDragging: () => state.drag !== null,
  };
})(typeof window !== 'undefined' ? window : globalThis);
