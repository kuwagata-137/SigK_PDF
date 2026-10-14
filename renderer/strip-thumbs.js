(function (root) {
  'use strict';

  // 帯の紙の絵を描いて持つ（spec-2-5 確定事項D8。危ない所「メモリ」）。描く形は分割の盤（split-thumbs.js の want・pump・draw）と同じ。
  //
  // 鍵は `${tabId}:${index}`（index は plan の位置）。中身の印（sig）は「文書・plan の要素・差し込み・書き込み・紙の大きさ」で、
  // 印が変わった紙は描き直す（描き直すまでは前の絵を残す）。全部の帯の合計で LIMIT 枚まで持ち、同時に描くのは PARALLEL 本まで。
  // 手放すときは canvas を空にし、ページの資源も cleanup する。描いた・手放したことは onDrawn の受け手（strip-view.js）へ知らせる。

  const drawn = new Map();     // key → { tabId, index, canvas, page, sig }
  const pending = new Map();   // key → sig
  let queue = [];
  let wanted = new Set();
  const listeners = [];
  const docIds = new WeakMap();
  let nextDocId = 1;
  // 描き始めた回数（起動確認で、描き直しが止まっていることを見る）。
  let draws = 0;

  const layout = () => root.SigK.stripLayout;
  const keyOf = (tabId, index) => `${tabId}:${index}`;

  function docId(doc) {
    if (doc === null || doc === undefined)
      return 0;
    if (!docIds.has(doc))
      docIds.set(doc, nextDocId++);
    return docIds.get(doc);
  }

  // 紙の印。null は描けない（開けなかったタブ・無い位置）。
  function sigOf(tabId, index) {
    const view = root.SigK.tabs.peek(tabId);
    const entry = view?.plan?.[index];
    if (view?.doc === undefined || entry === undefined)
      return null;
    const sheet = layout().sheetOf(view.sizes[index]);
    const added = Number.isInteger(entry.insert) ? view.inserts?.[entry.insert] : null;
    const insert = added === null ? '' : `${docId(added?.doc)}/${added?.page ?? 0}`;
    const annots = Number.isInteger(entry.src) ? root.SigK.annotationState.annotsOnPage(view.annots, view.imported, entry.src) : [];
    return `${docId(view.doc)}|${JSON.stringify(entry)}|${insert}|${JSON.stringify(annots)}|${sheet.width}x${sheet.height}`;
  }

  function notify(tabId, index, canvas) {
    listeners.forEach((listener) => listener(tabId, index, canvas));
  }

  function releaseEntry(entry) {
    root.SigK.pageImage.release(entry.canvas);
    try {
      entry.page?.cleanup?.();
    } catch {
      // 閉じた文書のページ。手放すものはもう無い。
    }
  }

  function release(key) {
    const entry = drawn.get(key);
    if (entry === undefined)
      return;
    drawn.delete(key);
    releaseEntry(entry);
    notify(entry.tabId, entry.index, null);
  }

  // items は描く順（strip-layout の drawOrder）。先頭から LIMIT 枚だけ持ち、ほかは手放す。
  function want(items) {
    const keep = (items ?? []).slice(0, layout().LIMIT);
    wanted = new Set(keep.map((item) => keyOf(item.tabId, item.page)));
    for (const key of [...drawn.keys()]) {
      if (!wanted.has(key))
        release(key);
    }
    queue = keep.filter((item) => {
      const key = keyOf(item.tabId, item.page);
      if (pending.has(key))
        return false;
      const sig = sigOf(item.tabId, item.page);
      return sig !== null && drawn.get(key)?.sig !== sig;
    });
    pump();
  }

  function pump() {
    while (pending.size < layout().PARALLEL && queue.length > 0) {
      const item = queue.shift();
      draw(item.tabId, item.page).then(pump);
    }
  }

  async function draw(tabId, index) {
    const key = keyOf(tabId, index);
    const sig = sigOf(tabId, index);
    if (sig === null)
      return;
    pending.set(key, sig);
    draws += 1;
    let result = null;
    try {
      const view = root.SigK.tabs.peek(tabId);
      const sheet = layout().sheetOf(view.sizes[index]);
      result = await root.SigK.planPageImage.draw(root.document, view, index, { sheet, dpr: root.devicePixelRatio ?? 1 });
    } catch {
      result = null;   // 描けなかった紙（閉じた文書・描画の取りやめ）は枠のまま残す
    }
    pending.delete(key);
    if (result === null)
      return;
    if (!wanted.has(key) || sigOf(tabId, index) !== sig) {
      releaseEntry(result);
      if (wanted.has(key) && !queue.some((item) => keyOf(item.tabId, item.page) === key))
        queue.unshift({ tabId, page: index });   // 描いている間に中身が変わった。新しい中身で描き直す
      return;
    }
    // 前の紙は canvas と一緒にページの資源も手放す（保存して読み直した文書なら、前のページは古い文書のもの。点検の直し）。
    const previous = drawn.get(key);
    if (previous !== undefined)
      releaseEntry(previous);
    drawn.set(key, { tabId, index, canvas: result.canvas, page: result.page, sig });
    notify(tabId, index, result.canvas);
  }

  // そのタブの紙を全部手放す（タブを閉じる前。文書を畳む前に呼ぶ）。
  function forget(tabId) {
    const prefix = `${tabId}:`;
    for (const key of [...drawn.keys()]) {
      if (key.startsWith(prefix))
        release(key);
    }
    queue = queue.filter((item) => item.tabId !== tabId);
    wanted = new Set([...wanted].filter((key) => !key.startsWith(prefix)));
  }

  function releaseAll() {
    wanted = new Set();
    queue = [];
    for (const key of [...drawn.keys()])
      release(key);
  }

  function canvasOf(tabId, index) {
    return drawn.get(keyOf(tabId, index))?.canvas ?? null;
  }

  function onDrawn(listener) {
    listeners.push(listener);
  }

  function getState() {
    return { drawn: drawn.size, pending: pending.size, queued: queue.length, draws, keys: [...drawn.keys()] };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripThumbs = { want, forget, releaseAll, canvasOf, onDrawn, getState };
})(typeof window !== 'undefined' ? window : globalThis);
