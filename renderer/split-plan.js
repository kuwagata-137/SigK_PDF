(function (root) {
  'use strict';

  // 分割の欄の読み取りとファイル名の規則の純関数（spec-2-2 確定事項13・15〜19、spec-2-2b 確定事項C7）。
  //
  // 「どのページをどの本に入れるか」は盤（split-board-model.js）が持つ。2026-10-09 に、文字の欄で選ぶ 3 方式
  // （N ページごと・指定したページの前で切る・範囲を取り出す）の組み立て planSplit を消し、まとめて分けるの欄を読む
  // parseEvery・parseCuts だけを残した（spec-2-2b。範囲を取り出すで書いた順に並べ替える使い方は無くなった）。
  //
  // outputNames はファイル名だけを組む。フォルダと結合するのは画面側である。
  // 画面には触らないので node --test で直接読める（test/split-plan.test.js）。

  // 出力数の上限（確定事項13）。時間が理由ではなく（1,000ページを1ページごとに
  // 分けても 8秒）、間違って1ページごとを指定したときに数百本を黙って作らせないため。
  const MAX_OUTPUTS = 500;

  // 「1,000」の千の位のカンマは数の区切りとして読む（決定79 ②）。カンマのすぐ後に空白が無く、ちょうど 3 けたが続くときだけ。
  // 整える処理（page-range.js の normalize）は空白を消すので、その前に読み分ける。
  const joinThousands = (text) => String(text ?? '').normalize('NFKC').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const normalize = (text) => root.SigK.pageRange.normalize(joinThousands(text));

  // 画面に出す数。1,000 以上ならカンマを付ける（決定78 ③）。ファイル名には使わない。
  const withCommas = (n) => n.toLocaleString('ja-JP');

  // ---- まとめて分けるの欄（spec-2-2b 確定事項C7。文は第 I 章） ----

  // 「N ページごと」の N。
  function parseEvery(text) {
    const normalized = normalize(text);
    if (!/^\d+$/.test(normalized) || Number(normalized) < 1)
      return { error: '1 以上の整数を書いてください' };
    return { n: Number(normalized) };
  }

  // 「そのページの前で切る」番号（1 始まり）。受けるのは 2〜ページ数で、順不同は昇順に並べ直す。重なりは黙って畳まない。
  function parseCuts(text, pageCount) {
    const normalized = normalize(text);
    if (normalized === '')
      return { error: '3, 7 のように書いてください' };
    const numbers = [];
    for (const token of normalized.split(',')) {
      if (!/^\d+$/.test(token))
        return { error: '3, 7 のように書いてください' };
      const page = Number(token);
      if (page < 2)
        return { error: '1 の前では切れないので、2 から書いてください' };
      if (page > pageCount)
        return { error: `${withCommas(pageCount)} ページまでです` };
      if (numbers.includes(page))
        return { error: `${withCommas(page)} が 2 回あります` };
      numbers.push(page);
    }
    return { numbers: numbers.sort((a, b) => a - b) };
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
  SigK.splitPlan = { MAX_OUTPUTS, withCommas, parseEvery, parseCuts, outputNames, pageLabel, stem };
})(typeof window !== 'undefined' ? window : globalThis);
