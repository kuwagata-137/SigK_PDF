(function (root) {
  'use strict';

  // 元に戻す・やり直しの履歴（spec-1-5 B・spec-4-1 確定事項15）。DOM にも pdf.js にも触れない。
  //
  // 塊④（ページ編集）では page-history.js として plan だけを積んでいた。塊①（注釈）で
  // 世代のスナップショットを { plan, annots } に広げ、ページ編集と注釈を 1 本の履歴に
  // した。Ctrl+Z はモードを問わず「最後にした編集」を戻す。ここは編集の状態を受け取って
  // 編集の状態を返すだけで、並べ替えも注釈の形も知らない。操作の種類が増えても、この層は増えない。

  // 履歴として持つ世代の数（spec-1-5 確定事項9）。plan 1本は 1,000 ページでも要素 1,000 個、
  // 注釈は差分だけなので、50 世代持っても数MBに収まる。
  const MAX_HISTORY = 50;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  function snapshotOf({ plan, annots } = {}) {
    return {
      plan: pagePlan().clonePlan(plan),
      annots: annotationState().cloneAnnots(annots),
    };
  }

  // 世代は { plan, annots, before, after, annot } を持つ。
  //   before / after … その操作の前後で対象だったページの位置（spec-1-5 確定事項12）。
  //   annot          … その操作の前後で対象だった注釈の id か ref（無ければ null）。
  //                    戻した直後に選び直し、何が戻ったのかを示す。
  function createHistory(snapshot) {
    return { stack: [{ ...snapshotOf(snapshot), before: [], after: [], annot: { before: null, after: null } }], at: 0 };
  }

  function canUndo(history) {
    return history.at > 0;
  }

  function canRedo(history) {
    return history.at < history.stack.length - 1;
  }

  function pushHistory(history, snapshot, { before = [], after = [], annot = {} } = {}) {
    // 戻した状態から新しい操作をしたら、先の履歴は捨てる（spec-1-5 確定事項10）。
    const stack = history.stack.slice(0, history.at + 1);
    stack.push({
      ...snapshotOf(snapshot),
      before: [...before],
      after: [...after],
      annot: { before: annot.before ?? null, after: annot.after ?? null },
    });
    // 上限を超えたら古いほうから捨てる。
    while (stack.length > MAX_HISTORY)
      stack.shift();
    return { stack, at: stack.length - 1 };
  }

  function current(history) {
    return snapshotOf(history.stack[history.at]);
  }

  function undo(history) {
    if (!canUndo(history))
      return { history, ...current(history), selection: [], annot: null, changed: false };

    // 取り消すのは「いま居る世代」を作った操作である。
    const undoing = history.stack[history.at];
    const at = history.at - 1;
    return {
      history: { stack: history.stack, at },
      ...snapshotOf(history.stack[at]),
      selection: [...undoing.before],
      annot: undoing.annot.before,
      changed: true,
    };
  }

  function redo(history) {
    if (!canRedo(history))
      return { history, ...current(history), selection: [], annot: null, changed: false };

    const at = history.at + 1;
    const redoing = history.stack[at];
    return {
      history: { stack: history.stack, at },
      ...snapshotOf(redoing),
      selection: [...redoing.after],
      annot: redoing.annot.after,
      changed: true,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.editHistory = {
    MAX_HISTORY,
    createHistory,
    canUndo,
    canRedo,
    pushHistory,
    current,
    undo,
    redo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
