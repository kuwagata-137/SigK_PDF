(function (root) {
  'use strict';

  // 編集モードで紙の上を左ボタンで押した・離したときの振り分け（spec-4-1 確定事項6・10、spec-4-2 確定事項3・6、spec-4-3 確定事項3、
  // spec-4-4 確定事項2、spec-4b-3a 確定事項B・D・F・G）。
  //
  // 200 行を超えた annotate-pointer.js から移した（spec-4b-3a）。ボタン・入力欄・モード・つまみの見張りと、押して引いている操作
  // （範囲選択・掴む・描く・つまみ）を終えるのは annotate-pointer.js が持ち、ここは残りの判断だけを持つ。
  //   - 押したとき: 「選択」の道具で書き込みの無い所なら範囲選択、Ctrl なら足して（引けば写し）、選んでいる書き込みの上なら
  //     まとめて掴み、「選択」の道具と GRAB_TOOLS の道具なら選んで 1 段で掴み、図形・ペンの道具なら描き始める
  //   - 離したとき（動いていない押し離し）: マークアップを作る → Ctrl なら外す → 当たり判定で選ぶ → 何も無い場所で
  //     テキスト・ノートの道具ならそこに置く
  // 押せば書き込みを掴む所かの判定（grabsAt）も持つ。十字矢印のカーソルとハンドの振り分けが使う（決定84）。

  // 選んでいない書き込みでも、動かせるものなら押したときに選んで 1 段で掴む道具（決定84 ④。null は道具なし）。「選択」は
  // 動かせない書き込みも選ぶ（決定53 ⑨）。
  const GRAB_TOOLS = Object.freeze(['select', 'shape', 'hand', null, 'text', 'callout', 'note']);
  // 塗っていない四角・丸は線の上だけを当てる道具（決定84 ②。内側は図形を描く・表示を引く）。
  const OUTLINE_TOOLS = Object.freeze(['shape', 'hand']);
  // 書き込みを選ばず掴まない道具（spec-4b-5b 確定事項21、spec-4b-6a 確定事項12、spec-4b-6b 確定事項11）。
  const NO_GRAB_TOOLS = Object.freeze(['eraser', 'mosaic', 'trim']);

  const state = {
    win: null,
    // 押した位置と、押したときの当たり。離したときに動いていなければ当たり判定へ回す。
    pressed: null,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function grab() {
    return root.SigK.annotateGrab;
  }

  function slop() {
    return root.SigK.annotatePointer?.CLICK_SLOP ?? 3;
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
    return Math.abs(event.clientX - from.x) > slop() || Math.abs(event.clientY - from.y) > slop();
  }

  // 今の道具での当たり（「図形」「ハンド」では塗っていない四角・丸は線の上だけ）。
  function hitAt(page) {
    return annotate().hitTest(page.index, page.point, { outline: OUTLINE_TOOLS.includes(annotate().getTool()) });
  }

  function isMovable(key) {
    const view = root.SigK.viewer;
    const entry = root.SigK.annotationState.findAnnot(view.getAnnotations(), view.getImported(), key);
    return entry !== null && entry.readonly !== true && root.SigK.annotationMoves.isMovable(entry);
  }

  // 押せば書き込みを掴む所か（決定84）。描いている途中の多角形（押すと頂点を置く）・テキストの入力欄の上・消しゴム・モザイク・
  // トリミングでは掴まない。掴むのは、動かせる書き込みを GRAB_TOOLS の道具で押すか、選んでいるものか Ctrl で足して押すとき。
  function grabsAt(event) {
    const tool = annotate().getTool();
    if (NO_GRAB_TOOLS.includes(tool) || root.SigK.annotatePlacing?.isActive() === true || (event.target?.closest?.('.free-text-editor') ?? null) !== null)
      return false;
    const page = pageAt(event);
    const hit = page === null ? null : hitAt(page);
    if (hit === null || !isMovable(hit))
      return false;
    return GRAB_TOOLS.includes(tool) || annotate().isSelected(hit) || event.ctrlKey === true;
  }

  function down(event) {
    const page = pageAt(event);
    const hit = page === null ? null : hitAt(page);
    const wasSelected = hit !== null && annotate().isSelected(hit);
    const tool = annotate().getTool();
    state.pressed = { x: event.clientX, y: event.clientY, ctrl: event.ctrlKey === true, hit, wasSelected };
    if (page === null)
      return;
    // 「選択」の道具で書き込みの無い所を押したら範囲選択（確定事項D1・D2。Ctrl か Shift で始めたら足す）。
    if (hit === null && tool === 'select') {
      root.SigK.annotateMarquee.begin(event, page, { add: event.ctrlKey === true || event.shiftKey === true });
      state.pressed = null;
      return;
    }
    // Ctrl＋押下は選択の足し引き（確定事項B3）。まだ選んでいなければ押したときに足す。描き始めない。そのまま引けば、
    // 足したものを含めて選んでいる全部の写しを作る（確定事項G1）。
    if (event.ctrlKey === true) {
      if (hit !== null && !wasSelected)
        annotate().addKey(hit);
      if (hit !== null)
        grab().begin(event, page, hit);
      return;
    }
    // 選んでいる書き込みの上なら、選んでいる全部を掴む（確定事項B6・F）。「選択」の道具なら、選んでいない書き込みも
    // 押したときに選んで 1 段で掴む（決定53 ⑨）。GRAB_TOOLS のほかの道具も、動かせる書き込みなら同じ（決定84 ④）。
    if (hit !== null && wasSelected) {
      grab().begin(event, page, hit);
      return;
    }
    if (hit !== null && (tool === 'select' || (GRAB_TOOLS.includes(tool) && isMovable(hit)))) {
      annotate().select(hit);
      grab().begin(event, page, hit);
      return;
    }
    // 多角形の道具は、書き込みの無い所で押しても描き始めず、文字も選ばせない（頂点は離したときに置く。spec-4b-5a 確定事項13）。
    if (hit === null && root.SigK.annotatePolygon?.isPolygonTool() === true) {
      event.preventDefault();
      return;
    }
    if (tool === 'shape' || tool === 'pen' || tool === 'marker')
      root.SigK.annotateDraw.begin(event, page);
  }

  // 多角形の道具で、書き込みの無い所を押して離したら、押してから動いた量を問わず 1 つ目の頂点を置く（spec-4b-5a 確定事項13・17）。
  function startPolygon(event, pressed) {
    if (pressed === null || pressed.hit !== null || pressed.ctrl)
      return false;
    const page = pageAt(event);
    return page !== null && hitAt(page) === null && root.SigK.annotatePolygon?.start(page) === true;
  }

  // Ctrl＋クリックを離した（確定事項B3）。選んでいたものを動かさずに離したら外す。書き込みの無い所なら何もしない。
  function releaseCtrl(pressed) {
    if (pressed.hit !== null && pressed.wasSelected)
      annotate().toggleKey(pressed.hit);
  }

  // 動いていない押し離し（押し離しの残りの経路）。pressed は down で控えたもの。
  function up(event, pressed) {
    const tool = annotate().getTool();
    if (tool !== null && annotate().isMarkupTool(tool) && annotate().createFromSelection(tool))
      return;
    if (startPolygon(event, pressed))
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
    const hit = hitAt(page);
    if (hit !== null) {
      annotate().select(hit);
      return;
    }
    if (tool === 'text' || tool === 'callout') {
      root.SigK.annotateText?.place({ index: page.index, point: page.point, callout: tool === 'callout' });
      return;
    }
    if (tool === 'note') {
      root.SigK.annotateNote?.place({ index: page.index, point: page.point });
      return;
    }
    annotate().select(null);
  }

  // 押したときに控えたものを取り出す（離したときに 1 度だけ）。
  function take() {
    const pressed = state.pressed;
    state.pressed = null;
    return pressed;
  }

  function init(win) {
    state.win = win;
  }

  const SigK = (root.SigK = root.SigK || {});
  // isPending は押してまだ離していない間（Esc で捨てる。spec-4b-7a 確定事項A3）。
  SigK.annotatePress = { GRAB_TOOLS, init, pageAt, grabsAt, down, up, take, isPending: () => state.pressed !== null, reset: () => { state.pressed = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
