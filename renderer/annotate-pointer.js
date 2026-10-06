(function (root) {
  'use strict';

  // 注釈モードのページビューの押し離し（spec-4-1 確定事項6・10、spec-4-2 確定事項3・5・6、spec-4-3 確定事項3・5、
  // spec-4-4 確定事項2・7、spec-4b-3a 確定事項B、spec-4b-3b 確定事項A・F）。
  //
  // annotate.js から切り出した。mousedown／mouseup／dblclick を #view に結び、文書の mousemove／mouseup で、押して引いている
  // 操作（表示を引く・つまみ・範囲選択・掴んで動かす・描く）を進めて終える。書き込みを描く・置く・掴む・選ぶのは左ボタンだけで、
  // テキストの入力欄の中の押し離しは入力欄に任せる（spec-4b-3a 確定事項B1・B2）。押した・離したときの判断は annotate-press.js、
  // 押して引いている操作の「動かす」と「離す」の振り分けは annotate-drag-route.js（spec-4b-5b b0）が持つ。
  // ダブルクリックしたテキストは入力欄を開く（ノートは右パネルの「本文」欄へ）。
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

  function route() {
    return root.SigK.annotateDragRoute;
  }

  function hand() {
    return root.SigK.annotateHand;
  }

  function rightButton() {
    return root.SigK.annotateRightButton;
  }

  // 離した所に頂点・終点を置く途中の操作（描いている多角形・始点合わせ。spec-4b-5a 確定事項13〜19）。
  function placing() {
    return root.SigK.annotatePlacing;
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
    // 入力欄を閉じた押し（spec-4-2 確定事項8）と、メニューを閉じた左の押し（spec-4b-3b 確定事項D9）は飲む。印はどちらも取る。
    const closedEditor = editor()?.takeSwallow() === true;
    const closedMenu = root.SigK.annotationMenu?.takeSwallow() === true;
    // 左と右の両方が押されたら、押している操作を取りやめて道具を切り替える（spec-4b-3b 確定事項E）。
    if (rightButton()?.isChord(event) === true) {
      rightButton().chord(event);
      press().reset();
      return;
    }
    // 右は right-button へ（spec-4b-3b 確定事項D1・D6）。中ボタンなど、ほかのボタンは何もしない。描いている途中の多角形は、右の押しで
    // やめてメニューを出さない（spec-4b-5a 確定事項16）。
    const dropped = (event.button ?? 0) === 2 && placing()?.cancel() === true;
    if ((event.button ?? 0) === 2)
      rightButton()?.down(event, { swallowed: closedEditor || closedMenu || dropped });
    if (closedEditor || closedMenu || !isLeft(event) || inEditor(event) || !inAnnotMode() || !isOpen()) {
      press().reset();
      return;
    }
    // 描いている途中の多角形と始点合わせは、つまみも書き込みも見ずに、離したときに頂点・終点を置く（spec-4b-5a 確定事項17・19）。
    if (placing()?.isActive() === true) {
      event.preventDefault();
      press().reset();
      return;
    }
    // ハンドは #view のどこを押しても表示を引く。書き込みは見ない（spec-4b-3b 確定事項A3・A4）。
    if (holdingHand()) {
      hand().begin(event);
      press().reset();
      return;
    }
    // 消しゴム・モザイク・トリミングは書き込みを選ばず掴まず、つまみも見ずに始める。紙の外（はみ出したつまみの上も）では何もしない
    // （spec-4b-5b 確定事項21・点検 2・7、spec-4b-6a 確定事項12、spec-4b-6b 確定事項11）。
    const gesture = { eraser: 'annotateErase', mosaic: 'annotateMosaic', trim: 'annotateTrim' }[annotate().getTool()];
    if (gesture !== undefined) {
      root.SigK[gesture]?.begin(event);
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
    // 左＋右の後は、全部のボタンを離すまで捨てる（spec-4b-3b 確定事項E2）。
    if (rightButton()?.takeChordUp(event) === true || !isLeft(event))
      return;
    const pressed = press().take();
    if (route().end(event))
      return;
    if (!inAnnotMode() || !isOpen())
      return;
    press().up(event, pressed);
  }

  // ダブルクリックしたテキストは入力欄を開く（spec-4-2 確定事項5）。ノートは「本文」欄へ（spec-4-4 確定事項7）。
  // 左＋右の最中と直後のダブルクリック（左＋右の左の押しと続けた押しで出る）は捨てる（spec-4b-3b 確定事項E4）。
  function onDoubleClick(event) {
    if (!inAnnotMode() || !isOpen() || holdingHand() || ['eraser', 'mosaic', 'trim'].includes(annotate().getTool()) || rightButton()?.recentlyChorded() === true)
      return;
    // 描いている途中の多角形は、開いたまま確定する（spec-4b-5a 確定事項15）。直線・矢印の道具では、書き込みの端・角・頂点の近くを
    // 始点にして引き始める（確定事項19）。
    if (placing()?.doubleClick(event) === true)
      return;
    const page = press().pageAt(event);
    if (page === null)
      return;
    const hit = annotate().hitTest(page.index, page.point);
    if (hit !== null && (root.SigK.annotateText?.beginEdit(hit) === true || root.SigK.annotateNote?.beginEdit(hit) === true))
      event.preventDefault();
  }

  // 押して引いている操作を進める。左＋右の後なら文字の選択を外すだけ。
  function onMouseMove(event) {
    if (rightButton()?.whileChord(event) === true)
      return;
    route().move(event, state.doc);
  }

  function init(doc, win) {
    if (win.__sigkAnnotatePointerReady === true)
      return false;
    win.__sigkAnnotatePointerReady = true;
    state.doc = doc;
    press().init(win);
    grab().init(doc);
    hand().init(doc, win);
    const view = doc.getElementById('view');
    view?.addEventListener('mousedown', onMouseDown);
    view?.addEventListener('mouseup', onMouseUp);
    view?.addEventListener('dblclick', onDoubleClick);
    // ドラッグ中・描いている間はページビューの外で離しても拾う。
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', (event) => {
      if (route().isBusy() && !(view?.contains(event.target) ?? false))
        onMouseUp(event);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotatePointer = { CLICK_SLOP, init, isDragging: () => grab().isGrabbing(), isDrawing: () => draw().isDrawing() };
})(typeof window !== 'undefined' ? window : globalThis);
