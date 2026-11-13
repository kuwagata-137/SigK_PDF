(function (root) {
  'use strict';

  // 用紙 1 枚ごとの配置の計算で使う、寸法の換算・用紙の向き・枠への収め方（docs/spec-7-7-print-dialog.md「配置の計算」）。DOM に触らない。
  //
  // 長さは µm。ページの大きさは pt（1/72 インチ）で受け取り、µm に直す。
  // シート（用紙 1 枚の片面）の座標は、シートの向きで見た左上が原点。横のシートは、縦の用紙を左へ 90 度回した向きで、
  // 印刷する画像は時計回りに 90 度回して縦の用紙に載せる（Windows の DC_ORIENTATION が 90 のプリンターと同じ向き）。
  // 用紙をいつも縦で送るのは、Electron の向きの指定（landscape）が印刷 1 回分にしか効かず、縦と横の混ざった文書を
  // 1 回で送れないためである。

  const UM_PER_PT = 25400 / 72;
  const UM_PER_MM = 1000;
  // ページが用紙に「収まる」とみなす誤差（A4 の PDF は 595 x 842 pt で、A4 の用紙より 0.04 mm 長い）。
  const FIT_TOLERANCE = 1000;
  // PDF のページサイズに合わせて用紙を選択(Z) で選ぶ用紙。封筒・はがき・写真用紙は選ばない（Claude の案）。
  const STANDARD_PAPERS = ['ISOA3', 'ISOA4', 'ISOA5', 'JISB4', 'JISB5', 'NorthAmericaLetter', 'NorthAmericaLegal', 'NorthAmericaTabloid'];

  const localName = (id) => String(id ?? '').replace(/^[^:]*:/, '');
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(number, min, max) : fallback;
  }

  function clampInt(value, min, max, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? clamp(number, min, max) : fallback;
  }

  // プレビューの「倍率」。Acrobat の画面写真 1 の 113%（16:9 のページを A4 横に合わせた倍率 113.6%）に合わせて切り捨てる。
  function percent(scale) {
    return Math.floor(scale * 100 + 1e-6);
  }

  function pageSize(page) {
    return { width: page.width * UM_PER_PT, height: page.height * UM_PER_PT };
  }

  // 縦の用紙の印刷可能領域の余白を、別の用紙に当てる（取得した印刷可能領域は、プリンターの既定の用紙のものだけのため）。
  function imageableFor(paper, basePaper, baseArea) {
    const right = basePaper.width - baseArea.x - baseArea.width;
    const bottom = basePaper.height - baseArea.y - baseArea.height;
    const width = paper.width - baseArea.x - right;
    const height = paper.height - baseArea.y - bottom;
    if (width <= 0 || height <= 0)
      return { x: 0, y: 0, width: paper.width, height: paper.height };
    return { x: baseArea.x, y: baseArea.y, width, height };
  }

  // 用紙（縦の寸法）と、縦の用紙での印刷可能領域から、向きを決めたシートを作る。
  // 横の時の余白: 左 = 縦の上、上 = 縦の右、右 = 縦の下、下 = 縦の左。
  function makeSheet(paper, imageable, landscape) {
    const right = paper.width - imageable.x - imageable.width;
    if (!landscape)
      return { paper, landscape: false, width: paper.width, height: paper.height, area: { ...imageable } };
    return {
      paper,
      landscape: true,
      width: paper.height,
      height: paper.width,
      area: { x: imageable.y, y: right, width: imageable.height, height: imageable.width },
    };
  }

  function fitScale(width, height, box) {
    return Math.min(box.width / width, box.height / height);
  }

  // 枠の中に置く。align は横が 'start' | 'center' | 'end'、縦も同じ（小冊子は綴じる側へ寄せる）。
  function place(size, scale, box, { rotation = 0, alignX = 'center', alignY = 'center' } = {}) {
    const turned = rotation === 90 || rotation === 270;
    const width = (turned ? size.height : size.width) * scale;
    const height = (turned ? size.width : size.height) * scale;
    const offset = (free, align) => (align === 'start' ? 0 : align === 'end' ? free : free / 2);
    return {
      x: box.x + offset(box.width - width, alignX),
      y: box.y + offset(box.height - height, alignY),
      width,
      height,
      rotation,
      scale,
    };
  }

  // 枠に最も大きく収まる置き方。autoRotate なら、90 度回した方が大きい時に回す（各シート内でページを自動回転(W)）。
  function placeFitted(page, box, { autoRotate = false, alignX, alignY, border = false } = {}) {
    if (page === null)
      return { page: null, ...place({ width: 0, height: 0 }, 1, box, { alignX, alignY }), border: false, clip: null };
    const size = pageSize(page);
    const straight = fitScale(size.width, size.height, box);
    const turned = fitScale(size.height, size.width, box);
    const rotation = autoRotate && turned > straight + 1e-9 ? 90 : 0;
    const scale = rotation === 90 ? turned : straight;
    return { page: page.number, ...place(size, scale, box, { rotation, alignX, alignY }), border, clip: null };
  }

  function fitsPaper(size, paper) {
    const fits = (w, h) => w <= paper.width + FIT_TOLERANCE && h <= paper.height + FIT_TOLERANCE;
    return fits(size.width, size.height) || fits(size.height, size.width);
  }

  // ページが 100% で収まる最小の用紙。収まる用紙が無ければ最大の用紙。決まったサイズが一覧に無ければ、選んだ用紙のまま。
  function pickPaper(size, paperSizes, fallback) {
    const candidates = (paperSizes ?? []).filter((paper) => STANDARD_PAPERS.includes(localName(paper.id)));
    if (candidates.length === 0)
      return fallback;
    const byArea = [...candidates].sort((a, b) => a.width * a.height - b.width * b.height);
    return byArea.find((paper) => fitsPaper(size, paper)) ?? byArea[byArea.length - 1];
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSheetGeometry = {
    UM_PER_PT, UM_PER_MM, STANDARD_PAPERS,
    clamp, clampNumber, clampInt, percent, pageSize, imageableFor, makeSheet, fitScale, place, placeFitted, fitsPaper, pickPaper,
  };
})(typeof window !== 'undefined' ? window : globalThis);
