(function (root) {
  'use strict';

  // 帯のページの選択（spec-2-5 確定事項D10。決定80 ㉝）。選び方はページ編集と同じ（クリック・Shift・Ctrl。pageGridRules.resolveClick）。
  // 選んだページはタブごとに持ち、表示の index（plan の位置）で持つ。使い道（引いて落とす）は PR-4 で、PR-2 では印だけを出す。
  //
  // 選択が外れるのは、そのタブのページの並びが変わったとき（onPlanChanged）・タブを閉じたとき（forget）・Esc（escape）。

  const byTab = new Map();
  const listeners = [];

  function notify(tabId) {
    listeners.forEach((listener) => listener(tabId));
  }

  function get(tabId) {
    return [...(byTab.get(tabId)?.selection ?? [])];
  }

  // plan は押した時点のそのタブの並び（並びが変わったら外すために控える）。
  function click(tabId, index, { ctrl = false, shift = false, plan = null } = {}) {
    const current = byTab.get(tabId) ?? { selection: [], anchor: null, plan: null };
    const next = root.SigK.pageGridRules.resolveClick({ selection: current.selection, anchor: current.anchor, index, ctrl, shift });
    byTab.set(tabId, { selection: next.selection, anchor: next.anchor, plan: plan ?? current.plan });
    notify(tabId);
    return get(tabId);
  }

  function clear(tabId) {
    if ((byTab.get(tabId)?.selection.length ?? 0) === 0)
      return false;
    byTab.delete(tabId);
    notify(tabId);
    return true;
  }

  function forget(tabId) {
    byTab.delete(tabId);
  }

  // Esc の順の最後の段（ツールモード）。どれかのタブで選んでいれば全部外して true。
  function escape() {
    const held = [...byTab.entries()].filter(([, entry]) => entry.selection.length > 0).map(([tabId]) => tabId);
    byTab.clear();
    held.forEach(notify);
    return held.length > 0;
  }

  // 並びが変わったら外す。plan は参照で比べる（ページの編集は新しい配列を作る）。初めて見る並びは控えるだけ。
  function onPlanChanged(tabId, plan) {
    const entry = byTab.get(tabId);
    if (entry === undefined)
      return false;
    if (entry.plan === null) {
      entry.plan = plan;
      return false;
    }
    if (entry.plan === plan)
      return false;
    byTab.delete(tabId);
    notify(tabId);
    return true;
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  function hasAny() {
    return [...byTab.values()].some((entry) => entry.selection.length > 0);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripSelection = { get, click, clear, forget, escape, onPlanChanged, onChange, hasAny };
})(typeof window !== 'undefined' ? window : globalThis);
