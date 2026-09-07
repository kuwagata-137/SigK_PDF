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
  // （事前調査 A）ので、結合の入力上限と同じ数にする。
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
    return String(name ?? '').replace(/\.(png|jpe?g)$/i, '');
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

  // 一覧と設定から計画を組む。行が無い・読んでいる途中・読めない行があれば ready: false
  // （error は null。行の側に理由がある）。「画像ごと」で出力名が衝突すれば ready: false と error。
  function planConvert(rows, settings) {
    if (!Array.isArray(rows) || rows.length === 0)
      return { ready: false, error: null };
    if (rows.length > MAX_INPUTS)
      return { ready: false, error: `${MAX_INPUTS} ファイルまでです` };
    if (rows.some((row) => row.pending === true || (row.blocked !== null && row.blocked !== undefined)))
      return { ready: false, error: null };

    const pages = [];
    for (const row of rows) {
      const planned = planPage({ width: row.width, height: row.height }, settings);
      if (planned.error !== undefined)
        return { ready: false, error: planned.error };
      pages.push({ page: planned.page, box: planned.box, allowUpscale: planned.allowUpscale });
    }

    const names = outputNames(rows);
    if (settings?.output === 'each') {
      const dupes = duplicateNames(names);
      if (dupes.length > 0)
        return { ready: false, error: `出力名が重なります: ${dupes.join('、')}` };
    }
    return { ready: true, error: null, pages, names };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.convertPlan = { MAX_INPUTS, planPage, describePage, stem, outputNames, duplicateNames, defaultSingleName, planConvert };
})(typeof window !== 'undefined' ? window : globalThis);
