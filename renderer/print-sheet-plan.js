(function (root) {
  'use strict';

  // 用紙 1 枚ごとの配置の計算（docs/spec-7-7-print-dialog.md「配置の計算」）。DOM に触らない。
  //
  // 受け取るもの: 印刷するページ（{ number, width, height }。大きさは pt で、回転と切り取りを当てた後の見た目の大きさ）、
  // 用紙（縦の寸法 µm）、その用紙の印刷可能領域（µm）、印刷画面の指定、プリンターの用紙サイズ一覧。
  // 返すもの: シート（用紙 1 枚の片面）の並び。シートは、向き・寸法・印刷可能領域と、ページを置く枠（items）を持つ。
  // 枠の座標はシートの向きで見た µm。ページの画像は枠の大きさに描き、rotation の分だけ時計回りに回す。
  // ページサイズ処理（mode）: 'size'（サイズ）・'poster'（ポスター）・'multiple'（複数）・'booklet'（小冊子）。

  const G = () => root.SigK.printSheetGeometry;
  // 一度に印刷できる用紙の枚数の上限（Claude の案。ポスターは 1 ページが何百枚にもなるため。ページ数の上限 100 とは別に数える）。
  const MAX_SHEETS = 300;

  function sizeScale(fit, size, area, custom) {
    if (fit === 'actual')
      return 1;
    if (fit === 'custom')
      return custom;
    const fitted = G().fitScale(size.width, size.height, area);
    return fit === 'shrink' ? Math.min(1, fitted) : fitted;
  }

  // サイズ: 合わせる（fit）・実際のサイズ（actual）・特大ページを縮小（shrink）・カスタム倍率（custom）。
  // 印刷可能領域に合わせて縮小・拡大した時は印刷可能領域の中央、そのほかは用紙の中央に置く。
  function sizeLayout(pages, paper, imageable, options, paperSizes) {
    const settings = options.size ?? {};
    const fit = settings.fit ?? 'fit';
    const custom = G().clampNumber(settings.scale ?? 100, 1, 1000, 100) / 100;
    const orientation = options.orientation ?? 'auto';
    const sheets = pages.map((page) => {
      const size = G().pageSize(page);
      const usePaper = settings.choosePaper === true ? G().pickPaper(size, paperSizes, paper) : paper;
      const area = usePaper === paper ? imageable : G().imageableFor(usePaper, paper, imageable);
      const landscape = orientation === 'landscape' || (orientation === 'auto' && size.width > size.height);
      const sheet = G().makeSheet(usePaper, area, landscape);
      const scale = sizeScale(fit, size, sheet.area, custom);
      const toArea = fit === 'fit' || (fit === 'shrink' && scale < 1);
      const box = toArea ? sheet.area : { x: 0, y: 0, width: sheet.width, height: sheet.height };
      const item = { page: page.number, ...G().place(size, scale, box), border: false, clip: null };
      return { ...sheet, items: [item], scalePercent: G().percent(scale) };
    });
    return { sheets, duplexMode: null };
  }

  function layout(pages, paper, imageable, options, paperSizes) {
    const mode = options.mode ?? 'size';
    if (mode === 'poster')
      return root.SigK.printSheetPoster.poster(pages, paper, imageable, options);
    if (mode === 'multiple')
      return root.SigK.printSheetMulti.nUp(pages, paper, imageable, options);
    if (mode === 'booklet')
      return root.SigK.printSheetMulti.booklet(pages, paper, imageable, options);
    return sizeLayout(pages, paper, imageable, options, paperSizes);
  }

  // duplexMode: 小冊子が決める両面の指定（'shortEdge'・'simplex'）。null なら、用紙の両面に印刷(B) の指定に従う。
  function build({ pages, paper, imageable, options = {}, paperSizes = [] }) {
    if (!Array.isArray(pages) || pages.length === 0)
      return { error: '印刷するページがありません。' };
    const result = layout(pages, paper, imageable, options ?? {}, paperSizes);
    if (result.sheets.length > MAX_SHEETS)
      return { error: `用紙が ${result.sheets.length} 枚になります。一度に印刷できる用紙は ${MAX_SHEETS} 枚までです。` };
    return result;
  }

  // 用紙サイズが変わる所で、印刷を分ける（質問 PR3 ④）。
  function groupJobs(sheets) {
    const jobs = [];
    for (const sheet of sheets) {
      const last = jobs[jobs.length - 1];
      const same = last !== undefined && last.paper.width === sheet.paper.width && last.paper.height === sheet.paper.height;
      if (same)
        last.sheets.push(sheet);
      else
        jobs.push({ paper: sheet.paper, sheets: [sheet] });
    }
    return jobs;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSheetPlan = {
    MAX_SHEETS,
    build,
    groupJobs,
    bestMultipleOrientation: (...args) => root.SigK.printSheetMulti.bestMultipleOrientation(...args),
    bookletSheetCount: (...args) => root.SigK.printSheetMulti.bookletSheetCount(...args),
  };
})(typeof window !== 'undefined' ? window : globalThis);
