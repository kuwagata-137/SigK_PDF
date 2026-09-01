(function (root) {
  'use strict';

  // 検索の文字処理。DOM も pdf.js も触らない層である（docs/07 第4章の
  // 「依存なしで回る層」）。ここを分けておくと、正規化と写像の正しさを
  // jsdom もスタブも無しで確かめられる。
  //
  // pdf.js の PDFFindController は使えない（spec-1-4 確定事項1）。vendor/ に
  // 入れているのは build/pdf.mjs だけで、あちらは web/pdf_viewer.mjs 側にある。
  // やっているのは同じ考え方を必要な分だけ書くことである。

  // 1文字ずつ NFKC を掛け、「正規化後の位置 → 元の位置」の写像を同時に作る
  // （確定事項8）。正規化で長さが変わる文字（ﬁ → fi、㍻ → 平成）があるため、
  // 写像なしにヒットの位置を元のテキストへ戻せない。
  //
  // starts[j] / ends[j] は、正規化後の j 文字目を生んだ「元の1文字」の
  // 前後の位置である。両方を持つのは、展開された文字の途中でヒットが
  // 終わったときに、長さ0の範囲を作らないためである。
  function normalize(text, { matchCase = false } = {}) {
    const source = typeof text === 'string' ? text : '';
    const out = [];
    const starts = [];
    const ends = [];

    for (let at = 0; at < source.length;) {
      // サロゲートペアは2コードユニットで1文字。割って正規化すると壊れる。
      const code = source.codePointAt(at);
      const width = code > 0xffff ? 2 : 1;
      let piece = source.slice(at, at + width).normalize('NFKC');
      // 大文字小文字の同一視は、正規化と同じ1文字ずつの経路で掛ける（確定事項10）。
      if (!matchCase)
        piece = piece.toLowerCase();

      for (let k = 0; k < piece.length; k += 1) {
        out.push(piece[k]);
        starts.push(at);
        ends.push(at + width);
      }
      at += width;
    }
    return { text: out.join(''), starts, ends };
  }

  // 正規化後の [start, end) を、元のテキストの [start, end) へ戻す。
  function toOriginalRange(mapping, start, end) {
    if (end <= start || start < 0 || end > mapping.starts.length)
      return null;
    return { start: mapping.starts[start], end: mapping.ends[end - 1] };
  }

  // 検索語を正規化する。空・空白だけなら null を返し、呼び出し側は探さない
  // （確定事項13）。全角空白も JavaScript の trim が落とす。
  function prepareTerm(term, { matchCase = false } = {}) {
    const normalized = normalize(term, { matchCase }).text;
    return normalized.trim().length === 0 ? null : normalized;
  }

  // 部分一致のみ（確定事項7）。重ならないように語の長さだけ進める。
  function findMatches(haystack, needle) {
    const found = [];
    if (typeof needle !== 'string' || needle.length === 0)
      return found;

    let at = haystack.indexOf(needle);
    while (at !== -1) {
      found.push({ start: at, end: at + needle.length });
      at = haystack.indexOf(needle, at + needle.length);
    }
    return found;
  }

  function itemStarts(lengths) {
    const starts = [];
    let at = 0;
    for (const length of lengths) {
      starts.push(at);
      at += length;
    }
    return starts;
  }

  // ページ内の [start, end) を「何番目の span の何文字目から何文字目まで」へ
  // 割る（確定事項14）。1つのヒットが複数の span にまたがることがある。
  function locateSegments({ start, end, lengths }) {
    const starts = itemStarts(lengths);
    const segments = [];

    for (let index = 0; index < lengths.length; index += 1) {
      const from = starts[index];
      const to = from + lengths[index];
      if (end <= from || start >= to)
        continue;
      const head = Math.max(start, from) - from;
      const tail = Math.min(end, to) - from;
      // 幅0の span は作らない。空の item をまたいだだけの区間がこれに当たる。
      if (tail > head)
        segments.push({ index, from: head, to: tail });
    }
    return segments;
  }

  // 角丸の付き方を変えて1つながりに見せる（確定事項16）。CSS は
  // renderer/text-layer.css が持っている。
  function segmentClass(position, count) {
    if (count <= 1)
      return 'highlight';
    if (position === 0)
      return 'highlight begin';
    if (position === count - 1)
      return 'highlight end';
    return 'highlight middle';
  }

  // ページ1枚分の item 群からヒットを列挙する。items を継ぎ目なしで繋いでから
  // 探すので、同じページ内で span をまたぐ語は拾える。ページをまたぐ語は
  // 呼び出し側がページ単位で渡す以上、そもそも拾えない（確定事項6）。
  function matchesInPage({ items, term, matchCase = false }) {
    const list = Array.isArray(items) ? items : [];
    const lengths = list.map((str) => (typeof str === 'string' ? str.length : 0));
    const mapping = normalize(list.join(''), { matchCase });
    const found = [];

    for (const hit of findMatches(mapping.text, term)) {
      const range = toOriginalRange(mapping, hit.start, hit.end);
      if (range === null)
        continue;
      const segments = locateSegments({ start: range.start, end: range.end, lengths });
      if (segments.length === 0)
        continue;
      found.push({ start: range.start, end: range.end, segments });
    }
    return found;
  }

  // 端まで行ったら反対の端へ回る（確定事項19）。回ったことは知らせない。
  function stepIndex(current, total, delta) {
    if (total <= 0)
      return -1;
    if (current < 0)
      return delta >= 0 ? 0 : total - 1;
    return (((current + delta) % total) + total) % total;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.findText = {
    normalize,
    toOriginalRange,
    prepareTerm,
    findMatches,
    itemStarts,
    locateSegments,
    segmentClass,
    matchesInPage,
    stepIndex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
