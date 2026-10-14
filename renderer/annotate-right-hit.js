(function (root) {
  'use strict';

  // 編集モードの右クリックの当たり（spec-4b-3b 確定事項D3）。押した点の書き込みの鍵を返す。
  //
  // 200 行に近づいた annotate-right-button.js から移した（spec-2-5 K-4。中身は変えていない）。メニューを出すかどうかの判断は
  // annotate-right-button.js が持ち、ここは当たりだけを持つ。

  function annotate() {
    return root.SigK.annotate;
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

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateRightHit = { hitAt };
})(typeof window !== 'undefined' ? window : globalThis);
