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
    // 前回見た編集の道具。道具が変わったときだけ viewPointer へ写す（初期化の描き直しで、前回の値を既定の選択で上書きしないため）。
    lastTool: null,
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

  // 左＋右（K4・K7。annotate-right-button.js が押している操作を取りやめてから呼ぶ）。編集モードは編集の道具の切り替え
  // （spec-4b-3b 確定事項B）、閲覧・ページ編集は選択とハンドを入れ替えて覚える。切り替えた先を返す。
  function chord() {
    const mode = modeOf();
    if (mode === 'annot')
      return root.SigK.annotateTools.chord();
    if (!rules().followsPointer(mode))
      return null;
    change(rules().toggled(state.pointer));
    return state.pointer;
  }

  // Esc の最後の段（K12。escape-order.js が呼ぶ）。閲覧・ページ編集でハンドなら選択へ戻して覚える。戻したら true。
  function escape() {
    if (!rules().followsPointer(modeOf()))
      return false;
    const next = rules().escaped(state.pointer);
    return next !== null && change(next);
  }

  // 閲覧・ページ編集で紙を引いている途中なら取りやめる（K12。Esc の順の先頭）。取りやめたら true。引くのに使った押しは、全部の
  // ボタンを離すまで捨てる（編集モードの Esc と同じ。annotate-right-button.js の holdUntilUp）。
  function cancelPan() {
    if (!rules().followsPointer(modeOf()) || root.SigK.annotateHand?.cancel() !== true)
      return false;
    root.SigK.annotateRightButton?.holdUntilUp();
    return true;
  }

  // 閲覧・ページ編集で選んだ方を編集の道具へ映す（K9・K10。決定80 ㉗）。ハンドなら道具をハンドに、選択なら道具がハンドのときだけ
  // ハンドの前の戻り先（道具なしか選択）へ戻す。編集モードへ入るときと、起動時に編集モードで始まるときに呼ぶ。
  function syncEditTool() {
    const tools = root.SigK.annotateTools;
    const next = rules().toolOnEnter(state.pointer, { tool: tools.getTool(), base: tools.getBase() });
    if (next !== undefined)
      tools.setTool(next);
  }

  // 起動時に前回の値を当てる（K5・K10）。覚え直さない。編集モードで始まるなら編集の道具にも映す。
  function apply(pointer) {
    if (state.doc === null)
      return state.pointer;
    change(pointer, { remember: false });
    if (modeOf() === 'annot')
      syncEditTool();
    return state.pointer;
  }

  // モードが変わった（shell.setMode）。引いている途中を終え、編集モードへ入るなら編集の道具に映し、1 組の印（押せるか・押している方）を
  // 描き直す。
  function onModeChanged(mode) {
    if (state.doc === null)
      return;
    root.SigK.annotateHand?.cancel();
    if (mode === 'annot')
      syncEditTool();
    root.SigK.pointerModeBar?.sync();
  }

  // 編集の道具が変わった（annotate-tools.js の syncTools）。前回から変わったときだけ、ハンドかどうかを viewPointer へ写して覚える
  // （K9。決定80 ㉗）。編集モードでは 1 組が道具を映すので描き直す。
  function onToolChanged(tool) {
    if (state.doc === null)
      return;
    if (tool !== state.lastTool) {
      state.lastTool = tool;
      change(rules().fromTool(tool));
    }
    root.SigK.pointerModeBar?.sync();
  }

  function init(doc, win) {
    if (win.__sigkPointerModeReady === true)
      return false;
    win.__sigkPointerModeReady = true;
    state.doc = doc;
    state.lastTool = root.SigK.annotateTools?.getTool() ?? null;
    root.SigK.pointerModeBar?.init(doc);
    show();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pointerMode = { init, get: () => state.pointer, apply, press, chord, escape, cancelPan, onModeChanged, onToolChanged };
})(typeof window !== 'undefined' ? window : globalThis);
