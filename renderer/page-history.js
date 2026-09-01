(function (root) {
  'use strict';

  // 元に戻す・やり直しの履歴（spec-1-5 B）。DOM にも pdf.js にも触れない。
  //
  // page-plan.js から切り出してある。ここは plan を受け取って plan を返すだけで、
  // 並べ替えや回転そのものは何も知らない。操作の種類が増えても、この層は増えない。

  // 履歴として持つ世代の数（確定事項9）。plan 1本は 1,000 ページでも要素 1,000 個
  // なので、50 世代持っても数MBに収まる。
  const MAX_HISTORY = 50;

  function pagePlan() {
    return root.SigK.pagePlan;
  }

  // plan のスナップショット列で持つ。逆操作を書かないので、操作の種類が
  // 増えても undo の実装は増えない。
  //
  // 各世代は before と after を持つ。before は「この操作をする前の並びにおける
  // 対象の位置」、after は「した後の位置」である。戻した直後に、その世代で
  // 操作の対象だったページを選び直すのに使う（確定事項12。何が戻ったかを示す）。
  function createHistory(plan) {
    return { stack: [{ plan: pagePlan().clonePlan(plan), before: [], after: [] }], at: 0 };
  }

  function canUndo(history) {
    return history.at > 0;
  }

  function canRedo(history) {
    return history.at < history.stack.length - 1;
  }

  function pushHistory(history, plan, { before = [], after = [] } = {}) {
    // 戻した状態から新しい操作をしたら、先の履歴は捨てる（確定事項10）。
    const stack = history.stack.slice(0, history.at + 1);
    stack.push({ plan: pagePlan().clonePlan(plan), before: [...before], after: [...after] });
    // 上限を超えたら古いほうから捨てる。
    while (stack.length > MAX_HISTORY)
      stack.shift();
    return { stack, at: stack.length - 1 };
  }

  function undo(history) {
    if (!canUndo(history))
      return { history, plan: pagePlan().clonePlan(history.stack[history.at].plan), selection: [], changed: false };

    // 取り消すのは「いま居る世代」を作った操作である。
    const undoing = history.stack[history.at];
    const at = history.at - 1;
    return {
      history: { stack: history.stack, at },
      plan: pagePlan().clonePlan(history.stack[at].plan),
      selection: [...undoing.before],
      changed: true,
    };
  }

  function redo(history) {
    if (!canRedo(history))
      return { history, plan: pagePlan().clonePlan(history.stack[history.at].plan), selection: [], changed: false };

    const at = history.at + 1;
    const redoing = history.stack[at];
    return {
      history: { stack: history.stack, at },
      plan: pagePlan().clonePlan(redoing.plan),
      selection: [...redoing.after],
      changed: true,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageHistory = {
    MAX_HISTORY,
    createHistory,
    canUndo,
    canRedo,
    pushHistory,
    undo,
    redo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
