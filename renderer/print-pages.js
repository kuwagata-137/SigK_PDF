(function (root) {
  'use strict';

  // 印刷するページの解決（F-01-8・spec-1-4 確定事項33〜35・docs/spec-7-7-print-dialog.md）。DOM に触らない。
  //
  // 印刷するページ: すべて（all）・現在のページ（current）・ページ指定（custom）。詳細オプションの現在の表示範囲（view）は、
  // 現在のページだけを返す（切り出す範囲は画面の側で決める）。偶数または奇数ページ（parity）と逆順に印刷（reverse）は、
  // ここで当ててから配置の計算へ渡す（spec-7-7「配置の計算」）。print.js から移した（parsePageList・resolvePages の名前は
  // SigK.print からも呼べる）。

  // 一度に印刷できるページ数の上限（確定事項33）。実測に基づかない初期値である。
  const MAX_PAGES = 100;

  // 全角のカンマ・ハイフンも受け付ける（確定事項34）。NFKC が ，と －を半角へ
  // 直すので、そこから漏れる読点と各種ダッシュだけを先に均す。
  function normalizeRangeText(text) {
    return String(text ?? '')
      .replace(/、/g, ',')
      .replace(/[‐‑‒–—―−ー]/g, '-')
      .normalize('NFKC')
      .trim();
  }

  // 「1-5, 8」を読む。範囲外・逆順・数字でないものはその場で弾き、理由を返す
  // （確定事項35）。押せてから失敗するのではなく、押す前に分かるようにする。
  function parsePageList(text, pageCount) {
    const source = normalizeRangeText(text);
    if (source.length === 0)
      return { error: '印刷するページを指定してください。' };

    const pages = new Set();
    for (const rawToken of source.split(',')) {
      const token = rawToken.trim();
      if (token.length === 0)
        return { error: `ページ指定を読み取れません: 「${rawToken}」` };

      const parts = token.split('-').map((part) => part.trim());
      if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part)))
        return { error: `ページは数字で指定してください: 「${token}」` };

      const from = Number(parts[0]);
      const to = Number(parts[parts.length - 1]);
      if (from < 1 || to > pageCount)
        return { error: `1 〜 ${pageCount} の範囲で指定してください: 「${token}」` };
      if (from > to)
        return { error: `終了ページが開始ページより前です: 「${token}」` };
      for (let number = from; number <= to; number += 1)
        pages.add(number);
    }
    return { pages: [...pages].sort((a, b) => a - b) };
  }

  function withLimit(pages) {
    if (pages.length === 0)
      return { error: '印刷するページがありません。' };
    if (pages.length > MAX_PAGES)
      return { error: `${pages.length} ページが指定されていますが、一度に印刷できるのは ${MAX_PAGES} ページまでです。` };
    return { pages };
  }

  function rangePages({ mode, text, pageCount, current }) {
    if (mode === 'all')
      return { pages: Array.from({ length: pageCount }, (_value, index) => index + 1) };
    if (mode === 'current' || mode === 'view')
      return { pages: [Math.min(pageCount, Math.max(1, (current ?? 0) + 1))] };
    if (mode === 'custom')
      return parsePageList(text, pageCount);
    return { error: '印刷するページを選択してください。' };
  }

  // parity: 'all'（範囲内のすべてのページ）・'odd'（奇数ページのみ）・'even'（偶数ページのみ）。ページ番号の奇数・偶数で絞る。
  function resolvePages({ mode, text = '', pageCount, current = 0, parity = 'all', reverse = false }) {
    if (!Number.isFinite(pageCount) || pageCount <= 0)
      return { error: '文書が開かれていません。' };

    const range = rangePages({ mode, text, pageCount, current });
    if (range.error !== undefined)
      return range;
    let list = range.pages;
    if (parity === 'odd' || parity === 'even')
      list = list.filter((number) => (number % 2 === 1) === (parity === 'odd'));
    if (reverse === true)
      list = [...list].reverse();
    return withLimit(list);
  }

  // ページ指定でない時に、欄へ灰色で表示する範囲（Acrobat の画面写真 1 の「1 - 21」）。
  function rangeHint(pageCount) {
    if (!Number.isFinite(pageCount) || pageCount <= 0)
      return '';
    return pageCount === 1 ? '1' : `1 - ${pageCount}`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printPages = { MAX_PAGES, normalizeRangeText, parsePageList, resolvePages, rangeHint };
})(typeof window !== 'undefined' ? window : globalThis);
