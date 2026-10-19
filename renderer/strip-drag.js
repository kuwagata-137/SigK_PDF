(function (root) {
  'use strict';

  // ツールモードの帯のページを引いて落とす（spec-2-5 確定事項I1〜I4。見本 screenshots/strips4-drag-copy.png・strips4-drag-new.png）。
  //
  // ポインタイベントで組む（HTML5 の draggable は jsdom に載らない）。帯の紙を押して 5px 動かすと引き始める（ページ編集と同じ）。押したページが
  // 選んだページに入っていなければ、そのページだけを選び直して引き、押した帯に枠を移す（起草者の判断 I-a）。落とす先は strip-drop-target.js が
  // 決め、見た目は strip-drag-view.js が出し、離すと page-transfer.js の動かす・写す・新しい帯を呼ぶ。引き始めた帯はいつも枠の帯になる。
  //
  // 引いている途中の Esc（Esc の順の先頭。escape-order.js より先に document で受けて止める）・pointercancel・窓の blur は、何も変えずにやめる（I-e）。
  // 帯の画面の上下の端と、指の下の帯の紙の列の左右の端では自動で送る（I-f）。✂ の盤からは begin() で引き始める（split-board-input.js。G4）。

  const DRAG_THRESHOLD = 5;
  const AUTO_SCROLL = Object.freeze({ edge: 36, step: 18, sideEdge: 32, sideStep: 12, interval: 30 });

  const drag = { pending: null, active: false, tabId: null, indices: [], point: null, target: null, refusals: null, timer: 0, swallowClick: false };
  let el = null;

  const transfer = () => root.SigK.pageTransfer;
  const view = () => root.SigK.stripDragView;
  const strips = () => root.SigK.strips;

  function onPointerDown(event) {
    drag.swallowClick = false;
    if (event.button !== 0 || root.SigK.stripInput.isLocked())
      return;
    const cell = event.target?.closest?.('.strip-page[data-page]') ?? null;
    const strip = cell?.closest?.('.strip[data-tab-id]') ?? null;
    if (strip === null)
      return;
    drag.pending = { tabId: Number(strip.dataset.tabId), page: Number(cell.dataset.page), x: event.clientX, y: event.clientY };
  }

  // 押したページが選んだページに入っていなければ、そのページだけを選び直す。押した帯に枠を移す（帯のページを押したときと同じ）。
  function pick({ tabId, page }) {
    root.SigK.imageStrip?.deselect();
    root.SigK.tabs.activate(tabId);
    const held = root.SigK.stripSelection.get(tabId);
    return held.includes(page) ? held : root.SigK.stripSelection.set(tabId, [page], root.SigK.tabs.peek(tabId)?.plan ?? null);
  }

  // 落とす先ごとの断りの理由（引き始めに 1 回だけ数える）。札に出すのは最初の文だけ。
  function refusalOf(target) {
    if (target.kind !== 'copy' && target.kind !== 'new')
      return null;
    const key = target.kind === 'new' ? 'new' : target.tabId;
    if (!drag.refusals.has(key))
      drag.refusals.set(key, transfer().refusalFor({ indices: drag.indices, target }));
    const text = drag.refusals.get(key);
    return text === null ? null : `${text.split('。')[0]}。`;
  }

  function update(point) {
    drag.point = point;
    const measure = root.SigK.stripDragMeasure;
    const target = root.SigK.stripDropTarget.resolve({ ...measure.measure(el.doc, el.strips, el.zone), x: point.x, y: point.y, sourceTabId: drag.tabId });
    drag.target = { ...target, refused: refusalOf(target) };
    view().show(drag.target, { count: drag.indices.length, point, placement: measure.placementOf(el.doc, drag.target) });
    updateAutoScroll(point);
  }

  function stopAutoScroll() {
    if (drag.timer === 0)
      return;
    el.win.clearInterval(drag.timer);
    drag.timer = 0;
  }

  // 帯の画面の上下の端で縦に、指の下の帯の紙の列の左右の端で横に送る（起草者の判断 I-f）。
  function updateAutoScroll(point) {
    stopAutoScroll();
    const box = el.strips.getBoundingClientRect();
    const dy = root.SigK.pageGridRules.autoScrollStep({ y: point.y - box.top, viewportHeight: el.strips.clientHeight, edge: AUTO_SCROLL.edge, step: AUTO_SCROLL.step });
    const node = drag.target?.tabId === undefined || drag.target.place !== undefined ? null : strips().rowNode(drag.target.tabId);
    const pages = node === null ? null : root.SigK.stripRow.pagesOf(node);
    const side = pages === null ? null : pages.getBoundingClientRect();
    const dx = side === null ? 0 : (point.x < side.left + AUTO_SCROLL.sideEdge ? -1 : point.x > side.right - AUTO_SCROLL.sideEdge ? 1 : 0) * AUTO_SCROLL.sideStep;
    if (dx === 0 && dy === 0)
      return;
    drag.timer = el.win.setInterval(() => {
      el.strips.scrollTop += dy;
      if (pages !== null)
        pages.scrollLeft += dx;
      update(drag.point);
    }, AUTO_SCROLL.interval);
  }

  // 引き始める（帯からも ✂ の盤からも。G4）。indices は枠の帯（tabId）の並びの位置。canvas はカーソルに付ける絵。引けないとき（I21）は false。
  function begin({ tabId, indices, x, y, canvas = null, cells = [] }) {
    if (root.SigK.stripInput.isLocked())
      return false;
    Object.assign(drag, { pending: null, active: true, tabId, indices: [...indices], refusals: new Map() });
    view().start(el.doc, { count: indices.length, cells, canvas });
    update({ x, y });
    return true;
  }

  function onPointerMove(event) {
    if (drag.active) {
      update({ x: event.clientX, y: event.clientY });
      return;
    }
    const held = drag.pending;
    if (held === null || Math.abs(event.clientX - held.x) + Math.abs(event.clientY - held.y) < DRAG_THRESHOLD)
      return;
    const indices = pick(held);
    const node = strips().rowNode(held.tabId);
    const cells = node === null ? [] : indices.map((index) => root.SigK.stripRow.pagesOf(node).children[index]).filter(Boolean);
    begin({ tabId: held.tabId, indices, x: event.clientX, y: event.clientY, cells, canvas: root.SigK.stripThumbs?.canvasOf(held.tabId, indices[0]) ?? null });
  }

  function finish() {
    stopAutoScroll();
    view().clear();
    const { target, indices } = drag;
    Object.assign(drag, { pending: null, active: false, tabId: null, indices: [], point: null, target: null, refusals: null });
    return { target, indices };
  }

  function cancel() {
    const was = drag.active || drag.pending !== null;
    finish();
    return was;
  }

  function onPointerUp() {
    if (!drag.active) {
      drag.pending = null;
      return;
    }
    drag.swallowClick = true;
    const { target, indices } = finish();
    // 引いている途中で処理が走り始めたら（I21）、何も変えずにやめる。
    if (root.SigK.stripInput.isLocked())
      return;
    if (target?.kind === 'move')
      transfer().move(indices, target.index, { board: target.place !== undefined, box: target.box });
    else if (target?.kind === 'copy')
      transfer().copyTo(target.tabId, indices, target.index);
    else if (target?.kind === 'new')
      transfer().toNewStrip(indices);
  }

  // 引き終えたあとの click は帯の押し（strip-input.js）へ渡さない（押した帯を選び直してしまう）。帯の画面で捕まえて止める。
  function onClickCapture(event) {
    if (!drag.swallowClick)
      return;
    drag.swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !(drag.active || drag.pending !== null))
      return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  function init(doc, win) {
    if (win.__sigkStripDragReady === true)
      return false;
    const stripsNode = doc.getElementById('strips');
    const zone = doc.getElementById('strip-drop');
    if (stripsNode === null || zone === null)
      return false;
    win.__sigkStripDragReady = true;
    el = { doc, win, strips: stripsNode, zone };
    stripsNode.addEventListener('pointerdown', onPointerDown);
    stripsNode.addEventListener('click', onClickCapture, true);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('pointercancel', cancel);
    win.addEventListener('blur', cancel);
    doc.addEventListener('keydown', onKeyDown);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDrag = { DRAG_THRESHOLD, init, begin, cancel, isDragging: () => drag.active };
})(typeof window !== 'undefined' ? window : globalThis);
