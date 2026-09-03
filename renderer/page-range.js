(function (root) {
  'use strict';

  // ページ範囲の記法を読む純関数（spec-2-1 確定事項18〜20）。
  //
  // 「1-3,5,8-」のように、カンマ区切り・ハイフンで範囲・片側省略で先頭／末尾まで。
  // 空欄はすべてのページを指す。全角の数字・カンマ・ハイフン類も受ける。
  // 逆順（5-3）は 3-5 と同じに扱い、同じページを2回書けば2回入る（順序も書いたとおり）。
  //
  // 戻り値は 0 始まりのページ番号の配列 { pages } か、人が読める { error } である。
  // 結合（tools-merge.js）が使い、塊② の範囲抽出や印刷の範囲にも使い回せるよう、
  // 画面には触らない。
  //
  // 印刷（print.js の parsePageList）とは規則が違う。あちらは逆順を誤りとし、
  // 重複を畳み、昇順に並べ直す。「印刷する集合」と「並べる列」の違いである。

  const EXAMPLE = '1-3,5 のように書いてください';

  // 全角を半角へ寄せる。NFKC で数字・「－」・「，」は片付くが、長音「ー」と
  // 波ダッシュ「〜」「～」、読点「、」は残るので個別に置く。
  function normalize(text) {
    return String(text ?? '')
      .replace(/[、，]/g, ',')
      .replace(/[‐‑‒–—―−ーｰ〜～]/g, '-')
      .normalize('NFKC')
      .replace(/\s+/g, '');
  }

  function all(pageCount) {
    return Array.from({ length: pageCount }, (_value, index) => index);
  }

  // 「3」「1-3」「8-」「-3」を読む。0 始まりの列を返す。
  function parseToken(token, pageCount) {
    const parts = token.split('-');
    if (parts.length > 2 || parts.every((part) => part === '') || parts.some((part) => !/^\d*$/.test(part)))
      return { error: EXAMPLE };

    const isRange = parts.length === 2;
    const from = parts[0] === '' ? 1 : Number(parts[0]);
    const to = !isRange ? from : (parts[1] === '' ? pageCount : Number(parts[1]));
    if (from < 1 || to < 1)
      return { error: 'ページは 1 から数えます' };
    if (from > pageCount || to > pageCount)
      return { error: `${pageCount}ページまでです` };

    const [low, high] = from <= to ? [from, to] : [to, from];
    const pages = [];
    for (let number = low; number <= high; number += 1)
      pages.push(number - 1);
    return { pages };
  }

  function parsePageRange(text, pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 0)
      return { error: 'ページ数が分かりません' };

    const source = normalize(text);
    if (source === '')
      return { pages: all(pageCount) };

    const pages = [];
    for (const token of source.split(',')) {
      if (token === '')
        return { error: EXAMPLE };
      const parsed = parseToken(token, pageCount);
      if (parsed.error !== undefined)
        return parsed;
      pages.push(...parsed.pages);
    }
    return { pages };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageRange = { EXAMPLE, normalize, parsePageRange };
})(typeof window !== 'undefined' ? window : globalThis);
