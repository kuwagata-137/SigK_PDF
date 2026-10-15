(function (root) {
  'use strict';

  // 分割の盤の描画（spec-2-2b 確定事項C1・C2・C6・C10・D3、spec-2-5 確定事項G1・G9。見本 screenshots/strips3-split.png）。
  //
  // 盤は選んでいる帯の中にあり（split-strip.js）、帯の画面全体（#strips）のスクロールに乗る（盤の中に別のスクロールは作らない。G9）。
  // 位置は split-board-layout.js が計算し、ここは見えている範囲と上下 1 画面ぶんの箱・ページ・✂ だけを組む（DOM をページ数に比例させない）。
  // 全体の高さは器（#split-board-canvas）の高さで持つ。スクロールと窓の大きさの変化は rAF で 1 フレーム 1 回に間引く。サムネイルは
  // 描く層（split-thumbs.js）に見えている順で頼み、描けたら紙の枠へ差し込む。要素を組むのは split-board-nodes.js、押す・なぞるは
  // split-board-input.js。盤にできない帯では、理由（#split-board-empty）を書く。

  const OVERSCAN = 1;   // 上下に足す画面の数

  let el = null;
  let cache = { board: null, width: -1, size: null, placed: null, boxes: null };
  let frame = null;

  const split = () => root.SigK.toolsSplit;
  const edit = () => root.SigK.toolsSplitEdit;
  const model = () => root.SigK.splitBoard;
  const layout = () => root.SigK.splitLayout;
  const thumbs = () => root.SigK.splitThumbs;
  const nodes = () => root.SigK.splitBoardNodes;

  const isReady = () => edit().board() !== null;
  // 盤を帯に出しているか（分割を選んで、選んでいる帯に盤を入れた。split-strip.js）。出していない間は描かず、盤の紙も持たない
  // （前は、ツールモードに入ったときの描き直しの予約から、結合を選んでいても盤の紙を描いていた。点検の直しで見つけた）。
  const isHosted = () => (root.SigK.splitStrip?.hostId() ?? null) !== null;

  // 盤から見た、帯の画面の見えている所。offset は盤の器の上端が帯の画面の中身のどこにあるか。
  function viewport() {
    const strips = el.strips;
    const offset = el.canvas.getBoundingClientRect().top - strips.getBoundingClientRect().top + strips.scrollTop;
    return { scrollTop: strips.scrollTop - offset, height: strips.clientHeight, offset };
  }

  // 盤が変わらず、幅・大きさが同じなら、前の配置を使う（スクロールのたびに組み直さない）。
  function placed() {
    const board = edit().board();
    const width = Math.max(0, el.scroll.clientWidth - 2);
    const size = thumbs().size();
    if (cache.board !== board || cache.width !== width || cache.size !== size) {
      const boxes = model().boxes(board);
      cache = { board, width, size, boxes, placed: layout().layout({ boxes, contentWidth: width, size }) };
    }
    return cache.placed;
  }

  // 見えている所の中心に近い順にサムネイルを頼む（確定事項D4）。
  function requestThumbs(at, pages, view) {
    const center = view.scrollTop + view.height / 2;
    const distance = (page) => {
      const rect = layout().pageRect(at, page);
      return Math.abs(rect.y + rect.height / 2 - center);
    };
    const ordered = [...pages].sort((a, b) => distance(a) - distance(b));
    // 上限は決めた枚数か、見えている枚数の多いほう（大きな画面でも見えているページは全部描く。決定79 ①）。
    const bottom = view.scrollTop + view.height;
    const visible = pages.filter((page) => {
      const rect = layout().pageRect(at, page);
      return rect.y + rect.height > view.scrollTop && rect.y < bottom;
    }).length;
    thumbs().want(ordered, { cap: Math.max(layout().renderCap(thumbs().size()), visible) });
  }

  function build(at, windowed) {
    const board = edit().board();
    const skipped = new Set(board.skipped);
    const picked = root.SigK.splitSelection.range(edit().selection());
    const current = root.SigK.splitBoardInput?.current() ?? null;
    const names = split().currentPlan().names ?? [];
    const built = windowed.boxes.map((index) => nodes().box(el.doc, at.boxes[index], cache.boxes[index], names, skipped));
    for (const page of windowed.pages) {
      const flags = { selected: picked !== null && page >= picked.from && page <= picked.to, skipped: skipped.has(page), current: page === current };
      built.push(nodes().page(el.doc, layout().pageRect(at, page), at.cell, page, flags, thumbs().canvasOf(page)));
      const cut = layout().cutRect(at, page);
      if (cut !== null)
        built.push(nodes().cut(el.doc, cut, at.cell, page));
    }
    el.canvas.replaceChildren(...built);
    // 実行中は ✂ と［前のファイルとつなげる］を押せない色にする（確定事項C12。押しても tools-split-edit.js が受けない）。
    if (split().isRunning()) {
      for (const button of el.canvas.querySelectorAll('.sb-cut, .sb-join'))
        button.setAttribute('aria-disabled', 'true');
    }
  }

  function render() {
    if (el === null)
      return false;
    const ready = isHosted() && isReady();
    thumbs().setTab(ready ? split().source().tabId : null);
    el.empty.hidden = ready;
    el.empty.textContent = ready ? '' : split().stateText() ?? '';
    if (!ready) {
      el.canvas.replaceChildren();
      el.canvas.style.height = '0px';
      return true;
    }
    const at = placed();
    el.canvas.style.height = `${at.totalHeight}px`;
    const view = viewport();
    const windowed = layout().windowOf(at, { scrollTop: view.scrollTop, viewportHeight: view.height, overscan: view.height * OVERSCAN });
    build(at, windowed);
    requestThumbs(at, windowed.pages, view);
    // 盤の高さが変わると、下の帯の見え方も変わる。
    root.SigK.strips?.schedule();
    return true;
  }

  function schedule() {
    if (el === null || frame !== null)
      return;
    frame = el.win.requestAnimationFrame(() => {
      frame = null;
      render();
    });
  }

  // 帯の画面を、盤の y の所が上端に来るまで送る。
  function scrollToBoard(y) {
    el.strips.scrollTop = Math.max(0, viewport().offset + y);
  }

  // できるファイルの行から（確定事項C11）。箱の頭へスクロールする。
  function revealBox(boxIndex) {
    if (el === null || !isReady())
      return false;
    scrollToBoard(layout().boxTop(placed(), boxIndex));
    render();
    return true;
  }

  // ページが見える所までスクロールする（キーで今のページを動かしたとき）。
  function revealPage(page) {
    if (el === null || !isReady())
      return false;
    const view = viewport();
    scrollToBoard(layout().scrollTopFor(placed(), page, { scrollTop: view.scrollTop, viewportHeight: view.height }));
    render();
    return true;
  }

  // ✂ と［つなげる］は押すと盤ごと作り直されて消えるので、フォーカスを盤の器へ戻す（body に落ちると、PageUp などが
  // 裏のページビューを動かす。点検 R1）。
  function onClick(event) {
    const cut = event.target.closest('.sb-cut');
    const join = event.target.closest('.sb-join');
    if (cut === null && join === null)
      return;
    if (cut !== null)
      edit().cut(Number(cut.dataset.cut));
    else
      edit().join(Number(join.dataset.join));
    el.scroll.focus?.({ preventScroll: true });
  }

  function init(doc, win) {
    if (win.__sigkSplitBoardViewReady === true)
      return false;
    const scroll = doc.getElementById('split-board-scroll');
    if (scroll === null)
      return false;
    win.__sigkSplitBoardViewReady = true;
    el = { doc, win, scroll, strips: doc.getElementById('strips'), canvas: doc.getElementById('split-board-canvas'), empty: doc.getElementById('split-board-empty') };
    el.strips.addEventListener('scroll', schedule);
    win.addEventListener('resize', schedule);
    el.canvas.addEventListener('click', onClick);
    thumbs().onDrawn((page, canvas) => {
      const sheet = el.canvas.querySelector(`.sb-page[data-page="${page}"] .sb-sheet`);
      if (sheet !== null)
        nodes().fitCanvas(sheet, canvas);
    });
    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardView = {
    init, render, schedule, revealBox, revealPage,
    // 盤が乗っているスクロール（帯の画面）。なぞる途中の自動のスクロールと PageUp・PageDown が動かす。
    scroller: () => el?.strips ?? null,
    layout: () => (el !== null && isReady() ? placed() : null),
    boxTop: (boxIndex) => (el !== null && isReady() ? layout().boxTop(placed(), boxIndex) : 0),
    getState: () => ({
      boxes: el?.canvas.querySelectorAll('.sb-box').length ?? 0,
      pages: el?.canvas.querySelectorAll('.sb-page').length ?? 0,
      cuts: el?.canvas.querySelectorAll('.sb-cut').length ?? 0,
      nodes: el?.canvas.children.length ?? 0,
    }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
