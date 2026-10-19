(function (root) {
  'use strict';

  // 引いているページをどこへ落とすか（spec-2-5 確定事項I2〜I4。PR-4 の起草者の判断 I-b）。DOM に触れない（座標は strip-drag.js が測って渡す）。
  //
  //   引き始めた帯の紙の列         → { kind: 'move', tabId, index }（同じ帯の中で動かす）
  //   ほかの帯の紙の列・見出し     → { kind: 'copy', tabId, index }（写す）
  //   受け口                       → { kind: 'new' }（選んだページで新しい帯）
  //   帯と帯の間・帯の外           → { kind: 'none' }
  //
  // index は並びの位置（その位置の手前へ入れる 0..ページ数）。紙の真ん中より左なら前、右なら後ろ。見出しの上と紙の列の右の空きは末尾。
  // ✂ の盤を広げた帯（board）は、盤の中の位置で決める（boardGap。G4・起草者の判断 I-k）。指の下の箱の中のページとページの間で、箱の先頭と
  // 末尾を含む。落とした先の箱の番号を box で返す（動かしたページをその箱に入れる。page-transfer.js。I20）。

  // line は strip-layout.js の row（lefts・widths は紙の列の左端からの位置）、x は紙の列の左端からの位置（横のスクロールを足したもの）。
  function gapIndex(line, x) {
    let index = 0;
    while (index < line.lefts.length && x >= line.lefts[index] + line.widths[index] / 2)
      index += 1;
    return index;
  }

  // 指の下の箱（箱の外なら近い箱。split-board-layout.js の pageAt と同じ寄せ方）。
  function nearestBox(placed, x, y) {
    let nearest = null;
    let best = Infinity;
    for (const box of placed.boxes) {
      const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
      const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        nearest = box;
      }
    }
    return nearest;
  }

  // 盤の上の落とす先（x・y は盤の器の座標）。{ index, box, place: { left, top, height } }（place は線の置き場所）か null。
  function boardGap(placed, x, y) {
    const layout = root.SigK.splitLayout;
    const box = placed === null ? null : nearestBox(placed, x, y);
    if (box === null)
      return null;
    let row = 0;
    while (row < box.rows - 1) {
      const next = layout.pageRect(placed, box.start + (row + 1) * box.columns);
      if (next === null || y < next.y - 6)
        break;
      row += 1;
    }
    const first = box.start + row * box.columns;
    const last = Math.min(box.end, first + box.columns - 1);
    let index = first;
    while (index <= last) {
      const rect = layout.pageRect(placed, index);
      if (x < rect.x + rect.width / 2)
        break;
      index += 1;
    }
    const edge = layout.pageRect(placed, Math.min(index, last));
    const left = index <= last ? edge.x - layout.CUT / 2 : edge.x + edge.width + layout.CUT / 2;
    return { index, box: box.index, place: { left, top: edge.y, height: edge.height } };
  }

  function inside(box, x, y) {
    return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
  }

  // strips は帯ごとの { tabId, left, right, top, height, pagesTop, pagesLeft, scrollLeft, line, board }、zone は受け口の箱（無ければ null）。
  function resolve({ strips, zone = null, x, y, sourceTabId }) {
    for (const strip of strips) {
      if (!inside({ left: strip.left, right: strip.right, top: strip.top, bottom: strip.top + strip.height }, x, y))
        continue;
      if (strip.board === true) {
        const gap = strip.placed === undefined ? null : boardGap(strip.placed, x - strip.canvasLeft, y - strip.canvasTop);
        if (gap === null)
          return { kind: 'none' };
        return { kind: strip.tabId === sourceTabId ? 'move' : 'copy', tabId: strip.tabId, index: gap.index, box: gap.box, place: gap.place };
      }
      const count = strip.line.lefts.length;
      const index = y < strip.pagesTop ? count : gapIndex(strip.line, x - strip.pagesLeft + strip.scrollLeft);
      return { kind: strip.tabId === sourceTabId ? 'move' : 'copy', tabId: strip.tabId, index };
    }
    if (zone !== null && inside(zone, x, y))
      return { kind: 'new' };
    return { kind: 'none' };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDropTarget = { gapIndex, boardGap, resolve };
})(typeof window !== 'undefined' ? window : globalThis);
