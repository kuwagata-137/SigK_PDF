(function (root) {
  'use strict';

  // 注釈モードのページビューの押し離し（spec-4-1 確定事項6・10、spec-4-2 確定事項3・5・6、spec-4-3 確定事項3・5、
  // spec-4-4 確定事項2・7）。
  //
  // annotate.js から切り出した。mousedown／mouseup／dblclick を #view に結び、
  //   - 押したとき: 選んでいるテキスト・図形の上ならドラッグ移動の準備、そうでなく図形・ペンの
  //     道具を持っていれば描き始める（動かすたびに下書きを描き直す）
  //   - 離したとき: 描いていて動いていれば注釈にする → 道具があり文字が選ばれていれば
  //     マークアップを作る → 動いていない押し離しなら当たり判定で選ぶ → 何も無い場所で
  //     テキストの道具ならそこに置く（ノートの道具なら付箋を置く）
  //   - 選んでいるテキスト・図形・ノートを掴んで動かしたら、離したときに 1 世代（ドラッグ移動）
  //   - ダブルクリックしたテキストは入力欄を開く（ノートは右パネルの「本文」欄へ）
  // に振り分ける。判断そのものは annotate.js・annotate-text.js・annotate-shape.js が、描く押し離しは annotate-draw.js が、
  // 掴んで動かす処理は annotate-grab.js が持つ。

  // 押して離すまでの動きがこれ以下なら「押した」と見なす（CSS px）。
  const CLICK_SLOP = 3;

  const state = {
    doc: null,
    win: null,
    // 押した位置。離したときに動いていなければ当たり判定へ回す。
    pressed: null,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function annotateText() {
    return root.SigK.annotateText;
  }

  function annotateNote() {
    return root.SigK.annotateNote;
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

  // ---- ドラッグ移動（spec-4-2 確定事項6、spec-4-3 確定事項5。annotate-grab.js） ----

  function grab() {
    return root.SigK.annotateGrab;
  }

  // つまみで大きさ・向き・端を変える（spec-4b-2。annotate-transform.js）。
  function transform() {
    return root.SigK.annotateTransform;
  }

  // 図形・ペンを描く押し離し（spec-4-3 確定事項3。annotate-draw.js）。
  function draw() {
    return root.SigK.annotateDraw;
  }

  // ---- 押し離し ----

  // 書き込みを描く・置く・掴む・選ぶのは左ボタンだけ（決定52 ⑥。spec-4b-3a 確定事項B1）。
  function isLeft(event) {
    return (event.button ?? 0) === 0;
  }

  // テキストの入力欄の中の押し離しは入力欄に任せる（spec-4b-3a 確定事項B2。直しているテキスト自身を掴まないため）。
  function inEditor(event) {
    return (event.target?.closest?.('.free-text-editor') ?? null) !== null;
  }

  function onMouseDown(event) {
    if (editor()?.takeSwallow() === true || !isLeft(event) || inEditor(event)) {
      state.pressed = null;
      return;
    }
    if (!inAnnotMode() || !isOpen()) {
      state.pressed = null;
      return;
    }
    // 選んでいる書き込みのつまみは、本体や紙の外より先に見る（spec-4b-2 確定事項15）。
    if (transform()?.begin(event) === true) {
      state.pressed = null;
      return;
    }
    const page = pageAt(event);
    const hit = page === null ? null : annotate().hitTest(page.index, page.point);
    const wasSelected = hit !== null && annotate().isSelected(hit);
    state.pressed = { x: event.clientX, y: event.clientY, ctrl: event.ctrlKey === true, hit, wasSelected };
    if (page === null)
      return;
    // Ctrl＋押下は選択の足し引き（確定事項B3）。まだ選んでいなければ押したときに足す。描き始めない。
    if (event.ctrlKey === true) {
      if (hit !== null && !wasSelected)
        annotate().addKey(hit);
      return;
    }
    if (hit !== null && hit === annotate().getSelected()) {
      grab().begin(event, page, hit);
      return;
    }
    const tool = annotate().getTool();
    if (tool === 'shape' || tool === 'pen')
      draw().begin(event, page);
  }

  // Ctrl＋クリックを離した（確定事項B3）。選んでいたものを動かさずに離したら外す。書き込みの無い所なら何もしない。
  function releaseCtrl(pressed) {
    if (pressed.hit !== null && pressed.wasSelected)
      annotate().toggleKey(pressed.hit);
  }

  // 離したとき: 道具があり文字が選ばれていれば作る（spec-4-1 確定事項10 ①）。選ばれて
  // いなければ、動いていない押し離しを当たり判定へ回す（確定事項6）。当たらず、テキストの
  // 道具を持っていればそこに置く（spec-4-2 確定事項3）。左ボタンの離しだけを見る（spec-4b-3a 確定事項B1）。
  function onMouseUp(event) {
    if (!isLeft(event))
      return;
    const pressed = state.pressed;
    state.pressed = null;
    if (transform()?.end(event) === true || grab().end(event) || draw().end(event))
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
    if (pressed.ctrl) {
      releaseCtrl(pressed);
      return;
    }
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
    if (tool === 'note') {
      annotateNote()?.place({ index: page.index, point: page.point });
      return;
    }
    annotate().select(null);
  }

  // ダブルクリックしたテキストは入力欄を開く（spec-4-2 確定事項5）。ノートは「本文」欄へ（spec-4-4 確定事項7）。
  function onDoubleClick(event) {
    if (!inAnnotMode() || !isOpen())
      return;
    const page = pageAt(event);
    if (page === null)
      return;
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null && (annotateText()?.beginEdit(hit) === true || annotateNote()?.beginEdit(hit) === true))
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
      if (transform()?.move(event) === true)
        return;
      grab().move(event);
      draw().move(event);
      // つまみの上のカーソル（掴んでいない・描いていないとき）。
      if (inAnnotMode() && !grab().isGrabbing() && !draw().isDrawing())
        transform()?.hover(event);
    });
    doc.addEventListener('mouseup', (event) => {
      const busy = grab().isGrabbing() || draw().isDrawing() || transform()?.isDragging() === true;
      if (busy && !(view?.contains(event.target) ?? false))
        onMouseUp(event);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePointer = { CLICK_SLOP, init, isDragging: () => grab().isGrabbing(), isDrawing: () => draw().isDrawing() };
})(typeof window !== 'undefined' ? window : globalThis);
