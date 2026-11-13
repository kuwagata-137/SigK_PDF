(function (root) {
  'use strict';

  // ページサイズ処理の［ポスター］の配置（docs/spec-7-7-print-dialog.md「配置の計算」）。DOM に触らない。
  //
  // 倍率をかけたページを、印刷可能領域の大きさのタイルに分ける。隣のタイルと「重なり」の幅だけ重ね、全体をタイルの並びの中央に置く。
  // ラベル（ファイル名 日時 ページ 番号 (列,行)）を付ける時は、タイルの下にラベルの分を空ける（Claude の案。用紙の余白は 4 mm ほどしか無く、
  // 印刷可能領域の外には書けないため）。

  const G = () => root.SigK.printSheetGeometry;
  const LABEL_STRIP = 6000;

  function tileCount(length, tile, overlap) {
    if (length <= tile + 1e-6)
      return 1;
    return Math.ceil((length - overlap) / (tile - overlap) - 1e-9);
  }

  function tileArea(area, labels) {
    return labels ? { ...area, height: Math.max(area.height / 2, area.height - LABEL_STRIP) } : { ...area };
  }

  // 重なりの端（隣のタイルと重ならない部分の四隅）。タイルマークはここに描く。
  function coreRect(box, { col, row, cols, rows }, overlap) {
    const left = col > 0 ? overlap : 0;
    const top = row > 0 ? overlap : 0;
    return { x: box.x + left, y: box.y + top, width: box.width - left, height: box.height - top };
  }

  function sizeAt(page, scale, rotation) {
    const size = G().pageSize(page);
    const turned = rotation === 90;
    return { width: (turned ? size.height : size.width) * scale, height: (turned ? size.width : size.height) * scale };
  }

  function tilesFor(page, box, scale, overlap, autoRotate) {
    const count = (rotation) => {
      const size = sizeAt(page, scale, rotation);
      return { rotation, size, cols: tileCount(size.width, box.width, overlap), rows: tileCount(size.height, box.height, overlap) };
    };
    const straight = count(0);
    if (!autoRotate)
      return straight;
    const turned = count(90);
    return turned.cols * turned.rows < straight.cols * straight.rows ? turned : straight;
  }

  function layoutPage(page, sheetBase, settings) {
    const scale = G().clampNumber(settings.scale ?? 100, 1, 1000, 100) / 100;
    const area = sheetBase.area;
    const pageItem = (box, rotation) => ({ page: page.number, ...G().place(G().pageSize(page), scale, box, { rotation }), border: false, clip: null });
    if (settings.largeOnly === true) {
      const size = sizeAt(page, scale, 0);
      if (size.width <= area.width + 1e-6 && size.height <= area.height + 1e-6)
        return [{ ...sheetBase, tile: null, items: [pageItem(area, 0)], scalePercent: G().percent(scale) }];
    }

    const box = tileArea(area, settings.labels === true);
    const maxOverlap = Math.min(box.width, box.height) / 2;
    const overlap = G().clampNumber((settings.overlap ?? 0) * G().UM_PER_MM, 0, maxOverlap, 0);
    const { rotation, size, cols, rows } = tilesFor(page, box, scale, overlap, settings.autoRotate === true);
    const stepX = box.width - overlap;
    const stepY = box.height - overlap;
    const offsetX = (cols * stepX + overlap - size.width) / 2;
    const offsetY = (rows * stepY + overlap - size.height) / 2;
    const sheets = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const at = { x: box.x - col * stepX + offsetX, y: box.y - row * stepY + offsetY, width: size.width, height: size.height };
        const item = { ...pageItem(at, rotation), clip: { ...box } };
        sheets.push({
          ...sheetBase,
          items: [item],
          scalePercent: G().percent(scale),
          tile: {
            col: col + 1, row: row + 1, cols, rows,
            marks: settings.tileMarks === true,
            core: coreRect(box, { col, row, cols, rows }, overlap),
            label: settings.labels === true ? { page: page.number, col: col + 1, row: row + 1 } : null,
            labelBox: settings.labels === true ? { x: area.x, y: box.y + box.height, width: area.width, height: area.y + area.height - box.y - box.height } : null,
          },
        });
      }
    }
    return sheets;
  }

  function poster(pages, paper, imageable, options) {
    const settings = { ...(options.poster ?? {}), autoRotate: options.autoRotate === true };
    const sheetBase = G().makeSheet(paper, imageable, options.orientation === 'landscape');
    return { sheets: pages.flatMap((page) => layoutPage(page, sheetBase, settings)), duplexMode: null };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSheetPoster = { LABEL_STRIP, tileCount, poster };
})(typeof window !== 'undefined' ? window : globalThis);
