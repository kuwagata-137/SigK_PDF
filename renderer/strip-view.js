(function (root) {
  'use strict';

  // ツールモードの帯の画面（spec-2-5 第 D 章。見本 screenshots/strips2-merge.png）。開いているタブを 1 本ずつ帯にし、タブの並びのとおり
  // 上から並べる。状態の持ち主はタブだけで、ここはタブを描くだけ（並び・選択・閉じるは tabs の関数を呼ぶ）。
  //
  // 合図は tabs.render()（タブの並び・選択・未保存の印が変わるたび）・読み込んだ書き込みの届け・帯のスクロール・窓の大きさ・紙の倍率
  // （strip-zoom.js から）から来る。隠れている間は旗だけ立て、出したときに合わせる。帯ごとに中身の参照（文書・並び・書き込み・寸法）と
  // 紙の倍率（docs/07 決定83）が前と同じなら見出しだけを直す。描くのは見えている所だけ（strip-layout.js・strip-thumbs.js）。

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
      // 名前の無い帯（新しい帯）は、フロッピーとファイル名の説明の吹き出しを替える（spec-2-5 J14）。
      untitled: view?.file?.untitled === true,
      // 「変換する画像」の帯に枠があるときは、PDF の帯に枠を付けない（spec-2-5 確定事項H7）。
      failed, dirty: tabs.isDirty(tab.id), first: index === 0, last: index === count - 1, selected: tab.active && root.SigK.imageStrip?.hasFrame() !== true,
    });
    rowParts().showNote(row.node, failed ? view?.error ?? '' : null);
    const refs = failed ? null : rowParts().contentOf(view);
    const same = rowParts().sameContent(row.refs, refs);
    const zoom = layout().zoom();
    if (!same || row.zoom !== zoom) {
      Object.assign(row, { refs, zoom, line: layout().row(refs?.sizes ?? [], zoom) });
      rowParts().syncPages(row.node, row.line.sheets);
      rowParts().setHeight(row.node, layout().stripHeight(zoom));
      if (refs !== null && !same)
        selection().onPlanChanged(tab.id, refs.plan);
    }
    rowParts().markPicked(row.node, selection().get(tab.id));
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
    // 並びが変わったときだけ並べ直す。
    if (layout().moved(state.order, ids)) {
      rowParts().place(el.strips, ids.map((id) => state.rows.get(id).node), el.anchor);
      state.order = ids;
    }
    root.SigK.stripDropZone?.render({ big: ids.length === 0, recent: root.SigK.recentPanel?.entries() ?? [] });
    root.SigK.stripWatermark?.decorate();
    // 分割を選んでいれば、選んでいる帯に ✂ の盤を入れる（spec-2-5 確定事項G1）。
    root.SigK.splitStrip?.sync();
    root.SigK.toolsZoom?.syncToolbar();   // 帯の数が変わると、紙の倍率の［－］［＋］の灰色も変わる
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

  // 帯ごとの高さ。分割の ✂ の盤を入れた帯だけは、中身に合わせた高さ（spec-2-5 確定事項G9）。
  function heights() {
    const host = root.SigK.splitStrip?.hostId() ?? null;
    const height = layout().stripHeight(layout().zoom());
    return state.order.map((id) => (id === host ? rowNode(id)?.offsetHeight || height : height));
  }

  // 見えている帯と紙を数えて、描く分を strip-thumbs.js へ渡す（1 フレームに 1 回）。盤を広げた帯の紙は、盤の層（split-thumbs.js）が描く。
  function update() {
    if (!state.shown)
      return;
    const width = el.strips.clientWidth;
    const height = el.strips.clientHeight;
    const strips = layout().visibleStrips(state.order.length, el.strips.scrollTop, height, undefined, heights());
    const expanded = root.SigK.splitStrip?.expanded() === true ? root.SigK.splitStrip.hostId() : null;
    const items = [];
    for (let index = strips.from; index < strips.to; index += 1) {
      const id = state.order[index];
      const row = state.rows.get(id);
      if (row === undefined || row.refs === null || id === expanded)
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

  // 描けた紙を帯へ入れ、手放した紙を外す（strip-thumbs.js の知らせ）。
  function onDrawn(tabId, index, canvas) {
    const node = rowNode(tabId);
    if (node !== null)
      rowParts().putCanvas(node, index, canvas);
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
    // PDF の帯は「変換する画像」の帯（spec-2-5 確定事項H4）の前、無ければ受け口の前に並べる。
    el = { doc, win, screen, strips, anchor: doc.getElementById('image-strip') ?? dropZone };
    // 帯の縦のスクロールと、帯の中の横のスクロール（scroll は泡立たないので捕まえる側で受ける）。
    strips.addEventListener('scroll', schedule, true);
    win.addEventListener('resize', schedule);
    root.SigK.stripThumbs.onDrawn(onDrawn);
    selection().onChange((tabId) => {
      const node = rowNode(tabId);
      if (node !== null)
        rowParts().markPicked(node, selection().get(tabId));
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  // 帯の紙の列の並べ方（strip-layout.js の row）。引いて落とす先の計算に使う（strip-drag.js。spec-2-5 確定事項I2〜I4）。
  const lineOf = (tabId) => state.rows.get(tabId)?.line ?? null;

  SigK.strips = { init, sync, setShown, schedule, forget: drop, isShown: () => state.shown, rowNode, lineOf, heights, getState };
})(typeof window !== 'undefined' ? window : globalThis);
