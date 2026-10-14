(function (root) {
  'use strict';

  // ツールモードで開いたファイルの渡し先（決定80）。ドロップ（file-drop.js）・［開く］（tabs.js の runOpenCommand）・
  // エクスプローラーからの起動（launch.js）が使う。
  //
  // ファイルはどのモードで開いてもタブで開き、モードは変えない。ツールモードで開いたときは、移り期間として、
  // 選んでいるツールにも今までどおり渡す（将来、ツールモードは開いているタブを帯にして並べる画面になり、
  // ツールはタブを対象にする）。渡し方は、結合は一覧の末尾へ、分割・PDF→画像・フラット化は先頭の 1 本を対象に、
  // 透かしは PDF の先頭を対象に。画像→PDF は PDF を受けないので、タブで開くだけ。
  //
  // 取りやめ（パスワードの入力）のファイルは渡さない。開けなかったファイル（壊れている・タブが多すぎる）は渡す。
  // ツールはタブとは別にファイルを読み、読めなければ理由をツールの画面に出すため。

  // PDF を受けるツールと、その受け口（addPaths）を持つモジュール。single は対象が 1 本のツール。
  // 結合は帯（＝タブ）を対象にするので渡さない（開いたタブは既定で結合のチェックが入る。spec-2-5 確定事項E2）。
  const PDF_TOOLS = {
    split: { name: 'toolsSplit', single: true },
    toImage: { name: 'toolsToImage', single: true },
    watermark: { name: 'toolsWatermark', single: true },
    flatten: { name: 'toolsFlatten', single: true },
  };

  const isToolsMode = () => root.SigK.tools?.isToolsMode() === true;
  const validPaths = (paths) => (paths ?? []).filter((filePath) => typeof filePath === 'string' && filePath !== '');

  // 選んでいるツールへ PDF を渡す。渡したかを返す。
  // batchStarts は右クリックの束の最初か（launch.js）。対象が 1 本のツールは、束の 2 件目以降では差し替えない
  // （届いた順に 1 本ずつ来るので、差し替えると最後に届いたものが残る）。
  async function givePdfs(paths, { batchStarts = true } = {}) {
    const incoming = validPaths(paths);
    if (!isToolsMode() || incoming.length === 0)
      return false;
    const entry = PDF_TOOLS[root.SigK.tools.selected()];
    const tool = entry === undefined ? undefined : root.SigK[entry.name];
    if (tool === undefined || (entry.single && !batchStarts))
      return false;
    await tool.addPaths(incoming);
    return true;
  }

  // ツールモードで落とした画像。画像→PDF なら一覧へ、透かしなら透かしの画像に（PNG・JPEG。
  // 選り分けは file-drop.js が済ませている）。ほかのツールでは、画像→PDF に切り替えて一覧へ足す。
  async function giveImages(paths) {
    const incoming = validPaths(paths);
    if (!isToolsMode() || incoming.length === 0)
      return false;
    const selected = root.SigK.tools.selected();
    if (selected === 'watermark')
      return root.SigK.toolsWatermark.addPaths(incoming);
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

  // PDF を 1 本ずつタブで開き（まとめて走らせるとタブの並びが到着順で入れ替わる）、ツールモードなら選んでいる
  // ツールにも渡す。開いた数を返す。
  async function openPdfs(paths) {
    const kept = [];
    let opened = 0;
    for (const filePath of validPaths(paths)) {
      const result = await openOne(filePath);
      if (result.opened)
        opened += 1;
      if (!result.canceled)
        kept.push(filePath);
    }
    await givePdfs(kept);
    return opened;
  }

  // ツールモードのドロップ（file-drop.js が PDF と画像に選り分けて渡す）。PDF はタブで開いてツールにも渡し、
  // 画像はツールへ渡す。
  async function receiveDrop({ pdfs = [], images = [] } = {}) {
    await openPdfs(pdfs);
    await giveImages(images);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolHandoff = { givePdfs, giveImages, openOne, openPdfs, receiveDrop };
})(typeof window !== 'undefined' ? window : globalThis);
