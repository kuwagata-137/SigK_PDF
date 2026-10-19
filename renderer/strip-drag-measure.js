(function (root) {
  'use strict';

  // 引いて落とす先を決めるために、帯の箱・紙の列・✂ の盤・受け口の画面の上の位置を測る（strip-drag.js。spec-2-5 確定事項I2〜I4・G4）。
  // 測った形は strip-drop-target.js の resolve へそのまま渡す。jsdom のテストは各要素の getBoundingClientRect を差し替えて位置を与える。
  // 200 行に収めるために strip-drag.js から分けた。

  function stripOf(doc, node, hostId) {
    const tabId = Number(node.dataset.tabId);
    const box = node.getBoundingClientRect();
    const base = { tabId, left: box.left, right: box.right, top: box.top, height: box.height };
    // ✂ の盤を広げた帯は、盤の中の位置で決める（G4）。盤がまだ描けていなければ（layout が null）落とす先にしない。
    if (tabId === hostId) {
      const canvas = doc.getElementById('split-board-canvas')?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return { ...base, board: true, placed: root.SigK.splitBoardView?.layout() ?? null, canvasLeft: canvas.left, canvasTop: canvas.top };
    }
    const pages = root.SigK.stripRow.pagesOf(node);
    const pagesBox = pages.getBoundingClientRect();
    return {
      ...base, board: false, pagesTop: pagesBox.top, pagesLeft: pagesBox.left, scrollLeft: pages.scrollLeft,
      line: root.SigK.strips.lineOf(tabId) ?? root.SigK.stripLayout.row([]),
    };
  }

  // strips は #strips、zone は受け口（#strip-drop）。
  function measure(doc, strips, zone) {
    const hostId = root.SigK.splitStrip?.expanded() === true ? root.SigK.splitStrip.hostId() : null;
    const rows = [...strips.querySelectorAll('.strip[data-tab-id]')].map((node) => stripOf(doc, node, hostId));
    const box = zone.getBoundingClientRect();
    return { strips: rows, zone: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
  }

  // 線を置く器と位置（strip-drag-view.js の show へ渡す）。帯なら紙の列の中の紙と紙の間、盤なら盤の器の中（target.place）。無ければ null。
  function placementOf(doc, target) {
    if (target.place !== undefined)
      return { container: doc.getElementById('split-board-canvas'), ...target.place };
    const node = target.tabId === undefined ? null : root.SigK.strips.rowNode(target.tabId);
    const line = target.tabId === undefined ? null : root.SigK.strips.lineOf(target.tabId);
    if (node === null || line === null)
      return null;
    return { container: root.SigK.stripRow.pagesOf(node), left: root.SigK.stripDragView.lineLeft(line, target.index) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDragMeasure = { measure, placementOf };
})(typeof window !== 'undefined' ? window : globalThis);
