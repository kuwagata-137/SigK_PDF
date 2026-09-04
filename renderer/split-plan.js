(function (root) {
  'use strict';

  // 分割の計画とファイル名の規則を組み立てる純関数（spec-2-2 確定事項7〜13・15〜19）。
  //
  // planSplit は「どのページをどの本に入れるか」を 0 始まりの配列の配列で返す。
  // 3方式（N ページごと・指定したページの前で切る・範囲を取り出す）の違いは
  // ここに閉じ、画面（tools-split.js）とワーカー（op-split.js）は parts しか見ない。
  //
  // outputNames はファイル名だけを組む。フォルダと結合するのは画面側である。
  // 画面には触らないので node --test で直接読める（test/split-plan.test.js）。

  // 出力数の上限（確定事項13）。時間が理由ではなく（1,000ページを1ページごとに
  // 分けても 8秒）、間違って1ページごとを指定したときに数百本を黙って作らせないため。
  const MAX_OUTPUTS = 500;

  const EXAMPLE_AT = '3, 7 のように書いてください';

  const normalize = (text) => root.SigK.pageRange.normalize(text);

  function chunk(pageCount, every) {
    const parts = [];
    for (let start = 0; start < pageCount; start += every)
      parts.push(Array.from({ length: Math.min(every, pageCount - start) }, (_value, index) => start + index));
    return parts;
  }

  // N ページごと（確定事項8）。N がページ数以上なら1本になる。
  function planEvery(every, pageCount) {
    const text = normalize(every);
    if (!/^\d+$/.test(text) || Number(text) < 1)
      return { error: '1 以上の整数を書いてください' };
    return { parts: chunk(pageCount, Number(text)) };
  }

  // 指定したページの前で切る（確定事項9）。受けるのは 2〜ページ数。
  function planAt(at, pageCount) {
    const text = normalize(at);
    if (text === '')
      return { error: EXAMPLE_AT };
    const cuts = [];
    for (const token of text.split(',')) {
      if (!/^\d+$/.test(token))
        return { error: EXAMPLE_AT };
      const page = Number(token);
      if (page < 2)
        return { error: 'ページは 2 から数えます（1 の前では切れません）' };
      if (page > pageCount)
        return { error: `${pageCount}ページまでです` };
      if (cuts.includes(page))
        return { error: `${page} が2回あります` };
      cuts.push(page);
    }
    cuts.sort((a, b) => a - b);
    const parts = [];
    let start = 0;
    for (const cut of cuts) {
      parts.push(Array.from({ length: cut - 1 - start }, (_value, index) => start + index));
      start = cut - 1;
    }
    parts.push(Array.from({ length: pageCount - start }, (_value, index) => start + index));
    return { parts };
  }

  // 範囲を取り出す（確定事項10）。書いた順に1本へ。
  function planRange(range, pageCount) {
    const parsed = root.SigK.pageRange.parsePageRange(range, pageCount);
    if (parsed.error !== undefined)
      return parsed;
    return { parts: [parsed.pages] };
  }

  function planSplit(spec, pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 1)
      return { error: 'ページ数が分かりません' };
    const { mode, every, at, range } = spec ?? {};
    let planned;
    if (mode === 'every')
      planned = planEvery(every, pageCount);
    else if (mode === 'at')
      planned = planAt(at, pageCount);
    else if (mode === 'range')
      planned = planRange(range, pageCount);
    else
      return { error: '分け方を選んでください' };
    if (planned.error !== undefined)
      return planned;
    if (planned.parts.length === 0 || planned.parts.some((part) => part.length === 0))
      return { error: '分割するページがありません' };
    if (planned.parts.length > MAX_OUTPUTS)
      return { error: `${MAX_OUTPUTS} ファイルまでです（いまの指定では ${planned.parts.length} ファイルになります）` };
    return planned;
  }

  // ---- ファイル名（確定事項15〜17） ----

  function stem(baseName) {
    return String(baseName ?? '').replace(/\.pdf$/i, '');
  }

  // 0 始まりのページ列を「p1-3+5」の形にする。連続する並びは「先頭-末尾」、
  // 飛びは「+」でつなぐ。1ページなら「p3」。
  function pageLabel(pages) {
    const runs = [];
    for (const page of pages) {
      const last = runs[runs.length - 1];
      if (last !== undefined && page === last.to + 1)
        last.to = page;
      else
        runs.push({ from: page, to: page });
    }
    return `p${runs.map((run) => (run.from === run.to ? `${run.from + 1}` : `${run.from + 1}-${run.to + 1}`)).join('+')}`;
  }

  function outputNames(baseName, parts, rule) {
    const base = stem(baseName);
    if (rule === 'pages')
      return parts.map((part) => `${base}_${pageLabel(part)}.pdf`);
    const digits = Math.max(3, String(parts.length).length);
    return parts.map((_part, index) => `${base}_${String(index + 1).padStart(digits, '0')}.pdf`);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitPlan = { MAX_OUTPUTS, planSplit, outputNames, pageLabel, stem };
})(typeof window !== 'undefined' ? window : globalThis);
