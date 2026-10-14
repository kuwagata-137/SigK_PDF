(function (root) {
  'use strict';

  // 帯の画面のいちばん下の受け口（spec-2-5 確定事項D7。見本 screenshots/strips2-merge.png・strips2-empty.png）。
  // 落としたファイルは file-drop.js がタブで開く（ここはドロップを受けない）。［ファイルを選ぶ…］は複数の PDF を選んでタブで開く。
  // 帯が 1 本も無いときは真ん中全体を大きな受け口にし、最近使ったファイル（先頭 5 件）を出す。

  const RECENT_LIMIT = 5;
  const TEXT = 'PDF をここへ落とすと、開いて帯に足します';
  const BIG_TEXT = 'PDF を落とすか［ファイルを選ぶ…］で選ぶと、ここにページの帯が並びます';

  let el = null;
  // 選ぶ窓を開いている間は、もう一度押しても開かない。
  let picking = false;

  // フォルダーを短く見せる（見本 screenshots/strips2-empty.png の「C:\Users\…\書類」）。元のパスは行の説明（title）に残す。
  function shortFolder(filePath) {
    const parts = String(filePath).split(/[\\/]/).slice(0, -1);
    return parts.length <= 3 ? parts.join('\\') : [parts[0], parts[1], '…', parts.at(-1)].join('\\');
  }

  function recentRow(entry) {
    const row = el.doc.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.dataset.path = entry.path;
    row.title = entry.path;
    const name = el.doc.createElement('span');
    name.className = 'n';
    name.textContent = entry.name;
    const where = el.doc.createElement('span');
    where.className = 'p';
    where.textContent = shortFolder(entry.path);
    row.append(name, where);
    return row;
  }

  // big は帯が 1 本も無いとき。recent は最近使ったファイルの並び（recentPanel.entries）。
  function render({ big = false, recent = [] } = {}) {
    if (el === null)
      return false;
    el.zone.classList.toggle('big', big);
    el.text.textContent = big ? BIG_TEXT : TEXT;
    const rows = big ? recent.slice(0, RECENT_LIMIT) : [];
    if (rows.length === 0) {
      el.recent.replaceChildren();
      el.recent.hidden = true;
      return true;
    }
    const title = el.doc.createElement('div');
    title.className = 'ttl';
    title.textContent = '最近使ったファイル';
    el.recent.replaceChildren(title, ...rows.map(recentRow));
    el.recent.hidden = false;
    return true;
  }

  async function pick() {
    const api = root.pdfAPI;
    if (picking || api?.available !== true || typeof api.pickOpenSources !== 'function')
      return false;
    picking = true;
    try {
      const result = await api.pickOpenSources();
      if (result?.canceled === true || !Array.isArray(result?.paths))
        return false;
      await root.SigK.toolHandoff.openPdfs(result.paths);
      return true;
    } finally {
      picking = false;
    }
  }

  function onClick(event) {
    if ((event.target.closest?.('#strip-drop-pick') ?? null) !== null) {
      pick();
      return;
    }
    const row = event.target.closest?.('[data-path]') ?? null;
    if (row !== null)
      root.SigK.toolHandoff.openPdfs([row.dataset.path]);
  }

  function init(doc, win) {
    if (win.__sigkStripDropReady === true)
      return false;
    const zone = doc.getElementById('strip-drop');
    if (zone === null)
      return false;
    win.__sigkStripDropReady = true;
    el = { doc, zone, text: doc.getElementById('strip-drop-text'), recent: doc.getElementById('strip-drop-recent') };
    zone.addEventListener('click', onClick);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDropZone = { RECENT_LIMIT, init, render, pick };
})(typeof window !== 'undefined' ? window : globalThis);
