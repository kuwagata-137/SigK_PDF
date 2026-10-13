(function (root) {
  'use strict';

  // 分割の盤の描画（spec-2-2b 確定事項C1・C2・C6・C10・D3。見本 screenshots/phase2-2b-02-start.png ほか）。
  //
  // 位置は split-board-layout.js が計算し、ここは見えている範囲と上下 1 画面ぶんの箱・ページ・✂ だけを組む（DOM をページ数に
  // 比例させない）。全体の高さは器（#split-board-canvas）の高さで持つ。スクロールと窓の大きさの変化は rAF で 1 フレーム 1 回に
  // 間引く。サムネイルは描く層（split-thumbs.js）に見えている順で頼み、描けたら紙の枠へ差し込む。要素を組むのは split-board-nodes.js、
  // 押す・なぞるは split-board-input.js。

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

  function isReady() {
    const src = split().source();
    return src !== null && !src.pending && src.blocked === null && src.pageCount !== null && edit().board() !== null;
  }

  // 盤・幅・大きさが同じなら、前の配置を使う（スクロールのたびに組み直さない）。
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
  function requestThumbs(at, pages) {
    if (!thumbs().getState().open)
      return;
    const center = el.scroll.scrollTop + el.scroll.clientHeight / 2;
    const distance = (page) => {
      const rect = layout().pageRect(at, page);
      return Math.abs(rect.y + rect.height / 2 - center);
    };
    const ordered = [...pages].sort((a, b) => distance(a) - distance(b));
    thumbs().want(ordered, { cap: layout().renderCap(thumbs().size()) });
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
    const ready = isReady();
    el.empty.hidden = ready;
    if (!ready) {
      el.canvas.replaceChildren();
      el.canvas.style.height = '0px';
      return true;
    }
    const at = placed();
    el.canvas.style.height = `${at.totalHeight}px`;
    const viewportHeight = el.scroll.clientHeight;
    const windowed = layout().windowOf(at, { scrollTop: el.scroll.scrollTop, viewportHeight, overscan: viewportHeight * OVERSCAN });
    build(at, windowed);
    requestThumbs(at, windowed.pages);
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

  // できるファイルの行から（確定事項C11）。箱の頭へスクロールする。
  function revealBox(boxIndex) {
    if (el === null || !isReady())
      return false;
    el.scroll.scrollTop = layout().boxTop(placed(), boxIndex);
    render();
    return true;
  }

  // ページが見える所までスクロールする（キーで今のページを動かしたとき）。
  function revealPage(page) {
    if (el === null || !isReady())
      return false;
    const at = placed();
    el.scroll.scrollTop = layout().scrollTopFor(at, page, { scrollTop: el.scroll.scrollTop, viewportHeight: el.scroll.clientHeight });
    render();
    return true;
  }

  function onClick(event) {
    const cut = event.target.closest('.sb-cut');
    if (cut !== null) {
      edit().cut(Number(cut.dataset.cut));
      return;
    }
    const join = event.target.closest('.sb-join');
    if (join !== null)
      edit().join(Number(join.dataset.join));
  }

  function init(doc, win) {
    if (win.__sigkSplitBoardViewReady === true)
      return false;
    const scroll = doc.getElementById('split-board-scroll');
    if (scroll === null)
      return false;
    win.__sigkSplitBoardViewReady = true;
    el = { doc, win, scroll, canvas: doc.getElementById('split-board-canvas'), empty: doc.getElementById('split-board-empty') };
    scroll.addEventListener('scroll', schedule);
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
