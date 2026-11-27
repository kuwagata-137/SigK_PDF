(function (root) {
  'use strict';

  // 帯で選択したページの番号を、ツールの範囲欄に入力する（版 1.5.0 の②。docs/spec-7-11-view-font.md 確定事項R1〜R6）。
  //
  // 質問 RG1「案A 選択時入力」: 帯でページを選択するたびに（クリック・Ctrl/Shift＋クリック・Ctrl+A。strip-selection.js の onPick）、
  // 範囲欄を選択したページの番号に置き換え、［範囲］を選択する。手で入力した番号も置き換える。選択を解除した時は、範囲欄をそのままにする。
  // 質問 RG3「案A 4 ツール対象」: 範囲欄がある PDF→画像・透かし・フラット化（選択中の帯が対象）と、結合（ページを選択した帯の行）。
  // 質問 RG2「案C 入力なし」: 保存していない並べ替え・削除・差し込みがあり、帯の下の番号とファイルのページ番号がずれる帯では、番号を入れず、
  // 通知バーに MESSAGE を表示する（回転・トリミング・モザイクだけなら番号はずれない。strip-range.js の numberingMatches）。
  // 番号は「2-4, 7」の形（page-range.js の formatPageRange）。開けなかった帯・名前の無い帯・画像の帯・パスワード付きの帯では何もしない
  // （ツールの対象にできないので、ツールの欄が理由を表示する）。

  const MESSAGE = '保存していない並べ替えがあるので、選択したページの番号を範囲に入れませんでした。上書き保存してから、ページを選択し直してください。';

  // 1 本の帯を対象にするツール（選択中の帯。strip-target.js）。setPageMode・setRange・sync を持つ。
  const SINGLE_TOOLS = {
    toImage: () => root.SigK.toolsToImage,
    watermark: () => root.SigK.toolsWatermark,
    flatten: () => root.SigK.toolsFlatten,
  };

  let doc = null;

  function inToolsMode() {
    return doc?.documentElement.getAttribute('data-mode') === 'tools';
  }

  // 番号を入れられる帯か（ツールが読み直せる、保存してある PDF）。
  function usable(tabId) {
    const tab = root.SigK.tabs?.list().find((entry) => entry.id === tabId) ?? null;
    const view = root.SigK.tabs?.peek(tabId) ?? null;
    if (tab === null || view === null || view.doc === undefined || typeof tab.path !== 'string')
      return null;
    if (view.file?.image !== undefined || view.file?.encrypted === true)
      return null;
    return view;
  }

  // 選択したページの { matches, display, file }。選択が無い・使えない帯は null。
  function describe(tabId) {
    const view = usable(tabId);
    const indices = root.SigK.stripSelection.get(tabId);
    if (view === null || indices.length === 0)
      return null;
    return root.SigK.stripRange.describe({ plan: view.plan, pageCount: view.basePages.length, indices });
  }

  // 1 本の帯を対象にするツールでは、選択した帯が対象のときだけ入れる。対象が替わった時の設定の戻し（フラット化の reset）を
  // 先に済ませるため、入れる前に sync を呼ぶ。
  function fillSingle(tool, tabId, text) {
    tool.sync?.();
    if (root.SigK.tabs.activeId() !== tabId)
      return false;
    tool.setPageMode('range');
    tool.setRange(text);
    return true;
  }

  // 帯でページを選択した（onPick）。入れたら true。
  function fill(tabId) {
    if (!inToolsMode())
      return false;
    const selected = root.SigK.tools?.selected() ?? null;
    if (selected !== 'merge' && SINGLE_TOOLS[selected] === undefined)
      return false;
    const range = describe(tabId);
    if (range === null || range.file === '')
      return false;
    if (!range.matches) {
      root.SigK.viewBanner?.show(MESSAGE);
      return false;
    }
    if (selected === 'merge')
      return root.SigK.toolsMerge.setRange(tabId, range.file);
    const tool = SINGLE_TOOLS[selected]();
    return tool === undefined ? false : fillSingle(tool, tabId, range.file);
  }

  function init(document) {
    doc = document;
    root.SigK.stripSelection.onPick(fill);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripRangeFill = { MESSAGE, init, fill };
})(typeof window !== 'undefined' ? window : globalThis);
