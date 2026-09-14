(function (root) {
  'use strict';

  // 画像→PDF の計画を組み立てる純関数（spec-3-1 確定事項11〜15・20・21）。
  //
  // planPage は1枚の画像について「どの大きさの紙に、どの箱へ、拡大してよいか」を pt で返す。
  // ワーカー（op-convert.js）は数値を受け取って載せるだけで、用紙・向き・余白の意味を知らない
  // （分割の split-plan.js と op-split.js の分業と同じ）。
  //
  // outputNames は「画像ごと」のファイル名だけを組む。フォルダと結合するのは画面側である。
  // 画面には触らないので node --test で直接読める（test/convert-plan.test.js）。

  // 入力の上限（確定事項6）。1枚ごとに embed() を呼べば RSS は1枚ぶんで頭打ちになる
  // （事前調査 A）ので、結合の入力上限と同じ数にする。複数ページの TIFF が入るようになってからは
  // **ページで数える**（spec-3-2 確定事項30。メモリの根拠がページ単位のため）。ファイル数の
  // 先出しの上限（addPaths）も同じ数である。
  const MAX_INPUTS = 100;

  const paper = () => root.SigK.paperSize;

  // 1枚ぶんの紙と箱。box は紙の左下が原点・pt。
  function planPage(pixels, { paper: paperId, orientation, margin } = {}) {
    const sizes = paper();
    if (!sizes.isPaper(paperId))
      return { error: '用紙を選んでください' };
    if (!sizes.isOrientation(orientation))
      return { error: '向きを選んでください' };
    if (!sizes.isMargin(margin))
      return { error: '余白を選んでください' };
    if (!(pixels?.width > 0) || !(pixels?.height > 0))
      return { error: '画像の大きさが分かりません' };

    // 画像サイズに合わせる: 1px = 1pt。余白なし、拡大も縮小もしない（ちょうど 1 倍になる）。
    if (paperId === 'image') {
      const page = { width: pixels.width, height: pixels.height };
      return { page, box: { x: 0, y: 0, ...page }, allowUpscale: false, orientation: sizes.resolveOrientation('auto', pixels) };
    }

    const resolved = sizes.resolveOrientation(orientation, pixels);
    const page = sizes.paperSize(paperId, resolved);
    const m = sizes.mmToPt(sizes.MARGINS[margin].mm);
    const box = { x: m, y: m, width: page.width - 2 * m, height: page.height - 2 * m };
    if (!(box.width > 0) || !(box.height > 0))
      return { error: '余白が大きすぎます' };
    return { page, box, allowUpscale: true, orientation: resolved };
  }

  // 行に出す「この紙」の表記（確定事項3）。
  function describePage(planned, paperId) {
    if (planned?.page === undefined)
      return '';
    if (paperId === 'image')
      return `${Math.round(planned.page.width)}×${Math.round(planned.page.height)} pt`;
    const label = paper().PAPERS[paperId]?.label ?? '';
    return `${label} ${paper().ORIENTATIONS[planned.orientation] ?? ''}`.trim();
  }

  // ---- ファイル名（確定事項19〜21） ----

  function stem(name) {
    return String(name ?? '').replace(/\.(png|jpe?g|bmp|gif|tiff?)$/i, '');
  }

  function outputNames(rows) {
    return rows.map((row) => `${stem(row.name)}.pdf`);
  }

  // 出力名が同じになる組。Windows のファイル名は大文字小文字を区別しない。
  function duplicateNames(names) {
    const seen = new Map();
    const dupes = [];
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.get(key) === true && !dupes.includes(name))
        dupes.push(name);
      seen.set(key, true);
    }
    return dupes;
  }

  function defaultSingleName(rows) {
    return rows.length === 0 ? 'images.pdf' : `${stem(rows[0].name)}.pdf`;
  }

  // 行のページごとの寸法。読めていない行や塊④ までの行（frames 無し）は先頭の1つだけ。
  function framesOf(row) {
    if (Array.isArray(row.frames) && row.frames.length > 0)
      return row.frames;
    return [{ width: row.width, height: row.height }];
  }

  function totalPages(rows) {
    return (rows ?? []).reduce((sum, row) => sum + framesOf(row).length, 0);
  }

  // 1行ぶんの紙の並び（ページごとに planPage を引く。spec-3-2 確定事項30）。
  function planRow(row, settings) {
    const layouts = [];
    for (const frame of framesOf(row)) {
      const planned = planPage(frame, settings);
      if (planned.error !== undefined)
        return planned;
      layouts.push({ page: planned.page, box: planned.box, allowUpscale: planned.allowUpscale });
    }
    return { layouts };
  }

  // 一覧と設定から計画を組む。行が無い・読んでいる途中・読めない行があれば ready: false
  // （error は null。行の側に理由がある）。「画像ごと」で出力名が衝突すれば ready: false と error。
  // pages は行 × ページの紙（ワーカーの layouts）、totalPages は「まとめる」のページ数。
  function planConvert(rows, settings) {
    if (!Array.isArray(rows) || rows.length === 0)
      return { ready: false, error: null };
    if (rows.length > MAX_INPUTS)
      return { ready: false, error: `${MAX_INPUTS} ファイルまでです` };
    if (rows.some((row) => row.pending === true || (row.blocked !== null && row.blocked !== undefined)))
      return { ready: false, error: null };
    const total = totalPages(rows);
    if (total > MAX_INPUTS)
      return { ready: false, error: `${MAX_INPUTS} ページまでです` };

    const pages = [];
    for (const row of rows) {
      const planned = planRow(row, settings);
      if (planned.error !== undefined)
        return { ready: false, error: planned.error };
      pages.push(planned.layouts);
    }

    const names = outputNames(rows);
    if (settings?.output === 'each') {
      const dupes = duplicateNames(names);
      if (dupes.length > 0)
        return { ready: false, error: `出力名が重なります: ${dupes.join('、')}` };
    }
    return { ready: true, error: null, pages, totalPages: total, names };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.convertPlan = { MAX_INPUTS, planPage, describePage, stem, outputNames, duplicateNames, defaultSingleName, totalPages, planConvert };
})(typeof window !== 'undefined' ? window : globalThis);
