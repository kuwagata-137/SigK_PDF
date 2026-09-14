(function (root) {
  'use strict';

  // PDF→画像の計画を組む純関数（spec-3-3 確定事項6〜11）。
  //
  // どのページを、何 dpi で、どの形式で、どんな名前に書くかをここで決め、
  // 画面（tools-to-image.js）は結果を映すだけ、描く側（page-image.js）は
  // scale と形式の数値を受け取るだけにする。分割の split-plan.js と同じ分業。
  // 画面には触らないので node --test で直接読める。

  const DPI_CHOICES = [72, 150, 300];
  // 既定は印刷（print.js の PRINT_DPI）と同じ 150dpi。
  const DEFAULT_DPI = 150;

  // JPEG の品質は固定で、欄は出さない（ユーザー確定③）。300dpi で 1 枚 0.5〜0.84MB。
  const FORMATS = Object.freeze({
    png: Object.freeze({ type: 'image/png', ext: 'png', label: 'PNG' }),
    jpeg: Object.freeze({ type: 'image/jpeg', ext: 'jpg', label: 'JPEG', quality: 0.9 }),
  });
  const DEFAULT_FORMAT = 'png';

  // 1 回に書き出せるページ数（ユーザー確定①）。分割の MAX_OUTPUTS と同じ数にして、
  // 「出力の本数」の上限を 1 つの規則で済ませる。300dpi の PNG で 500 ページ ≈ 45〜50 秒。
  const MAX_PAGES = 500;

  // 1 ページの画素の上限。worker/image-format.js の MAX_PIXELS（差し込み・画像→PDF）と
  // 同じ値である。レンダラーはワーカーのモジュールを読まないので、値をここにも置く。
  // A2 の 300dpi（約 34.8M）は入り、A1 の 300dpi（約 69.6M）は入らない。
  const MAX_PIXELS = 40_000_000;

  const scaleFor = (dpi) => dpi / 72;

  // viewport と同じ丸め（page-image.js の renderToCanvas）。例に出す数と実際の画素数を揃える。
  function pixelSizeFor(size, dpi) {
    const scale = scaleFor(dpi);
    return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
  }

  // 選んだ解像度で上限を超えるページの番号（1 始まり）。
  function oversizedPages(sizes, pages, dpi) {
    const over = [];
    for (const index of pages) {
      const size = sizes[index];
      if (size === undefined)
        continue;
      const pixel = pixelSizeFor(size, dpi);
      if (pixel.width * pixel.height > MAX_PIXELS)
        over.push(index + 1);
    }
    return over;
  }

  // 書き出すページ（0 始まり）。「書き出す集合」なので重複は畳み、昇順に並べ直す
  // （確定事項6・10。結合の「2 回書けば 2 回入る」とは違う。出力名が同じになるため）。
  function resolvePages({ mode, range = '' }, pageCount) {
    const parsed = mode === 'range'
      ? root.SigK.pageRange.parsePageRange(range, pageCount)
      : root.SigK.pageRange.parsePageRange('', pageCount);
    if (parsed.error !== undefined)
      return { error: parsed.error, errorKind: 'range' };
    const pages = [...new Set(parsed.pages)].sort((a, b) => a - b);
    if (pages.length > MAX_PAGES)
      return { error: `一度に画像にできるのは ${MAX_PAGES} ページまでです（${pages.length} ページが指定されています）。`, errorKind: 'limit' };
    return { pages };
  }

  // <元の名前>_<ページ番号>.<拡張子>（ユーザー確定④）。番号は文書内のページ番号を
  // ゼロ埋めし、桁は総ページ数の桁で最低 3 桁（分割の連番と同じ規則）。
  function outputNames(baseName, pages, pageCount, format) {
    const base = root.SigK.splitPlan.stem(baseName);
    const ext = FORMATS[format]?.ext ?? FORMATS[DEFAULT_FORMAT].ext;
    const digits = Math.max(3, String(pageCount).length);
    return pages.map((index) => `${base}_${String(index + 1).padStart(digits, '0')}.${ext}`);
  }

  // いまの設定と対象から計画を組む。対象が決まっていなければ ready: false（error は
  // null）、入力に誤りがあれば ready: false と error（errorKind は 'range'・'limit'・
  // 'pixels'・'settings'。画面が出す場所を選ぶのに使う）、組めれば pages・names・画素数など。
  function planExport({ mode = 'all', range = '', format = DEFAULT_FORMAT, dpi = DEFAULT_DPI }, source) {
    if (source === null || source === undefined || source.pending === true || (source.blocked ?? null) !== null || !Number.isInteger(source.pageCount))
      return { ready: false, error: null };
    if (!Object.prototype.hasOwnProperty.call(FORMATS, format))
      return { ready: false, error: '形式を選んでください。', errorKind: 'settings' };
    if (!DPI_CHOICES.includes(dpi))
      return { ready: false, error: '解像度を選んでください。', errorKind: 'settings' };

    const resolved = resolvePages({ mode, range }, source.pageCount);
    if (resolved.error !== undefined)
      return { ready: false, error: resolved.error, errorKind: resolved.errorKind };

    const sizes = Array.isArray(source.sizes) ? source.sizes : [];
    const over = oversizedPages(sizes, resolved.pages, dpi);
    if (over.length > 0) {
      const smaller = DPI_CHOICES.filter((choice) => choice < dpi);
      const hint = smaller.length > 0 ? `${smaller[smaller.length - 1]}dpi 以下を選んでください。` : '';
      return { ready: false, error: `${over.length} ページが ${dpi}dpi では大きすぎます（1 ページ ${MAX_PIXELS / 1_000_000}M 画素まで）。${hint}`.trim(), errorKind: 'pixels' };
    }

    const first = sizes[resolved.pages[0]];
    return {
      ready: true,
      error: null,
      pages: resolved.pages,
      names: outputNames(source.name, resolved.pages, source.pageCount, format),
      pixel: first === undefined ? null : pixelSizeFor(first, dpi),
      format: FORMATS[format],
      formatId: format,
      dpi,
      scale: scaleFor(dpi),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.imageExportPlan = {
    DPI_CHOICES, DEFAULT_DPI, FORMATS, DEFAULT_FORMAT, MAX_PAGES, MAX_PIXELS,
    scaleFor, pixelSizeFor, oversizedPages, resolvePages, outputNames, planExport,
  };
})(typeof window !== 'undefined' ? window : globalThis);
