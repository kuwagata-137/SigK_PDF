(function (root) {
  'use strict';

  // 分割の盤のページを大きく見る窓（spec-2-2b 第 E 章。見本 screenshots/phase2-2b-06-zoom.png。決定76 ⑥）。
  //
  // ページのダブルクリックか、盤にフォーカスがあるときの Enter で開く（split-board-input.js・split-board-keys.js）。窓全体を暗くし、
  // 1 ページを窓の高さに収めて描く。上に「何ページ目か」と「どのファイルに入るか」、左右に前後のボタン。←→（PageUp・PageDown も）で
  // 前後のページへ移り、Esc か × で閉じる。持つのは今の 1 枚だけで、移るときと閉じるときに canvas を手放して page.cleanup() を呼ぶ。
  // 開いている間は、ほかのキーは後ろの画面に届かない（viewer-keys.js の dialog[open] の決まり）。jsdom には showModal が無いので
  // open 属性で代える（help-dialog.js と同じ）。

  const MAX_DPR = 2;
  const MARGIN = { x: 2 * (44 + 22) + 40, y: 140 };   // 左右のボタンと余白、上下の見出しと案内
  const KEYS = { ArrowLeft: -1, PageUp: -1, ArrowRight: 1, PageDown: 1 };

  const state = { open: false, page: null, canvas: null, pdfPage: null, ticket: 0 };
  let el = null;

  const edit = () => root.SigK.toolsSplitEdit;
  const pageImage = () => root.SigK.pageImage;
  const digits = (n) => root.SigK.splitPlan.withCommas(n);   // 1,000 以上ならカンマ（決定78 ③）

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function release() {
    pageImage().release(state.canvas);
    state.pdfPage?.cleanup?.();
    state.canvas = null;
    state.pdfPage = null;
  }

  // 「どのファイルに入るか」（第 I 章）。
  function fileText(board, index) {
    if (board.skipped.includes(index))
      return '書き出さないページです';
    const box = root.SigK.splitBoard.boxes(board)[root.SigK.splitBoard.boxOf(board, index)];
    const name = root.SigK.toolsSplit.currentPlan().names?.[box.file - 1] ?? '';
    return `${name} に入るページです`;
  }

  async function show(index) {
    release();
    const ticket = (state.ticket += 1);
    const board = edit().board();
    state.page = index;
    el.title.textContent = `${digits(index + 1)} / ${digits(board.pageCount)} ページ`;
    el.file.textContent = fileText(board, index);
    setDisabled(el.prev, index <= 0);
    setDisabled(el.next, index >= board.pageCount - 1);
    el.page.replaceChildren();
    // 選んでいる帯の今の中身で描く（spec-2-5 確定事項G6。盤の紙と同じ planPageImage.draw）。
    const tabs = root.SigK.tabs;
    const view = tabs?.peek(root.SigK.splitThumbs.tabId()) ?? null;
    const size = view?.sizes?.[index];
    if (view?.doc === undefined || !(size?.width > 0) || !(size?.height > 0))
      return;
    const fit = Math.max(0.1, Math.min((el.win.innerWidth - MARGIN.x) / size.width, (el.win.innerHeight - MARGIN.y) / size.height));
    const ratio = Math.min(el.win.devicePixelRatio || 1, MAX_DPR);
    let drawn = null;
    try {
      drawn = await root.SigK.planPageImage.draw(el.doc, view, index, { sheet: { width: size.width * fit, height: size.height * fit }, dpr: ratio });
    } catch {
      return;   // 描けなかったページは空の紙のまま。窓は閉じられる（点検 R1）
    }
    if (drawn === null)
      return;
    if (ticket !== state.ticket) {
      pageImage().release(drawn.canvas);
      drawn.page?.cleanup?.();
      return;
    }
    state.canvas = drawn.canvas;
    state.pdfPage = drawn.page;
    if (drawn.canvas === null)
      return;
    const scale = Math.max(1, ratio);
    drawn.canvas.style.width = `${drawn.canvas.width / scale}px`;
    drawn.canvas.style.height = `${drawn.canvas.height / scale}px`;
    el.page.replaceChildren(drawn.canvas);
  }

  async function open(index) {
    const board = edit()?.board();
    if (el === null || board === null || !Number.isInteger(index) || index < 0 || index >= board.pageCount)
      return false;
    if (!state.open) {
      if (el.doc.querySelector('dialog[open]') !== null)
        return false;
      if (typeof el.dialog.showModal === 'function')
        el.dialog.showModal();
      else
        el.dialog.setAttribute('open', '');
      state.open = true;
    }
    await show(index);
    el.close.focus?.();
    return true;
  }

  async function step(delta) {
    if (!state.open)
      return false;
    const next = Math.min(Math.max(state.page + delta, 0), edit().board().pageCount - 1);
    if (next === state.page)
      return false;
    await show(next);
    return true;
  }

  function close() {
    if (!state.open)
      return false;
    state.open = false;
    state.ticket += 1;
    release();
    el.page.replaceChildren();
    state.page = null;
    if (typeof el.dialog.close === 'function' && el.dialog.open)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    return true;
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const delta = KEYS[event.key];
    if (delta === undefined)
      return;
    event.preventDefault();
    step(delta);
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkSplitZoomReady === true)
      return false;
    const dialog = doc.getElementById('split-zoom');
    if (dialog === null)
      return false;
    win.__sigkSplitZoomReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc, win, dialog, title: byId('split-zoom-title'), file: byId('split-zoom-file'), page: byId('split-zoom-page'),
      prev: byId('split-zoom-prev'), next: byId('split-zoom-next'), close: byId('split-zoom-close'),
    };
    dialog.addEventListener('keydown', onKey);
    // Chromium は Esc で cancel から close を出す。自分で閉じて手放す。
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    // 暗いところ（ページの外）を押しても閉じる。
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog || event.target === el.page.parentElement)
        close();
    });
    onClick(el.prev, () => step(-1));
    onClick(el.next, () => step(1));
    onClick(el.close, () => close());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitZoom = { init, open, step, close, isOpen: () => state.open, current: () => state.page };
})(typeof window !== 'undefined' ? window : globalThis);
