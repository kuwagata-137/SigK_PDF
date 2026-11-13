(function (root) {
  'use strict';

  // ページサイズ処理の［複数］と［小冊子］の配置（docs/spec-7-7-print-dialog.md「配置の計算」）。DOM に触らない。

  const G = () => root.SigK.printSheetGeometry;

  // 1 枚あたりのページ数の決まった数の、列と行（長い辺の数・短い辺の数）。縦の用紙なら列が短い辺の数。
  const PRESET_GRIDS = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4] };

  function gridFor(multiple, landscape) {
    if (multiple.perSheet === 'custom')
      return { cols: G().clampInt(multiple.cols, 1, 99, 1), rows: G().clampInt(multiple.rows, 1, 99, 1) };
    const [long, short] = PRESET_GRIDS[multiple.perSheet] ?? PRESET_GRIDS[2];
    return landscape ? { cols: long, rows: short } : { cols: short, rows: long };
  }

  // 並べる順番の i 番目の枠の列と行。横＝左から右・上から下、縦＝上から下・左から右。（右から左）は列を右から数える。
  function cellAt(index, { cols, rows }, order) {
    const vertical = order === 'vertical' || order === 'verticalReversed';
    const col = vertical ? Math.floor(index / rows) : index % cols;
    const row = vertical ? index % rows : Math.floor(index / cols);
    const reversed = order === 'horizontalReversed' || order === 'verticalReversed';
    return { col: reversed ? cols - 1 - col : col, row };
  }

  function cellBox(area, grid, { col, row }) {
    const width = area.width / grid.cols;
    const height = area.height / grid.rows;
    return { x: area.x + col * width, y: area.y + row * height, width, height };
  }

  // 決まった数（2・4・6・9・16）の時に Acrobat が選ぶ用紙の向き: 最初のページが大きく印刷される向き。
  function bestMultipleOrientation(pages, paper, imageable, perSheet) {
    const first = pages.find((page) => page !== null);
    if (first === undefined)
      return 'portrait';
    const scaleFor = (landscape) => {
      const sheet = G().makeSheet(paper, imageable, landscape);
      const grid = gridFor({ perSheet }, landscape);
      return G().placeFitted(first, cellBox(sheet.area, grid, { col: 0, row: 0 })).scale;
    };
    return scaleFor(true) > scaleFor(false) + 1e-9 ? 'landscape' : 'portrait';
  }

  function nUp(pages, paper, imageable, options) {
    const multiple = options.multiple ?? {};
    const sheetBase = G().makeSheet(paper, imageable, options.orientation === 'landscape');
    const grid = gridFor(multiple, sheetBase.landscape);
    const perSheet = grid.cols * grid.rows;
    const sheets = [];
    for (let start = 0; start < pages.length; start += perSheet) {
      const items = pages.slice(start, start + perSheet).map((page, index) =>
        G().placeFitted(page, cellBox(sheetBase.area, grid, cellAt(index, grid, multiple.order)), {
          autoRotate: options.autoRotate === true,
          border: multiple.border === true,
        }));
      sheets.push({ ...sheetBase, grid, items, scalePercent: G().percent(items[0].scale) });
    }
    return { sheets, duplexMode: null };
  }

  function bookletSheetCount(pageCount) {
    return Math.max(1, Math.ceil(pageCount / 4));
  }

  // 綴じる所（用紙の中央の折り目）で分けた 2 つの枠と、ページを折り目へ寄せる向き。
  function bookletHalves(sheet, tall) {
    const { area } = sheet;
    if (tall) {
      const fold = sheet.height / 2;
      return [
        { box: { x: area.x, y: area.y, width: area.width, height: fold - area.y }, alignY: 'end' },
        { box: { x: area.x, y: fold, width: area.width, height: area.y + area.height - fold }, alignY: 'start' },
      ];
    }
    const fold = sheet.width / 2;
    return [
      { box: { x: area.x, y: area.y, width: fold - area.x, height: area.height }, alignX: 'end' },
      { box: { x: fold, y: area.y, width: area.x + area.width - fold, height: area.height }, alignX: 'start' },
    ];
  }

  // 中綴じの面付け。左綴じの n 枚目（0 起点 i）の表＝［最後から 2i 番目・先頭から 2i 番目］、裏＝［2i+1 番目・最後から 2i+1 番目］。
  function bookletSides(pages, binding) {
    const padded = [...pages];
    while (padded.length % 4 !== 0 || padded.length === 0)
      padded.push(null);
    const last = padded.length - 1;
    const mirrored = binding === 'right' || binding === 'rightTall';
    const sides = [];
    for (let i = 0; i < padded.length / 4; i += 1) {
      const front = [padded[last - 2 * i], padded[2 * i]];
      const back = [padded[2 * i + 1], padded[last - 2 * i - 1]];
      sides.push({ sheetNo: i + 1, side: 'front', pages: mirrored ? front.reverse() : front });
      sides.push({ sheetNo: i + 1, side: 'back', pages: mirrored ? back.reverse() : back });
    }
    return sides;
  }

  // method: 'both'（両面で印刷）・'front'（片面で印刷（表側））・'back'（片面で印刷（裏側））。from・to は紙の枚数で数える。
  function booklet(pages, paper, imageable, options) {
    const settings = options.booklet ?? {};
    const binding = settings.binding ?? 'left';
    const tall = binding === 'leftTall' || binding === 'rightTall';
    const method = settings.method ?? 'both';
    const count = bookletSheetCount(pages.length);
    const from = G().clampInt(settings.from ?? 1, 1, count, 1);
    const to = Math.max(from, G().clampInt(settings.to ?? count, 1, count, count));
    const sheetBase = G().makeSheet(paper, imageable, !tall);
    const halves = bookletHalves(sheetBase, tall);
    const sheets = bookletSides(pages, binding)
      .filter((side) => side.sheetNo >= from && side.sheetNo <= to)
      .filter((side) => method === 'both' || side.side === method)
      .map((side) => {
        const items = side.pages.map((page, index) => G().placeFitted(page, halves[index].box, { ...halves[index], autoRotate: options.autoRotate === true }));
        const shown = items.find((item) => item.page !== null) ?? items[0];
        return { ...sheetBase, side: side.side, sheetNo: side.sheetNo, items, scalePercent: G().percent(shown.scale) };
      });
    return { sheets, duplexMode: method === 'both' ? 'shortEdge' : 'simplex' };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSheetMulti = { gridFor, cellAt, bestMultipleOrientation, nUp, bookletSheetCount, bookletSides, booklet };
})(typeof window !== 'undefined' ? window : globalThis);
