(function (root) {
  'use strict';

  // 編集モードの右ボタン（spec-4b-3b 確定事項D）。
  //
  // 右の押し離しでは描かない・置かない・掴まない・選ばない（spec-4b-3a 確定事項B1）。右の mousedown は既定の動きを止めて、今ある
  // 文字の選択を残す（事前調査 B）。メニューを出すかどうかは、離した後に届く contextmenu で決める（事前調査 A）。書き込みの上
  // （選んでいる書き込みの枠の余白を含む）なら、選んでいなければそれだけを選んでから「削除」のメニュー（annotation-menu.js）を
  // 押した点に出す。紙の空白では何もしない（道具も替えない。決定53 ⑥）。ハンドのときも同じ。押しの振り分けは annotate-pointer.js。

  const state = {
    doc: null,
    // 入力欄を閉じた右の押しの印。swallow は mouseup で消えるので、続く contextmenu を飲むためにここで覚える（事前調査 K）。
    swallowedRight: false,
  };

  function annotate() {
    return root.SigK.annotate;
  }

  function menu() {
    return root.SigK.annotationMenu;
  }

  function inAnnotMode() {
    return state.doc?.documentElement.getAttribute('data-mode') === 'annot';
  }

  function isOpen() {
    return root.SigK.viewer?.getState().open === true;
  }

  function inEditor(event) {
    return (event.target?.closest?.('.free-text-editor') ?? null) !== null;
  }

  // 右で押した（左＋右でないとき）。swallowed は、その押しが入力欄かメニューを閉じるのに使われたか（確定事項D6）。
  function down(event, { swallowed = false } = {}) {
    state.swallowedRight = swallowed;
    if (swallowed || !inAnnotMode() || !isOpen() || inEditor(event))
      return;
    event.preventDefault();
  }

  // 選んでいる書き込みの枠（余白を含む）の中か。一覧で選んだ表示のみの書き込みも、枠が見えていれば当たりにする（確定事項D3）。
  function frameHit(page) {
    const shown = root.SigK.annotationFrame?.shown() ?? null;
    if (shown === null || shown.index !== page.index)
      return null;
    const pad = root.SigK.annotationFrame.FRAME_PADDING;
    const [x, y] = page.point;
    const entries = annotate().selectedEntries().filter((entry) => entry !== null);
    for (const entry of entries.reverse()) {
      const key = root.SigK.annotationLayer.keyOf(entry);
      if (!shown.keys.includes(key))
        continue;
      const box = root.SigK.annotationFrame.boundsOf(entry, shown.viewport);
      if (x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad)
        return key;
    }
    return null;
  }

  // 押した点の書き込みの鍵。紙の外・空白なら null。
  function hitAt(event) {
    const page = root.SigK.annotatePress.pageAt(event);
    if (page === null)
      return null;
    return annotate().hitTest(page.index, page.point) ?? frameHit(page);
  }

  function onContextMenu(event) {
    if (!inAnnotMode() || !isOpen() || inEditor(event))
      return;
    event.preventDefault();
    const swallowed = state.swallowedRight;
    state.swallowedRight = false;
    if (swallowed)
      return;
    const key = hitAt(event);
    if (key === null) {
      menu()?.close();
      return;
    }
    if (!annotate().isSelected(key))
      annotate().select(key);
    menu()?.open(event.clientX, event.clientY);
  }

  function init(doc, win) {
    if (win.__sigkAnnotateRightButtonReady === true)
      return false;
    win.__sigkAnnotateRightButtonReady = true;
    state.doc = doc;
    doc.getElementById('view')?.addEventListener('contextmenu', onContextMenu);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateRightButton = { init, down };
})(typeof window !== 'undefined' ? window : globalThis);
