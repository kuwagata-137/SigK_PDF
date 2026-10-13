(function (root) {
  'use strict';

  // 分割の盤の上のキー（spec-2-2b 確定事項G3）。盤の器（#split-board-scroll。tabindex=0）にフォーカスがあるときだけ受ける。
  //
  // ←→ で今のページ、↑↓ で上下の段（箱をまたぐ）、Home・End で端、Shift を押していれば選択を広げ、Space で今のページを選び、
  // Enter で大きく見る（split-zoom.js）。PageUp・PageDown は盤をスクロールする。扱ったキーは盤の器で止め、裏のページビューの
  // ページ送り（viewer-keys.js の PAGE_KEYS）へ流さない。今のページは split-board-input.js が持つ（押したページも今のページになる）。

  const ROW_GAP = 12;
  const BOARD_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Enter', 'PageUp', 'PageDown']);

  let el = null;

  const edit = () => root.SigK.toolsSplitEdit;
  const selection = () => root.SigK.splitSelection;
  const layout = () => root.SigK.splitLayout;
  const view = () => root.SigK.splitBoardView;
  const input = () => root.SigK.splitBoardInput;

  // 上下の段へ。いまのページの真上・真下に近いページ（箱をまたぐ）。
  function vertical(placed, base, direction) {
    const rect = layout().pageRect(placed, base);
    const y = direction > 0 ? rect.y + rect.height * 1.5 + ROW_GAP : rect.y - rect.height / 2 - ROW_GAP;
    return layout().pageAt(placed, rect.x + rect.width / 2, y) ?? base;
  }

  function targetOf(key, base, placed, last) {
    if (key === 'Home')
      return 0;
    if (key === 'End')
      return last;
    if (key === 'ArrowLeft')
      return Math.max(0, base - 1);
    if (key === 'ArrowRight')
      return Math.min(last, base + 1);
    return vertical(placed, base, key === 'ArrowDown' ? 1 : -1);
  }

  function onBoardKey(event) {
    if (event.target !== el.scroll || !BOARD_KEYS.has(event.key) || event.ctrlKey || event.altKey || event.metaKey)
      return;
    event.preventDefault();
    event.stopPropagation();
    const placed = view().layout();
    if (placed === null)
      return;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      el.scroll.scrollTop += (event.key === 'PageDown' ? 1 : -1) * el.scroll.clientHeight * 0.9;
      view().schedule();
      return;
    }
    const last = edit().board().pageCount - 1;
    if (last < 0)
      return;   // 0 ページの PDF（点検 R1）
    const base = Math.min(input().current() ?? selection().range(edit().selection())?.from ?? 0, last);
    if (event.key === ' ') {
      input().setCurrent(base);
      edit().select(base);
      return;
    }
    if (event.key === 'Enter') {
      root.SigK.splitZoom?.open(base);
      return;
    }
    const next = targetOf(event.key, base, placed, last);
    input().setCurrent(next);
    if (event.shiftKey) {
      if (edit().selection() === null)
        edit().select(base);   // 選んでいなければ、今のページから広げる（点検 R1）
      edit().select(next, { shift: true });
    }
    view().revealPage(next);
  }

  function init(doc, win) {
    if (win.__sigkSplitBoardKeysReady === true)
      return false;
    const scroll = doc.getElementById('split-board-scroll');
    if (scroll === null)
      return false;
    win.__sigkSplitBoardKeysReady = true;
    el = { doc, win, scroll };
    scroll.addEventListener('keydown', onBoardKey);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardKeys = { init };
})(typeof window !== 'undefined' ? window : globalThis);
