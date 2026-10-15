(function (root) {
  'use strict';

  // 分割の ✂ の盤を、選んでいる帯の中に広げる（spec-2-5 確定事項G1・G9・G12。見本 screenshots/strips3-split.png）。
  //
  // 盤の要素（#split-strip-board。上の段・選んだときの操作の帯・箱とページ）は 1 組だけで、分割を選んでいる間、選んでいる帯（strips.rowNode）の
  // 中へ動かす。盤にできる帯には .board を付け、固定の高さを外し、帯の紙の列を隠す（CSS）。盤にできない帯（パスワード付き・開けなかった・
  // 名前の無い新しい帯）では、紙の列は残し、盤の代わりに理由（#split-board-empty。split-board-view.js が書く）だけを出す（G12）。
  // 分割を離れる・帯が無いときは、元の場所へ戻して隠す。動かすだけなので、盤の要素に付けた受け手はそのまま生きる。
  // 呼ぶのは、帯の並べ直しの最後（strip-view.js の reconcile）・右の欄の出し入れ（tool-pane.js）・分割の描き直し（tools-split-view.js）。

  const state = { host: null, tabId: null, expanded: false };
  let el = null;

  function release() {
    if (state.host !== null) {
      state.host.classList.remove('board');
      state.host.style.height = `${root.SigK.stripLayout.STRIP_HEIGHT}px`;
    }
    Object.assign(state, { host: null, tabId: null, expanded: false });
    if (el.board.parentNode !== el.home)
      el.home.append(el.board);
    el.board.hidden = true;
  }

  // 盤を出す帯（タブの id）。分割を選んで帯の画面を出していて、選んでいる帯があるときだけ。
  function hostTab() {
    if (root.SigK.toolPane?.shown() !== 'split' || root.SigK.strips?.isShown() !== true)
      return null;
    return root.SigK.toolsSplit?.source() ?? null;
  }

  function sync() {
    if (el === null)
      return false;
    const src = hostTab();
    const node = src === null ? null : root.SigK.strips.rowNode(src.tabId);
    if (node === null) {
      release();
      return false;
    }
    const moved = state.host !== node;
    if (moved)
      release();
    const expanded = src.blocked === null;
    node.classList.toggle('board', expanded);
    node.style.height = '';
    el.board.toggleAttribute('data-blocked', !expanded);
    if (el.board.parentNode !== node)
      node.append(el.board);
    el.board.hidden = false;
    Object.assign(state, { host: node, tabId: src.tabId, expanded });
    // 選び替えたら、その帯の上端まで送る（G9）。
    if (moved)
      reveal(node);
    return true;
  }

  function reveal(node) {
    const strips = el.strips;
    const top = node.getBoundingClientRect().top - strips.getBoundingClientRect().top + strips.scrollTop;
    const pad = root.SigK.stripLayout.COLUMN_PAD;
    if (top < strips.scrollTop || top > strips.scrollTop + strips.clientHeight - pad)
      strips.scrollTop = Math.max(0, top - pad);
  }

  function init(doc, win) {
    if (win.__sigkSplitStripReady === true)
      return false;
    const board = doc.getElementById('split-strip-board');
    const strips = doc.getElementById('strips');
    if (board === null || strips === null)
      return false;
    win.__sigkSplitStripReady = true;
    el = { doc, board, strips, home: board.parentNode };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitStrip = {
    init, sync,
    // 盤を入れている帯（タブの id）と、盤を広げているか（盤にできない帯では false）。strip-view.js が帯の高さと描く紙を決めるのに使う。
    hostId: () => state.tabId,
    expanded: () => state.expanded,
    hostNode: () => state.host,
  };
})(typeof window !== 'undefined' ? window : globalThis);
