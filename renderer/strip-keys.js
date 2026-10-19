(function (root) {
  'use strict';

  // ツールモードのキー（spec-2-5 確定事項I6・I9。viewer-keys.js の handleKey から、文書が無くても、ほかのキーより先に呼ぶ）。
  //
  //   Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z … ツールモードの記録の新しい方から戻す・進める（tool-history.js）。前の分割の画面の受け持ち
  //                                  （split-board-keys.js の historyKey）はここへ移した。記録が空なら今どおり、分割なら盤を戻す
  //   Ctrl+A                       … 枠の帯の全部のページを選ぶ。✂ の盤が出ていれば盤の全部のページ（決定80 ㊶）。帯が無いとき・
  //                                  枠が「変換する画像」の帯にあるときは何もしない。どのときも画面の文字がまとめて選ばれる既定の動きは止める
  //
  // 文字を打つ欄の中では取らず、欄の素の取り消し・全選択に任せる。扱ったら true。

  const keys = () => root.SigK.viewerKeys;

  function isSelectAll(event) {
    return event.ctrlKey && !event.altKey && !event.shiftKey && String(event.key ?? '').toLowerCase() === 'a';
  }

  // 枠の帯（盤が出ていれば盤）の全部のページを選ぶ。
  function selectAll() {
    if (root.SigK.splitStrip?.expanded() === true) {
      const pageCount = root.SigK.toolsSplitEdit.board()?.pageCount ?? 0;
      return pageCount > 0 && root.SigK.toolsSplitEdit.setSelection(root.SigK.splitSelection.dragTo(0, pageCount - 1));
    }
    if (root.SigK.imageStrip?.hasFrame() === true)
      return false;
    const tabId = root.SigK.tabs.activeId();
    const view = tabId === null ? null : root.SigK.tabs.peek(tabId);
    if (view === null || view.doc === undefined)
      return false;
    root.SigK.stripSelection.selectAll(tabId, view.sizes.length, view.plan);
    return true;
  }

  function handleKey(event, doc) {
    if (doc.documentElement.getAttribute('data-mode') !== 'tools')
      return false;
    const direction = keys().historyStep(event);
    if (direction === null && !isSelectAll(event))
      return false;
    if (keys().isTypingField(event.target))
      return false;
    event.preventDefault();
    if (direction === 'undo')
      root.SigK.toolHistory.undo();
    else if (direction === 'redo')
      root.SigK.toolHistory.redo();
    else
      selectAll();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripKeys = { handleKey, selectAll };
})(typeof window !== 'undefined' ? window : globalThis);
