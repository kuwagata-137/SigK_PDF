(function (root) {
  'use strict';

  // 「変換する画像」の帯のサムネイルを頼む層（spec-2-5 確定事項H5）。作るのはメイン（imageAPI.thumbnail → image-thumbnail.js）。
  //
  // 頼まれた画像（帯の見えている所。image-strip.js が決める）だけを、同時に 2 本まで頼み、できたものはパスごとに覚える。
  // 覚えるのは帯に残っている画像だけ（keep。外した画像の data URL を持ち続けない）。覚えるのは { url, width, height, px } か
  // { error }（作れなかった。画面は形式の名前を書いた紙にする）。できるたびに onReady の受け手へパスを知らせる。
  // 2026-10-23 から、作る大きさ（長い辺 px）はツールモードの紙の倍率（docs/07 決定83）と画素比（2 まで）から決める。倍率を上げて
  // 足りなくなった画像は頼み直し、届くまでは前のものを使う（枠いっぱいに引き伸ばして見せる）。

  const PARALLEL = 2;
  // 作る大きさの刻み（メインの image-thumbnail.js の THUMB_PX・thumbSize と同じ）。100% の枠の幅 104px×画素比 2。
  const STEP_PX = 208;
  const cache = new Map();
  const pending = new Set();
  const listeners = [];
  let members = new Set();
  let queue = [];

  const validPaths = (paths) => (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');

  // 今の倍率で要る大きさ。枠の幅 104px×倍率×画素比を、STEP_PX 刻みで切り上げる（100% なら画素比 2 まで 208px）。
  function wantedPx() {
    const zoom = root.SigK.toolsZoom?.get() ?? 1;
    const ratio = Math.min(2, Math.max(1, root.devicePixelRatio || 1));
    return STEP_PX * Math.max(1, Math.ceil((root.SigK.imageStripZoom?.ITEM_WIDTH ?? 104) * zoom * ratio / STEP_PX));
  }

  // 覚えていて、今の倍率に足りている（作れなかったものは頼み直さない）。
  function fresh(filePath) {
    const entry = cache.get(filePath);
    return entry !== undefined && (entry.error !== undefined || entry.px >= wantedPx());
  }

  async function ask(filePath, px) {
    const api = root.imageAPI;
    if (typeof api?.thumbnail !== 'function')
      return { error: '' };
    try {
      return await api.thumbnail(filePath, px);
    } catch {
      return { error: '' };
    }
  }

  async function load(filePath) {
    pending.add(filePath);
    const px = wantedPx();
    const result = await ask(filePath, px);
    pending.delete(filePath);
    if (!members.has(filePath))
      return;   // 作っている間に帯から外した
    // 大きく作り直せなかったときは、前に作れたものを残す（この大きさでは頼み直さない）。
    const previous = cache.get(filePath);
    if (result?.ok !== true && previous?.url !== undefined) {
      cache.set(filePath, { ...previous, px });
      return;
    }
    cache.set(filePath, result?.ok === true ? { url: result.url, width: result.width, height: result.height, px } : { error: result?.error ?? '' });
    for (const listener of listeners)
      listener(filePath);
  }

  function pump() {
    while (pending.size < PARALLEL && queue.length > 0)
      load(queue.shift()).then(pump);
  }

  // 見えている画像を頼む。前に頼んでまだ始めていない分は、新しい頼みで置き換える。
  function want(paths) {
    queue = validPaths(paths).filter((filePath) => members.has(filePath) && !fresh(filePath) && !pending.has(filePath));
    pump();
  }

  // 帯に残っている画像。ほかの画像の覚えと頼みは捨てる。
  function keep(paths) {
    members = new Set(validPaths(paths));
    for (const filePath of [...cache.keys()]) {
      if (!members.has(filePath))
        cache.delete(filePath);
    }
    queue = queue.filter((filePath) => members.has(filePath));
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageThumbs = {
    PARALLEL, STEP_PX, want, keep, wantedPx,
    get: (filePath) => cache.get(filePath) ?? null,
    onReady: (listener) => listeners.push(listener),
    getState: () => ({ cached: [...cache.keys()], pending: pending.size, queued: queue.length }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
