(function (root) {
  'use strict';

  // 引いているページをどこへ落とすか（spec-2-5 確定事項I2〜I4。PR-4 の起草者の判断 I-b）。DOM に触れない（座標は strip-drag.js が測って渡す）。
  //
  //   引き始めた帯の紙の列         → { kind: 'move', tabId, index }（同じ帯の中で動かす）
  //   ほかの帯の紙の列・見出し     → { kind: 'copy', tabId, index }（写す）
  //   受け口                       → { kind: 'new' }（選んだページで新しい帯）
  //   帯と帯の間・帯の外・盤の帯   → { kind: 'none' }
  //
  // index は並びの位置（その位置の手前へ入れる 0..ページ数）。紙の真ん中より左なら前、右なら後ろ。見出しの上と紙の列の右の空きは末尾。
  // ✂ の盤を広げた帯（board）は、盤の中の位置で決める（split-board-input.js。G4）ので、ここでは落とす先にしない。

  // line は strip-layout.js の row（lefts・widths は紙の列の左端からの位置）、x は紙の列の左端からの位置（横のスクロールを足したもの）。
  function gapIndex(line, x) {
    let index = 0;
    while (index < line.lefts.length && x >= line.lefts[index] + line.widths[index] / 2)
      index += 1;
    return index;
  }

  function inside(box, x, y) {
    return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
  }

  // strips は帯ごとの { tabId, left, right, top, height, pagesTop, pagesLeft, scrollLeft, line, board }、zone は受け口の箱（無ければ null）。
  function resolve({ strips, zone = null, x, y, sourceTabId }) {
    for (const strip of strips) {
      if (!inside({ left: strip.left, right: strip.right, top: strip.top, bottom: strip.top + strip.height }, x, y))
        continue;
      if (strip.board === true)
        return { kind: 'none' };
      const count = strip.line.lefts.length;
      const index = y < strip.pagesTop ? count : gapIndex(strip.line, x - strip.pagesLeft + strip.scrollLeft);
      return { kind: strip.tabId === sourceTabId ? 'move' : 'copy', tabId: strip.tabId, index };
    }
    if (zone !== null && inside(zone, x, y))
      return { kind: 'new' };
    return { kind: 'none' };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.stripDropTarget = { gapIndex, resolve };
})(typeof window !== 'undefined' ? window : globalThis);
