(function (root) {
  'use strict';

  // 分割の盤のサムネイルを描く層（spec-2-2b 確定事項D2〜D5、spec-2-5 確定事項G6・G10）。
  //
  // 2026-10-15 から、盤は選んでいる帯（タブ）の今の中身から描く（spec-2-5 G6。前は対象の PDF をもう一度読んで開いたまま持っていた）。
  // 頼まれたページ（want。index は帯の今の並びの位置）だけを、紙の枠に収まる大きさで planPageImage.draw（保存していない回転・切り取り・
  // モザイク・書き込みも描く）で描く。印（plan-page-image.js の signature）が変わった紙は描き直す。上限を超えたページと頼まれなく
  // なったページは canvas を手放して page.cleanup() を呼ぶ。帯の紙（strip-thumbs.js）とは別に数える（G10）。同時に描くのは 2 本まで。
  // 描き終えたら onDrawn で知らせ、画面（split-board-view.js）が紙の枠へ差し込む。

  // 2026-10-23 から、紙の大きさはツールモードの紙の倍率（tools-zoom.js。docs/07 決定83）で決まる（前の「大きさ 小・中・大」は無くした）。
  // 倍率が変わると紙の印が変わるので、盤を描き直す回で描き直す。描き直すまでは前の絵を枠いっぱいに引き伸ばして見せる（split-board-nodes.js）。

  const PARALLEL = 2;

  const state = { tabId: null };
  const drawn = new Map();     // ページ → { canvas, page, sig }
  const pending = new Map();   // 描いている途中の「帯の id:ページ」→ sig（帯を替えても、前の帯の描きかけと取り違えない）
  const listeners = [];
  let queue = [];
  let wanted = new Set();

  const layout = () => root.SigK.splitLayout;
  const view = () => (state.tabId === null ? null : root.SigK.tabs?.peek(state.tabId) ?? null);
  const pendingKey = (tabId, index) => `${tabId}:${index}`;
  const zoom = () => root.SigK.toolsZoom?.get() ?? 1;

  // ページの紙の大きさ（CSS px）。倍率の枠に、回転・切り取りのあとの縦横比のまま収める。
  function sheetFor(paperZoom, pageSize) {
    const cell = layout().cellOf(paperZoom);
    const width = Number(pageSize?.width);
    const height = Number(pageSize?.height);
    if (!(width > 0) || !(height > 0))
      return { width: cell.sheetWidth, height: cell.sheetHeight };
    const scale = Math.min(cell.sheetWidth / width, cell.sheetHeight / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function sigOf(index) {
    const current = view();
    const sheet = sheetFor(zoom(), current?.sizes?.[index]);
    return root.SigK.planPageImage.signature(current, index, `${sheet.width}x${sheet.height}`);
  }

  function releaseEntry({ canvas, page }) {
    root.SigK.pageImage.release(canvas);
    try {
      page?.cleanup?.();
    } catch {
      // 閉じた文書のページ。手放すものはもう無い。
    }
  }

  function releasePage(index) {
    const entry = drawn.get(index);
    if (entry === undefined)
      return;
    drawn.delete(index);
    releaseEntry(entry);
  }

  function releaseAll() {
    for (const index of [...drawn.keys()])
      releasePage(index);
    queue = [];
    wanted = new Set();
  }

  // 盤にする帯（タブ）。替わったら全部手放す。
  function setTab(tabId) {
    const next = tabId ?? null;
    if (next === state.tabId)
      return false;
    releaseAll();
    state.tabId = next;
    return true;
  }

  // pages は描く順（見えている所の中心に近い順）。先頭から cap 枚だけ持ち、ほかは手放す。
  function want(pages, { cap = layout().renderCap(zoom()) } = {}) {
    const count = view()?.plan?.length ?? 0;
    const keep = pages.filter((index) => Number.isInteger(index) && index >= 0 && index < count).slice(0, cap);
    wanted = new Set(keep);
    for (const index of [...drawn.keys()]) {
      if (!wanted.has(index))
        releasePage(index);
    }
    queue = keep.filter((index) => {
      if (pending.has(pendingKey(state.tabId, index)))
        return false;
      const sig = sigOf(index);
      return sig !== null && drawn.get(index)?.sig !== sig;
    });
    pump();
  }

  function pump() {
    while (pending.size < PARALLEL && queue.length > 0) {
      const index = queue.shift();
      draw(index).then(pump);
    }
  }

  async function draw(index) {
    const sig = sigOf(index);
    const tabId = state.tabId;
    if (sig === null)
      return;
    pending.set(pendingKey(tabId, index), sig);
    let result = null;
    try {
      const current = view();
      const sheet = sheetFor(zoom(), current.sizes?.[index]);
      result = await root.SigK.planPageImage.draw(root.document, current, index, { sheet, dpr: root.devicePixelRatio ?? 1 });
    } catch {
      result = null;   // 描けなかったページは枠のまま残す（閉じた文書・描画の取りやめ）
    }
    pending.delete(pendingKey(tabId, index));
    if (result === null)
      return;
    if (tabId !== state.tabId || !wanted.has(index) || sigOf(index) !== sig) {
      releaseEntry(result);
      if (tabId === state.tabId && wanted.has(index) && !queue.includes(index))
        queue.unshift(index);   // 描いている間に中身か大きさが変わった。新しい中身で描き直す
      return;
    }
    const previous = drawn.get(index);
    if (previous !== undefined)
      releaseEntry(previous);
    drawn.set(index, { canvas: result.canvas, page: result.page, sig });
    listeners.forEach((listener) => listener(index, result.canvas));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitThumbs = {
    setTab, want, releaseAll, sheetFor,
    onDrawn: (listener) => listeners.push(listener),
    canvasOf: (index) => drawn.get(index)?.canvas ?? null,
    zoom,
    tabId: () => state.tabId,
    getState: () => ({ tabId: state.tabId, zoom: zoom(), drawn: [...drawn.keys()].sort((a, b) => a - b), pending: pending.size }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
