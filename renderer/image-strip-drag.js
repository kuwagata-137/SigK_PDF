(function (root) {
  'use strict';

  // 「変換する画像」の帯の画像を横に引いて並べ替える（spec-2-5 確定事項H6）。前の一覧の行を縦に引く row-drag.js を、横向きに作り直した。
  //
  // ポインタイベントで組む（HTML5 の draggable は jsdom に載らない）。4px 動いたら引き始め、落とす先は画像の真ん中より左か右かで決め、
  // その間に縦の線（.img-drop-line）を出す。帯の端に近づくと横に送る。離すと tools-convert.js の moveTo へ渡す。
  // 引いている途中の Esc は取りやめ（Esc の順の先頭。escape-order.js より先に document で受けて止める。前の row-drag.js と同じ）。

  const DRAG_THRESHOLD = 4;
  const EDGE = 32;
  const EDGE_STEP = 12;

  const drag = { pending: false, active: false, id: null, at: null, startX: 0, line: null };
  let el = null;

  const convert = () => root.SigK.toolsConvert;
  const itemNodes = () => [...el.items.querySelectorAll('.img-item')];
  const itemById = (id) => el.items.querySelector(`.img-item[data-id="${id}"]`);
  const isLocked = () => convert().isRunning() || root.SigK.save?.isBusy() === true;

  function dropIndexFor(x) {
    let at = 0;
    for (const node of itemNodes()) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left + rect.width / 2)
        at += 1;
    }
    return at;
  }

  // 線は画像と画像の間（間 12px の真ん中）。いちばん後ろなら最後の画像の右。
  function showLine(at) {
    const nodes = itemNodes();
    if (nodes.length === 0)
      return;
    if (drag.line === null) {
      drag.line = el.doc.createElement('div');
      drag.line.className = 'img-drop-line';
      el.items.append(drag.line);
    }
    const left = at >= nodes.length ? nodes.at(-1).offsetLeft + nodes.at(-1).offsetWidth + 5 : nodes[at].offsetLeft - 7;
    drag.line.style.left = `${left}px`;
  }

  function nudge(x) {
    const rect = el.items.getBoundingClientRect();
    if (rect.width === 0)
      return;
    if (x < rect.left + EDGE)
      el.items.scrollLeft -= EDGE_STEP;
    else if (x > rect.right - EDGE)
      el.items.scrollLeft += EDGE_STEP;
  }

  function endDrag() {
    if (drag.id !== null)
      itemById(drag.id)?.classList.remove('dragging');
    drag.line?.remove();
    Object.assign(drag, { pending: false, active: false, id: null, at: null, line: null });
  }

  function onPointerDown(event) {
    if (event.button !== 0 || isLocked() || (event.target?.closest?.('button') ?? null) !== null)
      return;
    const node = event.target?.closest?.('.img-item') ?? null;
    if (node === null)
      return;
    Object.assign(drag, { pending: true, id: node.dataset.id, startX: event.clientX });
  }

  function onPointerMove(event) {
    if (!drag.pending)
      return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD)
        return;
      drag.active = true;
      itemById(drag.id)?.classList.add('dragging');
    }
    nudge(event.clientX);
    drag.at = dropIndexFor(event.clientX);
    showLine(drag.at);
  }

  function onPointerUp(event) {
    if (!drag.active) {
      endDrag();
      return;
    }
    const { id, at } = drag;
    const inside = el.items.contains(event.target);
    endDrag();
    if (inside && at !== null)
      convert().moveTo(id, at);
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !(drag.active || drag.pending))
      return;
    event.preventDefault();
    endDrag();
  }

  function init(doc, win) {
    if (win.__sigkImageStripDragReady === true)
      return false;
    const items = doc.getElementById('image-strip-items');
    if (items === null)
      return false;
    win.__sigkImageStripDragReady = true;
    el = { doc, items };
    items.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    // タッチやペンで引くと pointerup の代わりに pointercancel が来る。窓が非活性になると pointerup が届かないことがある。
    // どちらも並びを変えずにやめる（引いている途中のまま残すと、次のクリックで並びが変わる。点検で見つかった。✂ の盤と同じ）。
    doc.addEventListener('pointercancel', endDrag);
    win.addEventListener('blur', endDrag);
    doc.addEventListener('keydown', onKeyDown);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageStripDrag = { DRAG_THRESHOLD, init, dropIndexFor, isDragging: () => drag.active };
})(typeof window !== 'undefined' ? window : globalThis);
