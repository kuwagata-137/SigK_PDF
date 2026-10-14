(function (root) {
  'use strict';

  // ツールバーの［選択］［ハンド］の 1 組（spec-2-5 確定事項K2・K3・K8・K11。見本 screenshots/strips1-view-hand.png）。
  //
  // 押している方に active と aria-pressed を付け、ツールモードでは両方を灰色（aria-disabled）にする。押している方は、閲覧・ページ編集・
  // ツールでは viewPointer、編集モードでは編集の道具が選択かハンドのときだけ（pointer-mode-rules.js の pressedOf）。押した後の動きは
  // pointer-mode.js の press。押し下げは文書で受ける（ツールバーの保存のボタンと同じ形）。

  const BUTTONS = Object.freeze({ 'btn-pointer-select': 'select', 'btn-pointer-hand': 'hand' });
  const SELECTOR = Object.keys(BUTTONS).map((id) => `#${id}`).join(', ');

  const state = {
    doc: null,
  };

  function sync() {
    if (state.doc === null)
      return;
    const rules = root.SigK.pointerModeRules;
    const mode = state.doc.documentElement.getAttribute('data-mode');
    const pressed = rules.pressedOf({ mode, pointer: root.SigK.pointerMode.get(), tool: root.SigK.annotateTools?.getTool() ?? null });
    const disabled = String(!rules.isUsable(mode));
    for (const [id, which] of Object.entries(BUTTONS)) {
      const button = state.doc.getElementById(id);
      if (button === null)
        continue;
      button.classList.toggle('active', pressed === which);
      button.setAttribute('aria-pressed', String(pressed === which));
      button.setAttribute('aria-disabled', disabled);
    }
  }

  function onClick(event) {
    const button = event.target?.closest?.(SELECTOR);
    if (button === null || button === undefined || button.getAttribute('aria-disabled') === 'true')
      return;
    root.SigK.pointerMode.press(BUTTONS[button.id]);
  }

  function init(doc) {
    if (state.doc !== null)
      return false;
    state.doc = doc;
    doc.addEventListener('click', onClick);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pointerModeBar = { init, sync };
})(typeof window !== 'undefined' ? window : globalThis);
