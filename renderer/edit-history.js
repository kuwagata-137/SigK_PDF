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

  // 世代の annot の片側（null・鍵の文字列・鍵の配列）。
  function copyAnnot(value) {
    if (Array.isArray(value))
      return [...value];
    return value ?? null;
  }

  function pushHistory(history, snapshot, { before = [], after = [], annot = {} } = {}) {
    // 戻した状態から新しい操作をしたら、先の履歴は捨てる（spec-1-5 確定事項10）。
    const stack = history.stack.slice(0, history.at + 1);
    stack.push({
      ...snapshotOf(snapshot),
      before: [...before],
      after: [...after],
      // 複数選択の鍵の配列は写して積む（参照のまま積むと、後から並びを変えたときに履歴まで変わる。spec-4b-3a 確定事項L1）。
      annot: { before: copyAnnot(annot.before), after: copyAnnot(annot.after) },
    });
    // 上限を超えたら古いほうから捨てる。
    while (stack.length > MAX_HISTORY)
      stack.shift();
    return { stack, at: stack.length - 1 };
  }

  // 一番上の世代を、同じ欄を続けて変えた結果で差し替える（spec-4b-3a 確定事項J）。annot.before は最初に変えたときのまま残し、
  // after だけ新しくする。差し替えた結果が 1 つ前の世代と同じ（試してから元の値に戻した）なら、その世代ごと落とす。
  function amendTop(history, snapshot, { annot = {} } = {}) {
    const stack = history.stack.slice(0, history.at + 1);
    const top = stack[stack.length - 1];
    stack[stack.length - 1] = { ...snapshotOf(snapshot), before: top.before, after: top.after, annot: { before: top.annot.before, after: copyAnnot(annot.after) } };
    const previous = stack[stack.length - 2];
    const amended = stack[stack.length - 1];
    if (previous !== undefined && pagePlan().samePlan(previous.plan, amended.plan) && annotationState().sameAnnots(previous.annots, amended.annots))
      stack.pop();
    return { stack, at: stack.length - 1 };
  }

  // 注釈の世代を積むか、続けた変更なら一番上を差し替える（spec-4b-3a 確定事項J）。gesture は欄の名前、last は直前に覚えた
  // { field, keys（変えた後の鍵の並び）, at }。同じ欄を、そのときの変えた後の選択のまま、一番上の世代から続けて変えたら差し替える。
  // 返すのは { history, gesture（次に覚えるもの。差し替えで世代ごと落ちたら null） }。
  function record(history, snapshot, { annot = {}, gesture = null, last = null } = {}) {
    const selection = root.SigK.annotationSelection;
    const continued = gesture !== null && last !== null && last.field === gesture && last.at === history.at
      && selection.sameKeys(selection.keysOf(annot.before ?? null), last.keys);
    const next = continued ? amendTop(history, snapshot, { annot }) : pushHistory(history, snapshot, { annot });
    const dropped = continued && next.at < history.at;
    return { history: next, gesture: gesture === null || dropped ? null : { field: gesture, keys: selection.keysOf(annot.after ?? null), at: next.at } };
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
    amendTop,
    record,
    current,
    undo,
    redo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
