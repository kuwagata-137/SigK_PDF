(function (root) {
  'use strict';

  // 閲覧の［選択］［ハンド］の状態の持ち主（spec-2-5 確定事項K。決定80 ㉒〜㉗。見本 screenshots/strips1-view-hand.png）。
  //
  // 状態（viewPointer）はアプリ全体で 1 つで、html の data-pointer に映す（閲覧・ページ編集のカーソルと文字を選ばせないのは CSS）。
  // 選んだら覚え（shell.persist）、起動時に前回の値を当てる（apply。覚え直さない。K5）。決まりは pointer-mode-rules.js、ツールバーの
  // 1 組の結線と印は pointer-mode-bar.js。編集モードでは 1 組は編集の道具（annotate-tools.js）を映し、押すと道具の段と同じに動く。

  const state = {
    doc: null,
    pointer: 'select',
  };

  function rules() {
    return root.SigK.pointerModeRules;
  }

  function modeOf() {
    return state.doc?.documentElement.getAttribute('data-mode') ?? null;
  }

  function show() {
    state.doc.documentElement.setAttribute('data-pointer', state.pointer);
    root.SigK.pointerModeBar?.sync();
  }

  // viewPointer を替える。remember が false なら覚えない（起動時の当て）。替えたら true。
  function change(pointer, { remember = true } = {}) {
    const next = rules().normalize(pointer);
    if (next === state.pointer)
      return false;
    state.pointer = next;
    show();
    if (remember)
      root.SigK.shell?.persist?.({ viewPointer: next });
    return true;
  }

  // ツールバーの 1 組を押した（K7・K8）。閲覧・ページ編集ではその方にし、編集モードでは道具の段の［選択］［ハンド］と同じ
  // （同じボタンをもう一度押すと道具なし）。ツールモードでは何もしない（K11）。
  function press(which) {
    const mode = modeOf();
    if (!rules().isUsable(mode))
      return false;
    if (mode === 'annot')
      return root.SigK.annotate.toggleTool(which);
    change(which);
    return true;
  }

  // 起動時に前回の値を当てる（K5）。覚え直さない。
  function apply(pointer) {
    if (state.doc === null)
      return state.pointer;
    change(pointer, { remember: false });
    return state.pointer;
  }

  // モードが変わった（shell.setMode）。引いている途中を終え、1 組の印（押せるか・押している方）を描き直す。
  function onModeChanged() {
    if (state.doc === null)
      return;
    root.SigK.annotateHand?.cancel();
    root.SigK.pointerModeBar?.sync();
  }

  // 編集の道具が変わった（annotate-tools.js の syncTools）。編集モードでは 1 組が道具を映すので描き直す。
  function onToolChanged() {
    if (state.doc === null)
      return;
    root.SigK.pointerModeBar?.sync();
  }

  function init(doc, win) {
    if (win.__sigkPointerModeReady === true)
      return false;
    win.__sigkPointerModeReady = true;
    state.doc = doc;
    root.SigK.pointerModeBar?.init(doc);
    show();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pointerMode = { init, get: () => state.pointer, apply, press, onModeChanged, onToolChanged };
})(typeof window !== 'undefined' ? window : globalThis);
