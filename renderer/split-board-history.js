(function (root) {
  'use strict';

  // 分割の盤の履歴（spec-2-2b 確定事項C8）。DOM に触れない。
  //
  // 盤（split-board-model.js）は小さな配列 2 本なので、操作のたびに写しを丸ごと積む。履歴は { entries, at } で、
  // 操作は新しい履歴を返す。戻したあとで新しい操作をすると先を捨てる（文書の履歴 edit-history.js と同じ考え方）。
  // 選択は履歴に入れない（戻す・やり直すで外すのは呼ぶ側）。

  // 持つ盤の数。1,000 ページを 1 ページずつに分けた盤でも 1 本 4KB ほどなので、100 でも小さい。
  const MAX_HISTORY = 100;

  const board = () => root.SigK.splitBoard;

  function create(initial) {
    return { entries: [initial], at: 0 };
  }

  const current = (h) => h.entries[h.at];
  const canUndo = (h) => h.at > 0;
  const canRedo = (h) => h.at < h.entries.length - 1;

  // 同じ盤（変わらない操作）は積まない。
  function push(h, next) {
    const now = current(h);
    if (next === now || board().same(next, now))
      return h;
    const entries = [...h.entries.slice(0, h.at + 1), next].slice(-MAX_HISTORY);
    return { entries, at: entries.length - 1 };
  }

  const undo = (h) => (canUndo(h) ? { entries: h.entries, at: h.at - 1 } : h);
  const redo = (h) => (canRedo(h) ? { entries: h.entries, at: h.at + 1 } : h);

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitHistory = { MAX_HISTORY, create, current, push, undo, redo, canUndo, canRedo };
})(typeof window !== 'undefined' ? window : globalThis);
