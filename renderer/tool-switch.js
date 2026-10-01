(function (root) {
  'use strict';

  // 道具の行き来（spec-4b-3b 確定事項B。モック screenshots/phase4b-3-tools.png）。DOM に触れない。annotate-tools.js が使う。
  //
  // N＝道具なし（null）、S＝選択、H＝ハンド、D＝描く道具（マークアップ・テキスト・図形・ペン・ノート）。道具を切り替えるのは
  // 左＋右・道具のボタン・Esc だけで、紙の空白の右クリックでは切り替えない（決定53 ⑥）。戻り先（base）は最後に持っていた N か S
  // （既定は N）で、左＋右でハンドから戻る先になる。

  // 戻り先になる道具。
  const BASES = Object.freeze([null, 'select']);

  // 道具が tool になったときの戻り先。N か S なら覚え直し、H・D なら変えない（確定事項B1）。
  function remember(base, tool) {
    return BASES.includes(tool) ? tool : base;
  }

  // via は 'chord'（左＋右）・'button'（道具のボタン。pressed はそのボタンの道具）・'escape'（Esc で道具を外す）。
  // 次の { tool, base } を返す。
  function next({ tool, base }, via, pressed = null) {
    const target = targetOf(tool, base, via, pressed);
    return { tool: target, base: remember(base, target) };
  }

  function targetOf(tool, base, via, pressed) {
    if (via === 'chord')
      return tool === 'hand' ? base : 'hand';
    if (via === 'button')
      return tool === pressed ? null : pressed;
    if (via === 'escape')
      return null;
    return tool;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolSwitch = { BASES, remember, next };
})(typeof window !== 'undefined' ? window : globalThis);
