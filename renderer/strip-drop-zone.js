(function (root) {
  'use strict';

  // 帯の画面のいちばん下の受け口（spec-2-5 確定事項D7。見本 screenshots/strips2-merge.png・strips2-empty.png）。
  // 落としたファイルは file-drop.js がタブで開く（ここはドロップを受けない）。［ファイルを選ぶ…］は複数の PDF を選んでタブで開く。
  // 帯が 1 本も無いときは真ん中全体を大きな受け口にし、最近使ったファイル（先頭 5 件）を出す。
  // 画像→PDF を選んでいるときは、文を替え、［ファイルを選ぶ…］で PDF と画像の両方を選べる（PDF は帯、画像は「変換する画像」の帯へ。確定事項H10）。

  const RECENT_LIMIT = 5;
  const TEXT = 'PDF をここへ落とすと、開いて帯に足します';
  const BIG_TEXT = 'PDF を落とすか［ファイルを選ぶ…］で選ぶと、ここにページの帯が並びます';
  const CONVERT_TEXT = 'PDF か画像をここへ落とすと足します（画像は「変換する画像」の帯へ）';
  const CONVERT_BIG_TEXT = 'PDF か画像を落とすか［ファイルを選ぶ…］で選ぶと、PDF は帯、画像は「変換する画像」の帯に並びます';
  const PDF_PATH = /\.pdf$/i;

  let el = null;
  let last = {};
  // 選ぶ窓を開いている間は、もう一度押しても開かない。
  let picking = false;

  // フォルダーを短く見せる（見本 screenshots/strips2-empty.png の「C:\Users\…\書類」）。元のパスは行の説明の吹き出しに残す。
  function shortFolder(filePath) {
    const parts = String(filePath).split(/[\\/]/).slice(0, -1);
    return parts.length <= 3 ? parts.join('\\') : [parts[0], parts[1], '…', parts.at(-1)].join('\\');
  }

  function recentRow(entry) {
    const row = el.doc.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.dataset.path = entry.path;
    // 説明の吹き出しは（ファイル名, フルパス）（spec-2-5 J5）。
    root.SigK.tipContent.text(row, entry.name, entry.path);
    const name = el.doc.createElement('span');
    name.className = 'n';
    name.textContent = entry.name;
    const where = el.doc.createElement('span');
    where.className = 'p';
    where.textContent = shortFolder(entry.path);
    row.append(name, where);
    return row;
  }

  const forConvert = () => root.SigK.toolPane?.shown() === 'convert';

  // big は帯が 1 本も無いとき。recent は最近使ったファイルの並び（recentPanel.entries）。
  function render({ big = false, recent = [] } = {}) {
    if (el === null)
      return false;
    last = { big, recent };
    el.zone.classList.toggle('big', big);
    el.text.textContent = forConvert() ? (big ? CONVERT_BIG_TEXT : CONVERT_TEXT) : (big ? BIG_TEXT : TEXT);
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

  // 画像→PDF なら PDF と画像を選ぶ窓（pickConvertSources）、ほかは PDF を選ぶ窓（pickOpenSources）。
  async function pick() {
    const api = root.pdfAPI;
    const convert = forConvert();
    const ask = convert ? api?.pickConvertSources : api?.pickOpenSources;
    if (picking || api?.available !== true || typeof ask !== 'function')
      return false;
    picking = true;
    try {
      const result = await ask();
      if (result?.canceled === true || !Array.isArray(result?.paths))
        return false;
      if (convert) {
        const pdfs = result.paths.filter((filePath) => PDF_PATH.test(filePath));
        await root.SigK.toolHandoff.receiveDrop({ pdfs, images: result.paths.filter((filePath) => !PDF_PATH.test(filePath)) });
      } else {
        await root.SigK.toolHandoff.openPdfs(result.paths);
      }
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
  // refresh はツールを替えたときに、前と同じ中身で文だけ出し替える（tool-pane.js）。
  SigK.stripDropZone = { RECENT_LIMIT, init, render, pick, refresh: () => render(last) };
})(typeof window !== 'undefined' ? window : globalThis);
