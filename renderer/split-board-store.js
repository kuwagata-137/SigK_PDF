(function (root) {
  'use strict';

  // 分割の盤を帯（タブ）ごとに持つ（spec-2-5 確定事項G5・G8。決定80 ㉟）。DOM に触れない。
  //
  // 盤（split-board-model.js）の位置は、帯の今の並び（plan。保存していない並べ替え・削除・差し込みを含む）の位置。帯ごとに
  // { doc, plan, keys, history } を覚え、別の帯を選んでから戻っても ✂ と書き出さない印・Ctrl+Z の記録が残る。覚えるのは帯を閉じるまで。
  // 並びが変わったら（ページ編集で並べ替え・削除・差し込みをした）、分け目と印をページ（どの元のページか）で追ってずらす。
  // 文書が替わったら（保存して開き直した）、ページ数が同じなら位置のまま残し、違えば盤と記録を作り直して notice 'recount' を返す。

  const entries = new Map();   // tabId → { doc, plan, keys, history }

  const model = () => root.SigK.splitBoard;
  const history = () => root.SigK.splitHistory;

  // 並びのページの鍵（unsaved-changes.js の keyOf と同じ見分け方）。
  const keyOf = (page) => (Number.isInteger(page?.insert) ? `i${page.insert}` : `s${page?.src}`);
  const pageKeys = (plan) => (plan ?? []).map(keyOf);
  const sameKeys = (a, b) => a.length === b.length && a.every((key, index) => key === b[index]);
  const sorted = (values) => [...new Set(values)].sort((a, b) => a - b);

  // 分け目は「前のページの後ろ」で追う。前のページが消えていれば、元の並びでさらに前のページを探す（直前に残るページへ寄せる）。
  function movedCut(at, oldKeys, newIndex) {
    for (let page = at - 1; page >= 0; page -= 1) {
      const index = newIndex.get(oldKeys[page]);
      if (index !== undefined)
        return index + 1;
    }
    return null;
  }

  // 盤を新しい並びへ写す。範囲の外になった分け目と、消えたページの印は捨てる。
  function remap(board, oldKeys, newKeys) {
    const newIndex = new Map(newKeys.map((key, index) => [key, index]));
    const pageCount = newKeys.length;
    const cuts = board.cuts.map((at) => movedCut(at, oldKeys, newIndex)).filter((at) => at !== null && at >= 1 && at < pageCount);
    const skipped = board.skipped.map((page) => newIndex.get(oldKeys[page])).filter((page) => page !== undefined);
    return { pageCount, cuts: sorted(cuts), skipped: sorted(skipped) };
  }

  function fresh(view, keys) {
    return { doc: view.doc, plan: view.plan, keys, history: history().create(model().create(keys.length)) };
  }

  // 文書が替わったときの盤。ページ数が同じなら位置のまま（記録も残す）。違えば作り直す。
  function onNewDoc(entry, view, keys) {
    if (entry.keys.length === keys.length) {
      Object.assign(entry, { doc: view.doc, plan: view.plan, keys });
      return null;
    }
    Object.assign(entry, fresh(view, keys));
    return 'recount';
  }

  // tabId の帯の盤と記録を、view（tabs.peek の中身）の今の並びに合わせて返す。{ history, notice }。
  function entryFor(tabId, view) {
    let entry = entries.get(tabId);
    if (entry === undefined) {
      entry = fresh(view, pageKeys(view.plan));
      entries.set(tabId, entry);
      return { history: entry.history, notice: null };
    }
    if (entry.doc === view.doc && entry.plan === view.plan)
      return { history: entry.history, notice: null };
    const keys = pageKeys(view.plan);
    if (entry.doc !== view.doc) {
      const notice = onNewDoc(entry, view, keys);
      return { history: entry.history, notice };
    }
    if (!sameKeys(entry.keys, keys)) {
      const { entries: boards, at } = entry.history;
      entry.history = { entries: boards.map((board) => remap(board, entry.keys, keys)), at };
    }
    Object.assign(entry, { plan: view.plan, keys });
    return { history: entry.history, notice: null };
  }

  function set(tabId, next) {
    const entry = entries.get(tabId);
    if (entry !== undefined)
      entry.history = next;
  }

  // 盤の記録を 1 つ戻す・進める（ツールモードの記録で、盤を広げていない帯の分。spec-2-5 確定事項I6）。direction は 'undo'・'redo'。
  function step(tabId, view, direction) {
    if (!entries.has(tabId))
      return false;
    const { history: h } = entryFor(tabId, view);
    const moved = direction === 'undo' ? history().undo(h) : history().redo(h);
    if (moved === h)
      return false;
    set(tabId, moved);
    return true;
  }

  function forget(tabId) {
    entries.delete(tabId);
  }

  // 開いているタブ（ids）に無い帯の盤を捨てる。
  function prune(ids) {
    const live = new Set(ids);
    for (const tabId of [...entries.keys()]) {
      if (!live.has(tabId))
        entries.delete(tabId);
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardStore = {
    pageKeys, remap, entryFor, set, step, forget, prune,
    ids: () => [...entries.keys()],
    clear: () => entries.clear(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
