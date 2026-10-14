(function (root) {
  'use strict';

  // 閲覧の［選択］［ハンド］の決まり（spec-2-5 確定事項K7〜K12。決定80 ㉒〜㉗）。DOM に触れない。状態の持ち主は pointer-mode.js。
  //
  // 状態（viewPointer）はアプリ全体で 1 つ。閲覧・ページ編集ではツールバーの 1 組がそれを映し、押す・左＋右で切り替える。
  // 編集モードでは 1 組は編集の道具（annotate-tools.js）を映し、編集の道具とはハンドかどうかだけを引き継ぐ（決定80 ㉗）。

  // settings.js の VIEW_POINTERS と同じ並びであること。プロセスが違うので import はできない。test/settings.test.js が見張る。
  const VIEW_POINTERS = Object.freeze(['select', 'hand']);
  const DEFAULT_POINTER = 'select';
  // 1 組を使えるモード（K3・K11）。ツールモードでは灰色で、左＋右も効かない。
  const USABLE_MODES = Object.freeze(['view', 'pages', 'annot']);

  function normalize(pointer) {
    return VIEW_POINTERS.includes(pointer) ? pointer : DEFAULT_POINTER;
  }

  function isUsable(mode) {
    return USABLE_MODES.includes(mode);
  }

  // ページの表示を viewPointer で動かすモード（閲覧・ページ編集）。編集モードは編集の道具で動く。
  function followsPointer(mode) {
    return mode === 'view' || mode === 'pages';
  }

  // ツールバーの 1 組で押している方（K7・K8）。編集モードでは道具が選択かハンドのときだけで、ほかの道具ではどちらも押していない（null）。
  // ツールモードでも viewPointer の方を押した形で出す（灰色。見本 screenshots/strips1-tools.png）。
  function pressedOf({ mode, pointer, tool }) {
    if (mode === 'annot')
      return VIEW_POINTERS.includes(tool) ? tool : null;
    return normalize(pointer);
  }

  // 編集の道具から決まる viewPointer（K9）。ハンドかどうかだけを見る。
  function fromTool(tool) {
    return tool === 'hand' ? 'hand' : 'select';
  }

  // 左＋右で入れ替えた先（K7）。
  function toggled(pointer) {
    return pointer === 'hand' ? 'select' : 'hand';
  }

  // 編集モードへ入るとき（起動時に編集モードで始まるときも）に合わせる編集の道具（K9・K10）。base は annotate-tools.js の戻り先
  // （道具なしか選択）。道具を変えないなら undefined、道具なしにするなら null を返す。
  function toolOnEnter(pointer, { tool, base }) {
    if (pointer === 'hand')
      return tool === 'hand' ? undefined : 'hand';
    return tool === 'hand' ? base : undefined;
  }

  // Esc の最後の段（K12。編集モードの「道具を外す」段に合わせる）。ハンドなら選択へ戻す。戻すものが無ければ null。
  function escaped(pointer) {
    return pointer === 'hand' ? 'select' : null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pointerModeRules = { VIEW_POINTERS, DEFAULT_POINTER, normalize, isUsable, followsPointer, pressedOf, fromTool, toggled, toolOnEnter, escaped };
})(typeof window !== 'undefined' ? window : globalThis);
