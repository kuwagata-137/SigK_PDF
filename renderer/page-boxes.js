(function (root) {
  'use strict';

  // 紙全体の大きさ（MediaBox）を読む口（spec-4b-6a 確定事項9・10）。
  //
  // pdf.js は MediaBox を返さない（page.view は CropBox との重なり）。トリミングを外して紙全体に戻すには、ワーカーでファイルを読む
  // （pdfAPI.readBoxes → worker/page-boxes-task.js）。文書ごとに 1 回だけ読み、ファイルのパス・大きさ・更新時刻を鍵にして持つ。
  // タブを替えても読み直さず、保存して開き直すと大きさか更新時刻が変わるので読み直す。読めなかったファイル（暗号化・壊れている・
  // 時間切れ）は読み直さず、呼ぶ側が開いたときの見える範囲（page.view）で代える。

  // 鍵 → { boxes, promise }。boxes は読めたらページ順の配列、読めなければ null、読んでいる間は undefined。
  const cache = new Map();

  function keyOf(file) {
    if (typeof file?.path !== 'string' || file.path === '')
      return null;
    return JSON.stringify([file.path, file.size ?? null, file.mtimeMs ?? null]);
  }

  async function read(file) {
    const api = root.pdfAPI;
    if (api?.available !== true || typeof api.readBoxes !== 'function')
      return null;
    try {
      const result = await api.readBoxes({ source: file.path, expect: { size: file.size, mtimeMs: file.mtimeMs } });
      return result?.ok === true && Array.isArray(result.boxes) ? result.boxes : null;
    } catch {
      return null;
    }
  }

  // file（viewer の getState().file）の紙全体を読む。読み終えたら boxes（読めなければ null）で解ける。2 回目からは同じものを返す。
  function load(file) {
    const key = keyOf(file);
    if (key === null)
      return Promise.resolve(null);
    const known = cache.get(key);
    if (known !== undefined)
      return known.promise;
    const entry = { boxes: undefined, promise: null };
    entry.promise = read(file).then((boxes) => {
      entry.boxes = boxes;
      return boxes;
    });
    cache.set(key, entry);
    return entry.promise;
  }

  // 'none'（まだ読んでいない）・'loading'（読んでいる）・'ready'（読めた）・'failed'（読めなかった）。
  function statusOf(file) {
    const entry = cache.get(keyOf(file));
    if (entry === undefined)
      return 'none';
    if (entry.boxes === undefined)
      return 'loading';
    return entry.boxes === null ? 'failed' : 'ready';
  }

  // 元ページ src の紙全体 [x1, y1, x2, y2]。読めていなければ null。
  function mediaBoxOf(file, src) {
    const boxes = cache.get(keyOf(file))?.boxes;
    return Array.isArray(boxes) ? root.SigK.pageCrop.normalizeBox(boxes[src]) : null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageBoxes = { load, statusOf, mediaBoxOf };
})(typeof window !== 'undefined' ? window : globalThis);
