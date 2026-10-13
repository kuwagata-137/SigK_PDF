(function (root) {
  'use strict';

  // 分割の盤のサムネイルを描く層（spec-2-2b 確定事項D1〜D8）。
  //
  // 対象の PDF を 1 回だけ読み、開いたまま持つ（tool-source.js の openPdf。対象の欄の inspect として使われる）。頼まれたページ（want）
  // だけを、紙の枠に収まる倍率で canvas に描く（page-image.js の renderToCanvas）。上限を超えたページと頼まれなくなったページは、
  // canvas を手放して page.cleanup() を呼ぶ（呼ばないと pdf.js が展開した画像を抱え続ける。spec-3-3 事前調査 B-1）。
  // 畳む（別のツールへ移る・ツールモードを抜ける）ときは全部手放して loadingTask.destroy()。広げるときは読み直し、大きさと更新日時で
  // 書き換わりを照らす（確定事項D7）。同時に走らせる描画は 2 本まで。描き終えたら onDrawn で知らせ、画面が canvas を紙の枠へ差し込む。

  const ENCRYPTED = 'パスワード付きで、保存できない PDF です';
  const PARALLEL = 2;

  const state = { path: null, task: null, doc: null, pageCount: 0, signature: null, folded: false, size: 'mid', ticket: 0, loading: null };
  const drawn = new Map();     // ページ → { canvas, page }
  const pending = new Set();   // 描いている途中のページ
  const listeners = [];
  let queue = [];
  let wanted = new Set();

  const layout = () => root.SigK.splitLayout;
  const pageImage = () => root.SigK.pageImage;
  const signatureOf = (info) => ({ size: info.size, mtimeMs: info.mtimeMs });
  const sameSignature = (a, b) => a !== null && b !== null && a.size === b.size && a.mtimeMs === b.mtimeMs;

  function releaseEntry({ canvas, page }) {
    pageImage().release(canvas);
    page?.cleanup?.();
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

  // 描きかけを捨て、全部手放し、文書を閉じる。
  async function closeDoc() {
    releaseAll();
    const task = state.task;
    state.task = null;
    state.doc = null;
    await task?.destroy?.();
  }

  // 対象が替わるとき。読んでいる途中のものも stale にする。
  function shut() {
    state.ticket += 1;
    return closeDoc();
  }

  // 読んで開く。読んでいる間に対象が替わったら、遅れて開いた文書も閉じて stale を返す。読んでいる間に畳まれたら、
  // ページ数と控えだけ覚えて閉じる（広げるときに読み直す）。
  async function adopt(filePath) {
    const ticket = (state.ticket += 1);
    const opened = await root.SigK.toolSource.openPdf(filePath, { encryptedError: ENCRYPTED });
    if (ticket !== state.ticket) {
      await opened.task?.destroy?.();
      return { reason: 'stale', error: '' };
    }
    if (opened.reason !== undefined)
      return opened;
    Object.assign(state, { pageCount: opened.info.pageCount, signature: signatureOf(opened.info) });
    if (state.folded)
      await opened.task?.destroy?.();
    else
      Object.assign(state, { task: opened.task, doc: opened.doc });
    return opened;
  }

  // 読んでいる途中かを、畳む・広げる側から見えるように持つ。
  function load(filePath) {
    const loading = (state.loading = adopt(filePath));
    loading.finally(() => { if (state.loading === loading) state.loading = null; }).catch(() => {});
    return loading;
  }

  // 対象の欄の inspect として呼ばれる。戻り値は { pageCount, name } か { reason, error }。
  async function open(filePath) {
    await shut();
    Object.assign(state, { path: filePath, pageCount: 0, signature: null });
    const opened = await load(filePath);
    if (opened.reason !== undefined)
      return { reason: opened.reason, error: opened.error };
    return { pageCount: opened.info.pageCount, name: opened.info.name };
  }

  function close() {
    Object.assign(state, { path: null, pageCount: 0, signature: null });
    return shut();
  }

  // 分割の画面を離れるとき。読んだファイルと控えは覚えておく。読んでいる途中なら、読み終えたところで閉じる（adopt）。
  async function fold() {
    state.folded = true;
    await closeDoc();
  }

  // 分割の画面に戻ったとき。読み直して、書き換わったか（changed）と、前のページ数を返す。読んでいる途中なら、その結果を使う。
  async function unfold() {
    state.folded = false;
    if (state.loading !== null)
      await state.loading;
    const previousPageCount = state.pageCount;
    if (state.folded || state.path === null || state.signature === null || state.doc !== null)
      return { ok: true, changed: false, pageCount: previousPageCount, previousPageCount };
    const previous = state.signature;
    const opened = await load(state.path);
    if (opened.reason !== undefined)
      return { reason: opened.reason, error: opened.error };
    return { ok: true, changed: !sameSignature(previous, state.signature), pageCount: opened.info.pageCount, previousPageCount };
  }

  // 読まずに、大きさと更新日時だけを照らす（［実行…］の前。確定事項D7）。照らせなければ変わったとみなす。
  async function isChanged() {
    if (state.path === null || state.signature === null)
      return false;
    const now = await root.pdfAPI?.stat?.(state.path);
    return now?.ok !== true || !sameSignature(state.signature, signatureOf(now));
  }

  // pages は描く順（見えている所の中心に近い順）。先頭から cap 枚だけ持ち、ほかは手放す。
  function want(pages, { cap = layout().renderCap(state.size) } = {}) {
    const keep = pages.filter((index) => Number.isInteger(index) && index >= 0 && index < state.pageCount).slice(0, cap);
    wanted = new Set(keep);
    for (const index of [...drawn.keys()]) {
      if (!wanted.has(index))
        releasePage(index);
    }
    queue = keep.filter((index) => !drawn.has(index) && !pending.has(index));
    pump();
  }

  function pump() {
    while (pending.size < PARALLEL && queue.length > 0 && state.doc !== null) {
      const index = queue.shift();
      pending.add(index);
      draw(index).finally(() => {
        pending.delete(index);
        pump();
      });
    }
  }

  async function draw(index) {
    const { doc, size } = state;
    let page = null;
    try {
      page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = layout().thumbScale({ cell: layout().cellOf(size), pageWidth: base.width, pageHeight: base.height, devicePixelRatio: root.devicePixelRatio ?? 1 });
      const result = await pageImage().renderToCanvas(root.document, page, { scale });
      if (doc !== state.doc || size !== state.size || !wanted.has(index)) {
        releaseEntry({ canvas: result.canvas, page });
        return;
      }
      drawn.set(index, { canvas: result.canvas, page });
      listeners.forEach((listener) => listener(index, result.canvas));
    } catch {
      page?.cleanup?.();   // 描けなかったページは枠のまま残す（描画の取りやめも含む）
    }
  }

  function setSize(size) {
    if (layout().SIZES[size] === undefined || size === state.size)
      return false;
    state.size = size;
    for (const index of [...drawn.keys()])
      releasePage(index);
    queue = [];
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitThumbs = {
    open, close, fold, unfold, isChanged, want, setSize,
    onDrawn: (listener) => listeners.push(listener),
    canvasOf: (index) => drawn.get(index)?.canvas ?? null,
    getPage: (index) => (state.doc === null ? null : state.doc.getPage(index + 1)),
    size: () => state.size,
    signature: () => state.signature,
    getState: () => ({
      path: state.path, open: state.doc !== null, folded: state.folded, pageCount: state.pageCount, size: state.size,
      drawn: [...drawn.keys()].sort((a, b) => a - b), pending: pending.size,
    }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
