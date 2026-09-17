(function (root) {
  'use strict';

  // 注釈モードのページビューの押し離し（spec-4-1 確定事項6・10、spec-4-2 確定事項3・5・6、spec-4-3 確定事項3・5）。
  //
  // annotate.js から切り出した。mousedown／mouseup／dblclick を #view に結び、
  //   - 押したとき: 選んでいるテキスト・図形の上ならドラッグ移動の準備、そうでなく図形・ペンの
  //     道具を持っていれば描き始める（動かすたびに下書きを描き直す）
  //   - 離したとき: 描いていて動いていれば注釈にする → 道具があり文字が選ばれていれば
  //     マークアップを作る → 動いていない押し離しなら当たり判定で選ぶ → 何も無い場所で
  //     テキストの道具ならそこに置く
  //   - 選んでいるテキスト・図形を掴んで動かしたら、離したときに 1 世代（ドラッグ移動）
  //   - ダブルクリックしたテキストは入力欄を開く
  // に振り分ける。判断そのものは annotate.js・annotate-text.js・annotate-shape.js が持つ。

  // 押して離すまでの動きがこれ以下なら「押した」と見なす（CSS px）。
  const CLICK_SLOP = 3;

  const state = {
    doc: null,
    win: null,
    // 押した位置。離したときに動いていなければ当たり判定へ回す。
    pressed: null,
    // 掴んで動かしているテキスト・図形 { key, index, node, viewport, start(px), group }。
    drag: null,
    // 描いている図形・ペンのページの枠（表示の座標に直すのに使う）。
    drawing: null,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function annotateText() {
    return root.SigK.annotateText;
  }

  function annotateShape() {
    return root.SigK.annotateShape;
  }

  function editor() {
    return root.SigK.freeTextEditor;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return viewer()?.getState().open === true;
  }

  // 押した点の .pdf-page とその中の位置（CSS px）。紙の外なら null。
  function pageAt(event) {
    const node = event.target?.closest?.('.pdf-page');
    if (node === null || node === undefined)
      return null;
    const base = node.getBoundingClientRect();
    return { node, index: Number(node.dataset.page) - 1, point: [event.clientX - base.left, event.clientY - base.top] };
  }

  function moved(from, event) {
    return Math.abs(event.clientX - from.x) > CLICK_SLOP || Math.abs(event.clientY - from.y) > CLICK_SLOP;
  }

  // ---- ドラッグ移動（spec-4-2 確定事項6、spec-4-3 確定事項5） ----

  function isMovable(entry) {
    return entry.kind === 'text' || root.SigK.annotationEntry.isDrawnKind(entry.kind);
  }

  // 選んでいるテキスト・図形の上で押したらドラッグの準備。文字選択を始めさせない。
  function beginDrag(event, page, key) {
    const entry = annotate().selectedEntry();
    if (entry === null || !isMovable(entry) || root.SigK.annotationLayer.keyOf(entry) !== key)
      return false;
    const viewport = editor()?.pageOf(page.index)?.viewport ?? viewer().getTextLayer(page.index)?.viewport;
    if (viewport === undefined || viewport === null)
      return false;
    event.preventDefault();
    state.drag = {
      key, index: page.index, viewport,
      start: [event.clientX, event.clientY],
      group: page.node.querySelector(`.annot-layer g[data-annot="${key}"]`),
    };
    return true;
  }

  function onDragMove(event) {
    const { drag } = state;
    if (drag === null || drag.group === null)
      return;
    drag.group.style.transform = `translate(${event.clientX - drag.start[0]}px, ${event.clientY - drag.start[1]}px)`;
  }

  // 離したら紙の座標での差分に直して 1 世代積む。動いていなければ何もしない（選んだまま）。
  function endDrag(event) {
    const { drag } = state;
    state.drag = null;
    if (drag === null)
      return false;
    if (drag.group !== null)
      drag.group.style.transform = '';
    if (!moved({ x: drag.start[0], y: drag.start[1] }, event))
      return false;
    const from = drag.viewport.convertToPdfPoint(drag.start[0], drag.start[1]);
    const to = drag.viewport.convertToPdfPoint(event.clientX, event.clientY);
    const delta = [to[0] - from[0], to[1] - from[1]];
    const entry = annotate().selectedEntry();
    (entry?.kind === 'text' ? annotateText() : annotateShape())?.move(drag.key, delta);
    return true;
  }

  // ---- 描く（spec-4-3 確定事項3） ----

  function pointIn(node, event) {
    const base = node.getBoundingClientRect();
    return [event.clientX - base.left, event.clientY - base.top];
  }

  // 図形・ペンの道具を持って紙の上で押したら描き始める。文字選択を始めさせない。
  function beginDraw(event, page) {
    if (annotateShape()?.beginDraft({ index: page.index, point: page.point, shift: event.shiftKey }) !== true)
      return false;
    event.preventDefault();
    state.drawing = { node: page.node };
    return true;
  }

  function onDrawMove(event) {
    if (state.drawing === null)
      return;
    annotateShape().updateDraft(pointIn(state.drawing.node, event), event.shiftKey);
  }

  // 離した。注釈になったら true（押し離しの残りの経路へは流さない）。
  function endDraw(event) {
    const { drawing } = state;
    state.drawing = null;
    if (drawing === null)
      return false;
    return annotateShape().finishDraft(pointIn(drawing.node, event), event.shiftKey);
  }

  // ---- 押し離し ----

  function onMouseDown(event) {
    if (editor()?.takeSwallow() === true) {
      state.pressed = null;
      return;
    }
    if (!inAnnotMode() || !isOpen()) {
      state.pressed = null;
      return;
    }
    state.pressed = { x: event.clientX, y: event.clientY };
    const page = pageAt(event);
    if (page === null)
      return;
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null && hit === annotate().getSelected()) {
      beginDrag(event, page, hit);
      return;
    }
    const tool = annotate().getTool();
    if (tool === 'shape' || tool === 'pen')
      beginDraw(event, page);
  }

  // 離したとき: 道具があり文字が選ばれていれば作る（spec-4-1 確定事項10 ①）。選ばれて
  // いなければ、動いていない押し離しを当たり判定へ回す（確定事項6）。当たらず、テキストの
  // 道具を持っていればそこに置く（spec-4-2 確定事項3）。
  function onMouseUp(event) {
    const pressed = state.pressed;
    state.pressed = null;
    if (endDrag(event) || endDraw(event))
      return;
    if (!inAnnotMode() || !isOpen())
      return;
    const tool = annotate().getTool();
    if (tool !== null && annotate().isMarkupTool(tool) && annotate().createFromSelection(tool))
      return;
    const selection = state.win?.getSelection?.();
    if (selection !== null && selection !== undefined && !selection.isCollapsed)
      return;
    if (pressed === null || moved(pressed, event))
      return;
    const page = pageAt(event);
    if (page === null) {
      annotate().select(null);
      return;
    }
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null) {
      annotate().select(hit);
      return;
    }
    if (tool === 'text') {
      annotateText()?.place({ index: page.index, point: page.point });
      return;
    }
    annotate().select(null);
  }

  // ダブルクリックしたテキストは入力欄を開く（spec-4-2 確定事項5）。
  function onDoubleClick(event) {
    if (!inAnnotMode() || !isOpen())
      return;
    const page = pageAt(event);
    if (page === null)
      return;
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null && annotateText()?.beginEdit(hit) === true)
      event.preventDefault();
  }

  function init(doc, win) {
    if (win.__sigkAnnotatePointerReady === true)
      return false;
    win.__sigkAnnotatePointerReady = true;
    state.doc = doc;
    state.win = win;
    const view = doc.getElementById('view');
    view?.addEventListener('mousedown', onMouseDown);
    view?.addEventListener('mouseup', onMouseUp);
    view?.addEventListener('dblclick', onDoubleClick);
    // ドラッグ中・描いている間はページビューの外で離しても拾う。
    doc.addEventListener('mousemove', (event) => {
      onDragMove(event);
      onDrawMove(event);
    });
    doc.addEventListener('mouseup', (event) => {
      if ((state.drag !== null || state.drawing !== null) && !(view?.contains(event.target) ?? false))
        onMouseUp(event);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePointer = { CLICK_SLOP, init, isDragging: () => state.drag !== null, isDrawing: () => state.drawing !== null };
})(typeof window !== 'undefined' ? window : globalThis);
