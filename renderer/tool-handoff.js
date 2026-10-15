(function (root) {
  'use strict';

  // ツールモードで開いたファイルの渡し先（決定80）。ドロップ（file-drop.js）・帯の受け口（strip-drop-zone.js）・エクスプローラーからの
  // 起動（launch.js）が使う。
  //
  // ファイルはどのモードで開いてもタブで開き、モードは変えない。2026-10-14 からツールモードは開いているタブを帯にして並べる画面になり
  // （spec-2-5 第 D 章）、結合・分割・PDF→画像・透かし・フラット化は帯（＝タブ）を対象にするので、PDF を渡す相手はいない（開いた帯が
  // そのまま結合の行・選んでいる帯になる。分割は 2026-10-15 から。spec-2-5 確定事項G13）。画像は画像→PDF と透かしへ渡す。

  const isToolsMode = () => root.SigK.tools?.isToolsMode() === true;
  const validPaths = (paths) => (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');

  // ツールモードで落とした画像。画像→PDF なら「変換する画像」の帯へ、透かしなら透かしの画像に（PNG・JPEG。toolsWatermark.addImages。
  // 選り分けは file-drop.js が済ませている）。ほかのツールでは、画像→PDF に切り替えて「変換する画像」の帯へ足す（spec-2-5 確定事項H1）。
  async function giveImages(paths) {
    const incoming = validPaths(paths);
    if (!isToolsMode() || incoming.length === 0)
      return false;
    const selected = root.SigK.tools.selected();
    if (selected === 'watermark')
      return root.SigK.toolsWatermark.addImages(incoming);
    if (selected !== 'convert')
      root.SigK.tools.select('convert');
    await root.SigK.toolsConvert.addPaths(incoming);
    return true;
  }

  // 1 本をタブで開く。{ opened, canceled }（canceled はパスワードの入力を取りやめた）。
  // 開けなかった理由は tabs.js が出す（ツールモードでは帯）。
  async function openOne(filePath) {
    const call = { canceled: false };
    const opened = await root.SigK.tabs.openPath(filePath, call);
    return { opened, canceled: call.canceled };
  }

  // PDF を 1 本ずつタブで開く（まとめて走らせるとタブの並びが到着順で入れ替わる）。開いた数を返す。
  async function openPdfs(paths) {
    let opened = 0;
    for (const filePath of validPaths(paths)) {
      const result = await openOne(filePath);
      if (result.opened)
        opened += 1;
    }
    return opened;
  }

  // ツールモードのドロップ（file-drop.js が PDF と画像に選り分けて渡す）。PDF はタブで開き、画像はツールへ渡す。
  async function receiveDrop({ pdfs = [], images = [] } = {}) {
    await openPdfs(pdfs);
    await giveImages(images);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolHandoff = { giveImages, openOne, openPdfs, receiveDrop };
})(typeof window !== 'undefined' ? window : globalThis);
