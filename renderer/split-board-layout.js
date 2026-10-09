(function (root) {
  'use strict';

  // 分割の盤の配置（spec-2-2b 確定事項C9・C10・D2・D3）。DOM に触れない。
  //
  // 見えている範囲だけ DOM を組むため（split-board-view.js）と、なぞる指の下のページを当てるため（split-board-input.js）に、
  // 位置を CSS に任せずここで決める。寸法は split-board.css と同じ値なので、変えるときは両方を直す。箱は横に並べ、入らなければ
  // 次の行へ送る（決定77 ②）。ページの多い箱は盤の幅いっぱいで折り返し、行の末尾に置く ✂ の分を空けて列を決める。

  const SIZES = Object.freeze({ small: 76, mid: 104, large: 148 });
  const CAPS = Object.freeze({ small: 120, mid: 72, large: 36 });
  const PAGE_PAD = 3;    // .sb-page の padding
  const CAPTION = 20;    // 紙と番号の間 4 と、番号の行 16
  const CUT = 26;        // ✂ の幅
  const ROW_GAP = 12;    // 紙の段の間
  const BOX = Object.freeze({ border: 1, padX: 12, padTop: 9, head: 34, padBottom: 12, minWidth: 240, gap: 12 });
  const REVEAL_MARGIN = 12;
  const MAX_DPR = 2;

  const CONTENT_LEFT = BOX.border + BOX.padX;
  const CONTENT_TOP = BOX.border + BOX.padTop + BOX.head;
  const CHROME_X = CONTENT_LEFT * 2;
  const CHROME_Y = CONTENT_TOP + BOX.padBottom + BOX.border;

  function cellOf(size) {
    const sheetWidth = SIZES[size] ?? SIZES.mid;
    const sheetHeight = Math.round(sheetWidth * Math.SQRT2);
    return { sheetWidth, sheetHeight, width: sheetWidth + PAGE_PAD * 2, height: sheetHeight + PAGE_PAD * 2 + CAPTION };
  }

  const renderCap = (size) => CAPS[size] ?? CAPS.mid;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

  // 1 つの箱の列・段・幅。
  function measureBox(count, cell, contentWidth) {
    const fit = Math.max(1, Math.floor(Math.max(0, contentWidth - CHROME_X) / (cell.width + CUT)));
    if (count <= fit)
      return { columns: count, rows: 1, width: Math.max(BOX.minWidth, count * cell.width + (count - 1) * CUT + CHROME_X) };
    return { columns: fit, rows: Math.ceil(count / fit), width: Math.max(BOX.minWidth, contentWidth) };
  }

  // boxes は split-board-model.js の boxes()（start・end を使う）。
  function layout({ boxes, contentWidth, size }) {
    const cell = cellOf(size);
    const placed = [];
    let x = 0;
    let y = 0;
    let lineHeight = 0;
    for (const box of boxes) {
      const measured = measureBox(box.end - box.start + 1, cell, contentWidth);
      if (x > 0 && x + measured.width > contentWidth) {
        y += lineHeight + BOX.gap;
        x = 0;
        lineHeight = 0;
      }
      const height = CHROME_Y + measured.rows * cell.height + (measured.rows - 1) * ROW_GAP;
      placed.push({ index: box.index, start: box.start, end: box.end, x, y, width: measured.width, height, columns: measured.columns, rows: measured.rows });
      x += measured.width + BOX.gap;
      lineHeight = Math.max(lineHeight, height);
    }
    return { size, cell, contentWidth, boxes: placed, totalHeight: placed.length === 0 ? 0 : y + lineHeight };
  }

  // ページの入っている箱（start の二分探索）。
  function boxOfPage(placed, page) {
    let low = 0;
    let high = placed.boxes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (placed.boxes[middle].start <= page)
        low = middle;
      else
        high = middle - 1;
    }
    return placed.boxes[low] ?? null;
  }

  function pageRect(placed, page) {
    const box = boxOfPage(placed, page);
    if (box === null || page < box.start || page > box.end)
      return null;
    const { cell } = placed;
    const offset = page - box.start;
    const row = Math.floor(offset / box.columns);
    const column = offset % box.columns;
    return {
      x: box.x + CONTENT_LEFT + column * (cell.width + CUT),
      y: box.y + CONTENT_TOP + row * (cell.height + ROW_GAP),
      width: cell.width,
      height: cell.height,
    };
  }

  // page の前で切る ✂ の場所。箱の頭には置かない（確定事項C1）。行の頭のページなら、前の行の末尾に置く。
  function cutRect(placed, page) {
    const box = boxOfPage(placed, page);
    if (box === null || page <= box.start || page > box.end)
      return null;
    const { cell } = placed;
    if ((page - box.start) % box.columns !== 0) {
      const rect = pageRect(placed, page);
      return { x: rect.x - CUT, y: rect.y, width: CUT, height: cell.height };
    }
    const before = pageRect(placed, page - 1);
    return { x: before.x + cell.width, y: before.y, width: CUT, height: cell.height };
  }

  // 見えている範囲（上下に overscan を足した範囲）にかかる箱とページ。
  function windowOf(placed, { scrollTop, viewportHeight, overscan = 0 }) {
    const top = scrollTop - overscan;
    const bottom = scrollTop + viewportHeight + overscan;
    const { cell } = placed;
    const step = cell.height + ROW_GAP;
    const boxes = [];
    const pages = [];
    for (let index = firstOfLine(placed, top); index < placed.boxes.length; index += 1) {
      const box = placed.boxes[index];
      if (box.y > bottom)
        break;
      if (box.y + box.height < top)
        continue;
      boxes.push(box.index);
      const contentTop = box.y + CONTENT_TOP;
      const rowFrom = Math.max(0, Math.ceil((top - contentTop - cell.height) / step));
      const rowTo = Math.min(box.rows - 1, Math.floor((bottom - contentTop) / step));
      for (let row = rowFrom; row <= rowTo; row += 1) {
        const last = Math.min(box.end, box.start + (row + 1) * box.columns - 1);
        for (let page = box.start + row * box.columns; page <= last; page += 1)
          pages.push(page);
      }
    }
    return { boxes, pages };
  }

  // top を含む行の最初の箱。それより前の行は top より上で終わっている（行の高さは箱の高さの最大なので）。
  function firstOfLine(placed, top) {
    let low = 0;
    let high = placed.boxes.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (placed.boxes[middle].y <= top) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const lineY = placed.boxes[found]?.y;
    while (found > 0 && placed.boxes[found - 1].y === lineY)
      found -= 1;
    return found;
  }

  // 指の下のページ（なぞる・押す）。箱の外なら近い箱、隙間や余白なら近いページへ寄せる。
  function pageAt(placed, x, y) {
    let nearest = null;
    let best = Infinity;
    for (const box of placed.boxes) {
      const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
      const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        nearest = box;
      }
    }
    if (nearest === null)
      return null;
    const { cell } = placed;
    const row = clamp(Math.floor((y - nearest.y - CONTENT_TOP + ROW_GAP / 2) / (cell.height + ROW_GAP)), 0, nearest.rows - 1);
    const column = clamp(Math.floor((x - nearest.x - CONTENT_LEFT + CUT / 2) / (cell.width + CUT)), 0, nearest.columns - 1);
    return Math.min(nearest.end, nearest.start + row * nearest.columns + column);
  }

  // ページが見えるようにするスクロールの位置。見えていれば今のまま。
  function scrollTopFor(placed, page, { scrollTop, viewportHeight }) {
    const rect = pageRect(placed, page);
    if (rect === null)
      return scrollTop;
    if (rect.y < scrollTop)
      return Math.max(0, rect.y - REVEAL_MARGIN);
    if (rect.y + rect.height > scrollTop + viewportHeight)
      return Math.max(0, rect.y + rect.height + REVEAL_MARGIN - viewportHeight);
    return scrollTop;
  }

  const boxTop = (placed, boxIndex) => placed.boxes[boxIndex]?.y ?? 0;

  // 紙の枠に収まる倍率（確定事項D2）。pageWidth・pageHeight は回転を当てたあとの大きさ（倍率 1 の viewport）。
  function thumbScale({ cell, pageWidth, pageHeight, devicePixelRatio = 1 }) {
    return Math.min(cell.sheetWidth / pageWidth, cell.sheetHeight / pageHeight) * Math.min(devicePixelRatio || 1, MAX_DPR);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitLayout = {
    SIZES, CUT, cellOf, renderCap, layout, pageRect, cutRect, windowOf, pageAt, scrollTopFor, boxTop, thumbScale,
  };
})(typeof window !== 'undefined' ? window : globalThis);
