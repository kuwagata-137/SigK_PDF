(function (root) {
  'use strict';

  // 注釈の一覧(T)（docs/spec-7-7-print-dialog.md「配置の計算」・質問 PR2）。DOM に触らない。
  //
  // 確認画面で［はい(Y)］を選んだ印刷では、書き込みのあるページの後ろに一覧ページを入れる。一覧ページの大きさは、そのページと同じ。
  // 形は Acrobat（ASCII.jp の画面写真）に合わせる:「注釈の一覧 :ファイル名」「ページ :番号」と、書き込みごとの
  // 「番号 : n 作成者 : 名前 タイトル : 種類 日付 : 年/月/日 時:分:秒」と本文。作成者と日付は分かる時だけ書く。

  const TITLE_PT = 12;
  const FONT_PT = 10;
  const LINE_PT = 15;
  const MARGIN_PT = 54;

  function byPosition(a, b) {
    return ((b.rect?.[3] ?? 0) - (a.rect?.[3] ?? 0)) || ((a.rect?.[0] ?? 0) - (b.rect?.[0] ?? 0));
  }

  // PDF の日付（D:20261113102030+09'00'）を「2026/11/13 10:20:30」にする。読めなければ null。
  function formatPdfDate(value) {
    const hit = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(String(value ?? ''));
    if (hit === null)
      return null;
    const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = hit;
    return `${y}/${mo}/${d} ${h}:${mi}:${s}`;
  }

  // 字の幅の見積もり（全角は 1 字、半角は 0.55 字）。折り返しと、一覧ページの枚数を決めるのに使う。
  function widthOf(char) {
    return char.codePointAt(0) >= 0x2e80 ? 1 : 0.55;
  }

  function wrap(text, maxEm) {
    const lines = [];
    for (const paragraph of String(text ?? '').split('\n')) {
      let line = '';
      let used = 0;
      for (const char of paragraph) {
        if (used + widthOf(char) > maxEm && line !== '') {
          lines.push(line);
          line = '';
          used = 0;
        }
        line += char;
        used += widthOf(char);
      }
      lines.push(line);
    }
    return lines;
  }

  // 一覧ページに書く行。{ text, size, indent }（大きさ・字下げは pt）。
  function linesFor({ fileName, number, entries, details = {}, widthPt }) {
    const maxEm = (widthPt - MARGIN_PT * 2) / FONT_PT;
    const lines = [
      { text: `注釈の一覧 :${fileName ?? ''}`, size: TITLE_PT, indent: 0 },
      { text: `ページ :${number}`, size: FONT_PT, indent: 0 },
      { text: '', size: FONT_PT, indent: 0 },
    ];
    entries.forEach((entry, index) => {
      const extra = details[entry.ref] ?? {};
      const author = entry.author || extra.author || '';
      const date = extra.date ?? null;
      const label = root.SigK.annotationIndex?.labelOf(entry) ?? '';
      const head = [`番号 : ${index + 1}`, author === '' ? null : `作成者 : ${author}`, `タイトル : ${label}`, date === null ? null : `日付 : ${date}`]
        .filter((part) => part !== null).join(' ');
      for (const text of wrap(head, maxEm))
        lines.push({ text, size: FONT_PT, indent: 0 });
      const body = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (body !== '') {
        for (const text of wrap(body, maxEm - 1))
          lines.push({ text, size: FONT_PT, indent: FONT_PT });
      }
      lines.push({ text: '', size: FONT_PT, indent: 0 });
    });
    return lines;
  }

  function paginate(lines, heightPt) {
    const perPage = Math.max(1, Math.floor((heightPt - MARGIN_PT * 2) / LINE_PT));
    const pages = [];
    for (let start = 0; start < lines.length; start += perPage)
      pages.push(lines.slice(start, start + perPage));
    return pages;
  }

  // 印刷するページの並びに一覧ページを入れる。entriesOf(number) はページの書き込み、detailsOf(number) は作成者と日付（参照ごと）。
  function withSummaries(pages, { fileName, entriesOf, detailsOf = () => ({}) }) {
    const result = [];
    for (const page of pages) {
      result.push(page);
      const entries = [...(entriesOf(page.number) ?? [])].sort(byPosition);
      if (entries.length === 0)
        continue;
      const lines = linesFor({ fileName, number: page.number, entries, details: detailsOf(page.number), widthPt: page.width });
      for (const chunk of paginate(lines, page.height))
        result.push({ number: page.number, width: page.width, height: page.height, summary: chunk });
    }
    return result;
  }

  // 一覧ページを描く。ctx は白で塗った枠の左上を原点に、1 pt を scale 画素として描く。
  function draw(ctx, lines, scale) {
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, index) => {
      ctx.font = `${line.size * scale}px "Yu Gothic UI", "Meiryo", sans-serif`;
      ctx.fillText(line.text, (MARGIN_PT + line.indent) * scale, (MARGIN_PT + LINE_PT * (index + 1) - 3) * scale);
    });
    ctx.restore();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printSummary = { formatPdfDate, wrap, linesFor, paginate, withSummaries, draw };
})(typeof window !== 'undefined' ? window : globalThis);
