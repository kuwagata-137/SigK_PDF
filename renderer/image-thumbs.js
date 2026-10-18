(function (root) {
  'use strict';

  // 「変換する画像」の帯のサムネイルを頼む層（spec-2-5 確定事項H5）。作るのはメイン（imageAPI.thumbnail → image-thumbnail.js）。
  //
  // 頼まれた画像（帯の見えている所。image-strip.js が決める）だけを、同時に 2 本まで頼み、できたものはパスごとに覚える。
  // 覚えるのは帯に残っている画像だけ（keep。外した画像の data URL を持ち続けない）。覚えるのは { url, width, height } か
  // { error }（作れなかった。画面は形式の名前を書いた紙にする）。できるたびに onReady の受け手へパスを知らせる。

  const PARALLEL = 2;
  const cache = new Map();
  const pending = new Set();
  const listeners = [];
  let members = new Set();
  let queue = [];

  const validPaths = (paths) => (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');

  async function ask(filePath) {
    const api = root.imageAPI;
    if (typeof api?.thumbnail !== 'function')
      return { error: '' };
    try {
      return await api.thumbnail(filePath);
    } catch {
      return { error: '' };
    }
  }

  async function load(filePath) {
    pending.add(filePath);
    const result = await ask(filePath);
    pending.delete(filePath);
    if (!members.has(filePath))
      return;   // 作っている間に帯から外した
    cache.set(filePath, result?.ok === true ? { url: result.url, width: result.width, height: result.height } : { error: result?.error ?? '' });
    for (const listener of listeners)
      listener(filePath);
  }

  function pump() {
    while (pending.size < PARALLEL && queue.length > 0)
      load(queue.shift()).then(pump);
  }

  // 見えている画像を頼む。前に頼んでまだ始めていない分は、新しい頼みで置き換える。
  function want(paths) {
    queue = validPaths(paths).filter((filePath) => members.has(filePath) && !cache.has(filePath) && !pending.has(filePath));
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
    PARALLEL, want, keep,
    get: (filePath) => cache.get(filePath) ?? null,
    onReady: (listener) => listeners.push(listener),
    getState: () => ({ cached: [...cache.keys()], pending: pending.size, queued: queue.length }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
