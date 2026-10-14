(function (root) {
  'use strict';

  // ツールモードの帯の画面（spec-2-5 第 D 章。見本 screenshots/strips2-merge.png）。開いているタブを 1 本ずつ帯にし、タブの並びのとおり
  // 上から並べる。状態の持ち主はタブだけで、ここはタブを描くだけ（並び・選択・閉じるは tabs の関数を呼ぶ）。
  //
  // 合図は tabs.render()（タブの並び・選択・未保存の印が変わるたび）・読み込んだ書き込みの届け・帯のスクロール・窓の大きさから来る。
  // 隠れている間は旗だけ立て、出したときに合わせる。帯ごとに中身の参照（文書・並び・書き込み・寸法）が前と同じなら見出しだけを直す。
  // 描くのは見えている所だけ（strip-layout.js・strip-thumbs.js）。

  const state = {
    shown: false,
    stale: true,
    frame: 0,
    order: [],
    // tabId → { node, refs, line }
    rows: new Map(),
  };
  let el = null;

  const layout = () => root.SigK.stripLayout;
  const rowParts = () => root.SigK.stripRow;
  const selection = () => root.SigK.stripSelection;

  function refsOf(view) {
    const { doc, plan, annots, imported, inserts, sizes } = view;
    return { doc, plan, annots, imported, inserts, sizes };
  }

  function sameRefs(a, b) {
    if (a === null || b === null)
      return a === b;
    return Object.keys(a).every((key) => a[key] === b[key]);
  }

  function drop(tabId) {
    const row = state.rows.get(tabId);
    if (row === undefined)
      return;
    row.node.remove();
    state.rows.delete(tabId);
    state.order = state.order.filter((id) => id !== tabId);
    root.SigK.stripThumbs?.forget(tabId);
    selection().forget(tabId);
  }

  function rowFor(tabId) {
    let row = state.rows.get(tabId);
    if (row === undefined) {
      row = { node: rowParts().create(el.doc, tabId), refs: null, line: layout().row([]) };
      state.rows.set(tabId, row);
    }
    return row;
  }

  function syncRow(tab, index, count) {
    const tabs = root.SigK.tabs;
    const row = rowFor(tab.id);
    const view = tabs.peek(tab.id);
    const failed = view === null || view.doc === undefined;
    rowParts().updateHead(row.node, {
      no: index + 1, name: tab.name, path: tab.path, pages: failed ? 0 : view.sizes.length, encrypted: view?.file?.encrypted === true,
      failed, dirty: tabs.isDirty(tab.id), first: index === 0, last: index === count - 1, selected: tab.active,
    });
    rowParts().showNote(row.node, failed ? view?.error ?? '' : null);
    const refs = failed ? null : refsOf(view);
    if (!sameRefs(row.refs, refs)) {
      row.refs = refs;
      row.line = layout().row(refs?.sizes ?? []);
      rowParts().syncPages(row.node, row.line.sheets);
      if (refs !== null)
        selection().onPlanChanged(tab.id, refs.plan);
    }
    rowParts().markPicked(row.node, selection().get(tab.id));
  }

  // 並びが変わったときだけ並べ直す。動かすと横のスクロールが戻るので、控えて戻す。
  function place(ids) {
    const kept = ids.map((id) => [rowParts().pagesOf(state.rows.get(id).node), rowParts().pagesOf(state.rows.get(id).node).scrollLeft]);
    for (const id of ids)
      el.strips.insertBefore(state.rows.get(id).node, el.drop);
    for (const [pages, left] of kept)
      pages.scrollLeft = left;
  }

  function reconcile() {
    state.stale = false;
    const list = root.SigK.tabs.list();
    const ids = list.map((tab) => tab.id);
    for (const id of [...state.rows.keys()]) {
      if (!ids.includes(id))
        drop(id);
    }
    list.forEach((tab, index) => syncRow(tab, index, list.length));
    if (layout().moved(state.order, ids)) {
      place(ids);
      state.order = ids;
    }
    root.SigK.stripDropZone?.render({ big: ids.length === 0, recent: root.SigK.recentPanel?.entries() ?? [] });
    schedule();
  }

  function sync() {
    if (el === null)
      return false;
    if (!state.shown) {
      state.stale = true;
      return false;
    }
    reconcile();
    return true;
  }

  // 見えている帯と紙を数えて、描く分を strip-thumbs.js へ渡す（1 フレームに 1 回）。
  function update() {
    if (!state.shown)
      return;
    const width = el.strips.clientWidth;
    const height = el.strips.clientHeight;
    const strips = layout().visibleStrips(state.order.length, el.strips.scrollTop, height);
    const items = [];
    for (let index = strips.from; index < strips.to; index += 1) {
      const id = state.order[index];
      const row = state.rows.get(id);
      if (row === undefined || row.refs === null)
        continue;
      const pages = rowParts().pagesOf(row.node);
      const cells = layout().visibleCells(row.line, pages.scrollLeft, width - layout().PAGES_INSET);
      const nearStrip = index < strips.first || index >= strips.last;
      for (let page = cells.from; page < cells.to; page += 1)
        items.push({ strip: index, page, tabId: id, near: nearStrip || page < cells.first || page >= cells.last });
    }
    root.SigK.stripThumbs?.want(layout().drawOrder(items));
  }

  function schedule() {
    if (el === null || !state.shown || state.frame !== 0)
      return;
    const raf = el.win.requestAnimationFrame?.bind(el.win) ?? ((fn) => el.win.setTimeout(fn, 16));
    state.frame = raf(() => {
      state.frame = 0;
      update();
    });
  }

  function setShown(on) {
    const next = on === true;
    if (el === null || next === state.shown)
      return false;
    state.shown = next;
    el.screen.hidden = !next;
    if (next)
      reconcile();
    else
      root.SigK.stripThumbs?.releaseAll();
    return true;
  }

  function rowNode(tabId) {
    return state.rows.get(tabId)?.node ?? null;
  }

  // 描けた紙を帯へ入れ、手放した紙を空にする（strip-thumbs.js の知らせ）。
  function onDrawn(tabId, index, canvas) {
    const node = rowNode(tabId);
    const sheet = node === null ? null : rowParts().sheetAt(node, index);
    if (sheet === null)
      return;
    if (canvas === null)
      sheet.replaceChildren();
    else
      sheet.replaceChildren(canvas);
  }

  function getState() {
    return { shown: state.shown, ids: [...state.order], stale: state.stale };
  }

  function init(doc, win) {
    if (win.__sigkStripsReady === true)
      return false;
    const screen = doc.getElementById('strips-screen');
    const strips = doc.getElementById('strips');
    const dropZone = doc.getElementById('strip-drop');
    if (screen === null || strips === null || dropZone === null)
      return false;
    win.__sigkStripsReady = true;
    el = { doc, win, screen, strips, drop: dropZone };
    // 帯の縦のスクロールと、帯の中の横のスクロール（scroll は泡立たないので捕まえる側で受ける）。
    strips.addEventListener('scroll', schedule, true);
    win.addEventListener('resize', schedule);
    root.SigK.stripThumbs.onDrawn(onDrawn);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.strips = { init, sync, setShown, schedule, forget: drop, isShown: () => state.shown, rowNode, getState };
})(typeof window !== 'undefined' ? window : globalThis);
