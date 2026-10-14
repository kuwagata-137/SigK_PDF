(function (root) {
  'use strict';

  // 閲覧・ページ編集のハンドで紙を引く（spec-2-5 確定事項K1。見本 screenshots/strips1-view-hand.png）。
  //
  // viewPointer がハンドのとき、#view の中を左で押すと、どこでも（紙の上・灰色の所）表示を引き始める。引くこと自体は編集モードの
  // ハンド（spec-4b-3b 確定事項A）と同じ annotate-hand.js が持ち、動きと離しは annotate-pointer.js の経路（annotate-drag-route.js。
  // モードを見ない）が受ける。左＋右の同時押しの振り分けは annotate-pointer.js が先に受ける（この受け口はその後に登録する）。

  const state = {
    doc: null,
  };

  function rightButton() {
    return root.SigK.annotateRightButton;
  }

  // 左だけで押したか。左＋右（buttons に右が入る）と、左＋右の後に全部離すまでの押しは引かない。
  function isLeftOnly(event) {
    return (event.button ?? 0) === 0 && ((event.buttons ?? 1) & 2) === 0 && rightButton()?.isChording() !== true;
  }

  function wantsPan(event) {
    const mode = state.doc.documentElement.getAttribute('data-mode');
    return isLeftOnly(event)
      && root.SigK.pointerModeRules.followsPointer(mode)
      && root.SigK.pointerMode.get() === 'hand'
      && root.SigK.viewer?.getState().open === true;
  }

  function onMouseDown(event) {
    if (wantsPan(event))
      root.SigK.annotateHand.begin(event);
  }

  function init(doc, win) {
    if (win.__sigkViewPanReady === true)
      return false;
    win.__sigkViewPanReady = true;
    state.doc = doc;
    doc.getElementById('view')?.addEventListener('mousedown', onMouseDown);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.viewPan = { init };
})(typeof window !== 'undefined' ? window : globalThis);
