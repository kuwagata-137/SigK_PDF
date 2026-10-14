(function (root) {
  'use strict';

  // ツールモードの右の欄（#tool-pane。spec-2-5 第 E 章。見本 screenshots/strips2-*.png）の出し入れ。編集モードの右パネル（#props）とは別のもの。
  //
  // 帯の画面を使うツール（STRIP_TOOLS）を選んでいる間は、真ん中に帯を出し、右の欄にそのツールの節（section.pane-tool[data-tool]）を出す。
  // そのとき <html> に data-tool-screen="strips" を付け、CSS がタブの列を隠す（確定事項B3。帯がタブの代わり）。
  // 分割と画像→PDF は PR-3 まで今の画面のまま（決定80 ㉚。確定事項D11）なので、ここには入れず、タブの列も出す。

  // PR-2 では各ツールを移すコミットで 1 つずつ足す。
  const STRIP_TOOLS = Object.freeze(['merge', 'toImage', 'flatten']);
  // 節を描き直す入口（tools.js の VIEWS と同じもの）。
  const VIEWS = { merge: 'toolsMergeList', toImage: 'toolsToImageView', flatten: 'toolsFlattenView' };

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
