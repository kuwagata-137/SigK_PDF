(function (root) {
  'use strict';

  // 編集の道具の段（spec-4b-1a 確定事項1〜7）。index.html の #edit-bar のボタンを結び、押している道具の印を揃える。
  //
  // ツールバーの下の 1 段で、編集モードのときだけ出る（出し入れは CSS）。CheckListMaker の画像エディタと同じく、
  // 四角いボタンの下に名前を置く。道具を持つ・離すのは annotate.js（toggleTool）、図形の種類は annotate-shape.js
  // （setShapeKind）が持つ。図形の 4 つのボタンは「図形の道具＋種類」で、図形の道具を持っているときに別の図形の
  // ボタンを押すと、道具を持ったまま種類だけ替わる。同じボタンをもう一度押すと離す（ほかの道具と同じ）。

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  // ボタンが表す道具を持っているか。図形は種類まで合っているとき。
  function isPressed(button, tool, shapeKind) {
    if (button.dataset.tool !== tool)
      return false;
    return button.dataset.shape === undefined || button.dataset.shape === shapeKind;
  }

  // 押している道具の印（青い地と aria-pressed）を揃える。annotate.js と annotate-shape.js が呼ぶ。
  function sync(tool, shapeKind) {
    if (el === null)
      return false;
    for (const button of el.buttons) {
      const on = isPressed(button, tool, shapeKind);
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // 押している道具が「その他」に隠れていれば「その他」に印（spec-4b-5b 確定事項27）。
    root.SigK.editBarMore?.syncPressed();
    return true;
  }

  function press(button) {
    const shape = button.dataset.shape;
    if (shape === undefined || (annotate().getTool() === 'shape' && annotate().getShapeKind() === shape))
      return annotate().toggleTool(button.dataset.tool);
    annotate().setShapeKind(shape);
    if (annotate().getTool() !== 'shape')
      annotate().setTool('shape');
    return true;
  }

  function init(doc, win) {
    if (win.__sigkEditBarReady === true)
      return false;
    const bar = doc.getElementById('edit-bar');
    if (bar === null)
      return false;
    win.__sigkEditBarReady = true;
    el = { buttons: [...bar.querySelectorAll('.edit-tool[data-tool]')] };
    for (const button of el.buttons)
      button.addEventListener('click', () => press(button));
    sync(annotate()?.getTool() ?? null, annotate()?.getShapeKind() ?? null);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.editBar = { init, sync };
})(typeof window !== 'undefined' ? window : globalThis);
