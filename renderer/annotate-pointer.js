(function (root) {
  'use strict';

  // 注釈モードのページビューの押し離し（spec-4-1 確定事項6・10、spec-4-2 確定事項3・5・6、spec-4-3 確定事項3・5、
  // spec-4-4 確定事項2・7、spec-4b-3a 確定事項B、spec-4b-3b 確定事項A・F）。
  //
  // annotate.js から切り出した。mousedown／mouseup／dblclick を #view に結び、文書の mousemove／mouseup で、押して引いている
  // 操作（表示を引く・つまみ・範囲選択・掴んで動かす・描く）を進めて終える。書き込みを描く・置く・掴む・選ぶのは左ボタンだけで、
  // テキストの入力欄の中の押し離しは入力欄に任せる（spec-4b-3a 確定事項B1・B2）。押した・離したときの判断は annotate-press.js、
  // 表示を引くのは annotate-hand.js、つまみは annotate-transform.js、範囲選択は annotate-marquee.js、掴んで動かす・写すのは
  // annotate-grab.js、描くのは annotate-draw.js が持つ。ダブルクリックしたテキストは入力欄を開く（ノートは右パネルの「本文」欄へ）。
  // ハンドを持っているときは、左ボタンでは書き込みを見ない（当たり・つまみ・ダブルクリック・つまみの上のカーソル）。

  // 押して離すまでの動きがこれ以下なら「押した」と見なす（CSS px）。
  const CLICK_SLOP = 3;

  const state = {
    doc: null,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function editor() {
    return root.SigK.freeTextEditor;
  }

  function press() {
    return root.SigK.annotatePress;
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

  function holdingHand() {
    return annotate().getTool() === 'hand';
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return root.SigK.viewer?.getState().open === true;
  }

  // 書き込みを描く・置く・掴む・選ぶのは左ボタンだけ（決定52 ⑥。spec-4b-3a 確定事項B1）。
  function isLeft(event) {
    return (event.button ?? 0) === 0;
  }

  // テキストの入力欄の中の押し離しは入力欄に任せる（spec-4b-3a 確定事項B2。直しているテキスト自身を掴まないため）。
  function inEditor(event) {
    return (event.target?.closest?.('.free-text-editor') ?? null) !== null;
  }

  function onMouseDown(event) {
    // 入力欄を閉じた押しは飲む（spec-4-2 確定事項8）。
    if (editor()?.takeSwallow() === true || !isLeft(event) || inEditor(event) || !inAnnotMode() || !isOpen()) {
      press().reset();
      return;
    }
    // ハンドは #view のどこを押しても表示を引く。書き込みは見ない（spec-4b-3b 確定事項A3・A4）。
    if (holdingHand()) {
      hand().begin(event);
      press().reset();
      return;
    }
    // 選んでいる書き込みのつまみは、本体や紙の外より先に見る（spec-4b-2 確定事項15）。
    if (transform()?.begin(event) === true) {
      press().reset();
      return;
    }
    press().down(event);
  }

  // 左ボタンの離しだけを見る（spec-4b-3a 確定事項B1）。押して引いている操作があれば終えて、残りは annotate-press.js へ。
  function onMouseUp(event) {
    if (!isLeft(event))
      return;
    const pressed = press().take();
    if (hand().end() || transform()?.end(event) === true || marquee().end(event) || grab().end(event) || draw().end(event))
      return;
    if (!inAnnotMode() || !isOpen())
      return;
    press().up(event, pressed);
  }

  // ダブルクリックしたテキストは入力欄を開く（spec-4-2 確定事項5）。ノートは「本文」欄へ（spec-4-4 確定事項7）。
  function onDoubleClick(event) {
    if (!inAnnotMode() || !isOpen() || holdingHand())
      return;
    const page = press().pageAt(event);
    if (page === null)
      return;
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null && (root.SigK.annotateText?.beginEdit(hit) === true || root.SigK.annotateNote?.beginEdit(hit) === true))
      event.preventDefault();
  }

  // 押して引いている操作を進める。表示を引く → つまみ → 範囲選択 → 掴む・描く の順。
  function onMouseMove(event) {
    if (hand().move(event))
      return;
    if (transform()?.move(event) === true)
      return;
    if (marquee().move(event))
      return;
    grab().move(event);
    draw().move(event);
    // つまみの上のカーソル（掴んでいない・描いていないとき。ハンドのときは見ない）。
    if (inAnnotMode() && !holdingHand() && !grab().isGrabbing() && !draw().isDrawing())
      transform()?.hover(event);
  }

  function isBusy() {
    return hand().isPanning() || grab().isGrabbing() || draw().isDrawing() || marquee().isActive() || transform()?.isDragging() === true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotatePointerReady === true)
      return false;
    win.__sigkAnnotatePointerReady = true;
    state.doc = doc;
    press().init(win);
    grab().init(doc);
    hand().init(doc);
    const view = doc.getElementById('view');
    view?.addEventListener('mousedown', onMouseDown);
    view?.addEventListener('mouseup', onMouseUp);
    view?.addEventListener('dblclick', onDoubleClick);
    // ドラッグ中・描いている間はページビューの外で離しても拾う。
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', (event) => {
      if (isBusy() && !(view?.contains(event.target) ?? false))
        onMouseUp(event);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePointer = { CLICK_SLOP, init, isDragging: () => grab().isGrabbing(), isDrawing: () => draw().isDrawing() };
})(typeof window !== 'undefined' ? window : globalThis);
