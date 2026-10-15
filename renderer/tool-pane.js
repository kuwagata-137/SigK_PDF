(function (root) {
  'use strict';

  // ツールモードの右の欄（#tool-pane。spec-2-5 第 E 章。見本 screenshots/strips2-*.png）の出し入れ。編集モードの右パネル（#props）とは別のもの。
  //
  // 帯の画面を使うツール（STRIP_TOOLS）を選んでいる間は、真ん中に帯を出し、右の欄にそのツールの節（section.pane-tool[data-tool]）を出す。
  // そのとき <html> に data-tool-screen="strips" を付け、CSS がタブの列を隠す（確定事項B3。帯がタブの代わり）。
  // 分割は選んでいる帯を ✂ の盤に広げる（確定事項G1。split-strip.js）。画像→PDF は PDF の帯の下に「変換する画像」の帯を出す
  // （確定事項H1。image-strip.js）。2026-10-15 から、ツールモードのすべてのツールがこの画面を使う。

  const STRIP_TOOLS = Object.freeze(['merge', 'split', 'convert', 'toImage', 'watermark', 'flatten']);
  // 節を描き直す入口（tools.js の VIEWS と同じもの）。
  const VIEWS = {
    merge: 'toolsMergeList', split: 'toolsSplitView', convert: 'toolsConvertView',
    toImage: 'toolsToImageView', watermark: 'toolsWatermarkView', flatten: 'toolsFlattenView',
  };

  const state = { shown: null };
  let el = null;

  const usesStrips = (id) => STRIP_TOOLS.includes(id);

  function sectionFor(id) {
    return el?.pane.querySelector(`.pane-tool[data-tool="${id}"]`) ?? null;
  }

  // id のツールの節を出す。帯を使わないツールか null なら右の欄を隠す。帯の画面を出したかを返す。
  function show(id) {
    if (el === null)
      return false;
    const next = usesStrips(id) ? id : null;
    state.shown = next;
    el.pane.hidden = next === null;
    for (const section of el.pane.querySelectorAll('.pane-tool[data-tool]'))
      section.hidden = section.dataset.tool !== next;
    if (next === null)
      el.doc.documentElement.removeAttribute('data-tool-screen');
    else
      el.doc.documentElement.setAttribute('data-tool-screen', 'strips');
    root.SigK.strips?.setShown(next !== null);
    if (next !== null)
      sync();
    // 透かしを選んだとき・離れたときに、帯のページへの重ねを付け外しする（spec-2-5 確定事項E3）。
    root.SigK.stripWatermark?.decorate();
    // 分割を選んだとき・離れたときに、✂ の盤を帯へ入れる・戻す（確定事項G1）。
    root.SigK.splitStrip?.sync();
    // 画像→PDF を選んだとき・離れたときに、「変換する画像」の帯と受け口の文を出し替える（確定事項H1・H10）。PDF の帯の枠も付け直す。
    root.SigK.imageStrip?.render();
    root.SigK.stripDropZone?.refresh();
    root.SigK.strips?.sync();
    return next !== null;
  }

  // 出している節を描き直す（タブが変わるたびに tabs.render から）。
  function sync() {
    if (state.shown === null)
      return false;
    root.SigK[VIEWS[state.shown]]?.render();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkToolPaneReady === true)
      return false;
    const pane = doc.getElementById('tool-pane');
    if (pane === null)
      return false;
    win.__sigkToolPaneReady = true;
    el = { doc, pane };
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolPane = { STRIP_TOOLS, init, usesStrips, show, sync, sectionFor, shown: () => state.shown };
})(typeof window !== 'undefined' ? window : globalThis);
