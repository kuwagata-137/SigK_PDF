(function (root) {
  'use strict';

  // 画像のタブで使えない道具（spec-7-1 確定事項C1〜C3）。ハイライト・下線・取り消し線・ノートを灰色にして押せなくし、説明の吹き出しを
  // 理由の文に替える。使えるかどうかの見分けは image-tab.js、道具を持たせない判定は annotate-tools.js（setTool）が同じ見分けを引く。
  //
  // sync() は viewer-controls.js の syncAll から呼ばれる（文書を開く・閉じる・タブを移る・編集する、のすべてがあの 1 本を通る）。画像の
  // タブへ移ったときに使えない道具を持っていたら、道具を離す。

  // 灰色にしたボタンの吹き出しの鍵（tip-content-edit.js）。元の鍵は data-tip-base に控えて戻す。
  const BLOCKED_TIP = Object.freeze({
    highlight: 'edit.highlight.image',
    underline: 'edit.underline.image',
    strikeout: 'edit.strikeout.image',
    note: 'edit.note.image',
  });

  let el = null;

  function currentFile() {
    return root.SigK.viewer?.getState().file ?? null;
  }

  function blocks(tool) {
    return root.SigK.imageTab?.blocksTool(currentFile(), tool) === true;
  }

  function markButton(button, blocked) {
    const tool = button.dataset.tool;
    if (button.dataset.tipBase === undefined && button.dataset.tip !== undefined)
      button.dataset.tipBase = button.dataset.tip;
    if (blocked) {
      button.setAttribute('aria-disabled', 'true');
      button.dataset.tip = BLOCKED_TIP[tool];
    } else {
      button.removeAttribute('aria-disabled');
      if (button.dataset.tipBase !== undefined)
        button.dataset.tip = button.dataset.tipBase;
    }
  }

  // 道具の段のボタンを揃え、持っている道具が使えなければ離す。
  function sync() {
    if (el === null)
      return false;
    for (const button of el.buttons)
      markButton(button, blocks(button.dataset.tool));
    const annotate = root.SigK.annotate;
    const tool = annotate?.getTool?.() ?? null;
    if (tool !== null && blocks(tool))
      annotate.setTool(null);
    return true;
  }

  function init(doc, win) {
    if (win.__sigkImageToolsReady === true)
      return false;
    const bar = doc.getElementById('edit-bar');
    if (bar === null)
      return false;
    win.__sigkImageToolsReady = true;
    el = { buttons: [...bar.querySelectorAll('.edit-tool[data-tool]')].filter((button) => BLOCKED_TIP[button.dataset.tool] !== undefined) };
    sync();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageTools = { BLOCKED_TIP, init, sync, blocks };
})(typeof window !== 'undefined' ? window : globalThis);
