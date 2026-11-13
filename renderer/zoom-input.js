(function (root) {
  'use strict';

  // ツールバーの倍率の入力欄（#zoom-value。spec-7-6 確定事項ZI1〜ZI4。docs/07 決定93）。操作は今のページ番号の欄（#page-current）と同じ:
  // クリックして数字を入力し、Enter キーを押すか、ほかの所をクリックすると確定する（change）。Esc キーで入力を取り消して元の倍率に戻し、
  // 欄から抜ける（field-escape.js。Esc の振り分けは escape-order.js）。
  //
  // 読み方は viewer-layout.js の parseZoomInput（「%」・全角・小数を受け、範囲外は最大・最小にする。数字でないときは元の倍率に戻す）。
  // ツールモードでは帯の倍率（tools-zoom.js。50〜300%）、ほかのモードでは映しているタブの倍率（viewer.js。10〜1000%）を変える。
  // 入力している途中（確定する前）は、倍率が変わっても表示を上書きしない。

  const layout = () => root.SigK.viewerLayout;
  const toolsZoom = (doc) => (root.SigK.toolsZoom?.isToolsMode(doc) === true ? root.SigK.toolsZoom : null);

  // 打ち始めてから、確定・取り消し・欄から抜けるまでの間か。
  let editing = false;

  // 今の倍率（1 が 100%）。
  function current(doc) {
    return toolsZoom(doc)?.get() ?? root.SigK.viewer.getState().zoom;
  }

  const textOf = (doc) => layout().formatZoom(current(doc));

  // 表示を今の倍率にそろえる（viewer-controls.js の syncZoom から呼ぶ）。入力している途中は上書きしない。
  function show(doc, { force = false } = {}) {
    const input = doc.getElementById('zoom-value');
    if (input === null || (editing && !force))
      return false;
    input.value = textOf(doc);
    return true;
  }

  // 入力した倍率で表示する。数字でなければ元の倍率に戻す。入力を倍率として読めたら true。
  function commit(doc) {
    const input = doc.getElementById('zoom-value');
    editing = false;
    if (input === null || input.disabled)
      return false;
    const tools = toolsZoom(doc);
    const zoom = layout().parseZoomInput(input.value, tools === null ? {} : { min: tools.MIN, max: tools.MAX });
    if (zoom !== null && tools !== null)
      tools.set(zoom);
    else if (zoom !== null)
      root.SigK.viewer.setZoom(zoom);
    show(doc, { force: true });
    return zoom !== null;
  }

  function init(doc, win) {
    if (win.__sigkZoomInputReady === true)
      return false;
    const input = doc.getElementById('zoom-value');
    if (input === null)
      return false;
    win.__sigkZoomInputReady = true;

    input.addEventListener('input', () => {
      editing = true;
    });
    input.addEventListener('change', () => commit(doc));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commit(doc);
    });
    // クリックしたら数字を全部選択して、そのまま打ち直せるようにする（押した直後の mouseup で選択が外れないよう、次の順番で選ぶ）。
    input.addEventListener('focus', () => win.setTimeout(() => {
      if (doc.activeElement === input)
        input.select();
    }, 0));
    input.addEventListener('blur', () => {
      editing = false;
      show(doc);
    });
    root.SigK.fieldEscape?.bind(input, { shown: () => {
      editing = false;
      return textOf(doc);
    } });
    show(doc);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.zoomInput = { init, show, commit, isEditing: () => editing };
})(typeof window !== 'undefined' ? window : globalThis);
