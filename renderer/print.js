(function (root) {
  'use strict';

  // 印刷（F-01-8・spec-1-4 E）。
  //
  // 印刷用のコンテナへページの画像を並べ、@media print でそれ以外を隠し、
  // メイン側の webContents.print() を呼ぶ（確定事項28）。レンダラーの
  // window.print() を使わないのは、オプションを渡せず結果も受け取れないため
  // である（確定事項29）。fs と OS に触るのはメイン、という線とも揃う。

  const MAX_PAGES = 100;
  // pdf.js viewer の PRINT_RESOLUTION と同じ 150dpi 相当。画面用の
  // renderScale とは別に計算する（確定事項31）。
  const PRINT_DPI = 150;
  const PRINT_SCALE = PRINT_DPI / 72;

  const MODES = ['all', 'current', 'custom'];

  let el = null;
  let token = 0;
  let busy = false;

  function viewer() {
    return root.SigK.viewer;
  }

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
      const token_ = rawToken.trim();
      if (token_.length === 0)
        return { error: `ページの指定を読み取れません: 「${rawToken}」` };

      const parts = token_.split('-').map((part) => part.trim());
      if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part)))
        return { error: `ページは数字で指定してください: 「${token_}」` };

      const from = Number(parts[0]);
      const to = Number(parts[parts.length - 1]);
      if (from < 1 || to > pageCount)
        return { error: `1 〜 ${pageCount} の範囲で指定してください: 「${token_}」` };
      if (from > to)
        return { error: `終わりのページが始まりより前です: 「${token_}」` };

      for (let number = from; number <= to; number += 1)
        pages.add(number);
    }
    return { pages: [...pages].sort((a, b) => a - b) };
  }

  // 一度に印刷できるページ数の上限（確定事項33）。実測に基づかない初期値である。
  function withLimit(pages) {
    if (pages.length > MAX_PAGES)
      return { error: `一度に印刷できるのは ${MAX_PAGES} ページまでです（${pages.length} ページが指定されています）。` };
    return { pages };
  }

  function resolvePages({ mode, text, pageCount, current = 0 }) {
    if (!Number.isFinite(pageCount) || pageCount <= 0)
      return { error: '文書が開かれていません。' };

    if (mode === 'all')
      return withLimit(Array.from({ length: pageCount }, (_value, index) => index + 1));
    if (mode === 'current')
      return withLimit([Math.min(pageCount, Math.max(1, (current ?? 0) + 1))]);
    if (mode !== 'custom')
      return { error: '印刷する範囲を選んでください。' };

    const parsed = parsePageList(text, pageCount);
    if (parsed.error !== undefined)
      return parsed;
    return withLimit(parsed.pages);
  }

  // ---- 画面 ----

  function selectedMode() {
    for (const mode of MODES) {
      if (el.doc.getElementById(`print-mode-${mode}`)?.checked === true)
        return mode;
    }
    return 'all';
  }

  function showError(message) {
    el.error.textContent = message ?? '';
    el.error.hidden = message === null || message === undefined;
  }

  function showProgress(done, total) {
    el.progress.hidden = false;
    el.progressText.textContent = `${done} / ${total} ページを準備しています…`;
    el.bar.style.width = total === 0 ? '0%' : `${Math.round((done / total) * 100)}%`;
  }

  function setBusy(on) {
    busy = on;
    el.run.setAttribute('aria-disabled', on ? 'true' : 'false');
    el.cancel.textContent = on ? '中止' : '閉じる';
    if (!on) {
      el.progress.hidden = true;
      el.bar.style.width = '0%';
    }
  }

  // ---- 画像づくり ----

  // 1ページずつ描き、PNG にして canvas を捨てる（確定事項32）。A4・150dpi の
  // canvas は 1240×1754px ＝ 約8.7MB（RGBA）で、100ページ分を同時には持てない。
  async function renderPageImage(number) {
    const page = await viewer().getPage(number);
    if (page === null || page === undefined)
      return null;

    // 回転を紙にも載せる（spec-1-5 確定事項39）。ここは getViewport を回転
    // なしで呼んでいた4か所目である。落とすと「画面では回っているのに印刷は
    // 回っていない」が起きる。
    const viewport = page.getViewport({
      scale: PRINT_SCALE,
      rotation: viewer().viewportRotation(number, page),
    });
    // jsdom には 2D コンテキストが無い。寸法だけを返して経路の検証に使う。
    if (typeof root.CanvasRenderingContext2D === 'undefined')
      return { url: null, width: Math.round(viewport.width), height: Math.round(viewport.height), bytes: 0 };

    const canvas = el.doc.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const url = canvas.toDataURL('image/png');
    // 早めに手放す。参照が残っていても中身は解放される。
    canvas.width = 0;
    canvas.height = 0;
    return {
      url,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      // data URL の長さではなく、PNG そのもののバイト数を返す。base64 は
      // 3バイトを4文字にするので、接頭辞を除いた長さの 3/4 が中身である。
      bytes: Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4),
    };
  }

  function fillPrintArea(images) {
    const nodes = [];
    for (const image of images) {
      if (image.url === null)
        continue;
      const holder = el.doc.createElement('div');
      holder.className = 'print-page';
      const img = el.doc.createElement('img');
      img.src = image.url;
      holder.append(img);
      nodes.push(holder);
    }
    el.area.replaceChildren(...nodes);
    return nodes.length;
  }

  // 読み込みが終わるのを load で待つ。decode() は使わない。
  //
  // #print-area は画面では display:none であり、その中の <img> に decode() を
  // 掛けると解決が不定に遅れる（40ページの準備が 1.2 秒で終わる回と 58 秒
  // かかる回に分かれた。2026-09-01 の実測）。描画されていない要素の復号は
  // 後回しにされるためと見られる。load はレイアウトに依らないので安定する。
  // pdf.js viewer の PDFPrintService も load で待っている。
  function whenLoaded(img) {
    if (img.complete)
      return Promise.resolve(true);
    return new Promise((resolve) => {
      img.addEventListener('load', () => resolve(true), { once: true });
      // 1枚描けなかったからといって全体を落とさない。白紙で出るほうがまだよい。
      img.addEventListener('error', () => resolve(false), { once: true });
    });
  }

  async function waitForImages() {
    const results = await Promise.all([...el.area.querySelectorAll('img')].map(whenLoaded));
    return results.filter(Boolean).length;
  }

  // 印刷ダイアログの手前までを行う。SIGK_SMOKE_PRINT はここまでを確かめる。
  async function prepare({ mode = null, text = null } = {}) {
    if (el === null)
      return { error: '印刷の画面が用意されていません。' };

    const state = viewer().getState();
    const resolved = resolvePages({
      mode: mode ?? selectedMode(),
      text: text ?? el.pages.value,
      pageCount: state.pageCount,
      current: state.current,
    });
    if (resolved.error !== undefined) {
      showError(resolved.error);
      return { error: resolved.error };
    }
    showError(null);

    token += 1;
    const mine = token;
    setBusy(true);

    const images = [];
    const startedAt = root.performance?.now?.() ?? 0;
    try {
      for (let done = 0; done < resolved.pages.length; done += 1) {
        showProgress(done, resolved.pages.length);
        const image = await renderPageImage(resolved.pages[done]);
        // 中止されていたら、作りかけの画像ごと捨てる（確定事項36）。
        if (mine !== token)
          return { canceled: true };
        if (image !== null)
          images.push(image);
      }
      showProgress(resolved.pages.length, resolved.pages.length);
    } catch (error) {
      setBusy(false);
      showError('ページを画像にできませんでした。');
      root.SigK.log?.report({
        level: 'error',
        message: error?.message ?? String(error),
        stack: error?.stack,
        context: { source: 'print' },
      });
      return { error: 'ページを画像にできませんでした。' };
    }

    const placed = fillPrintArea(images);
    await waitForImages();
    if (mine !== token) {
      el.area.replaceChildren();
      return { canceled: true };
    }
    return {
      ok: true,
      pages: resolved.pages,
      placed,
      images: images.map(({ width, height, bytes }) => ({ width, height, bytes })),
      elapsedMs: Math.round((root.performance?.now?.() ?? 0) - startedAt),
    };
  }

  async function run(options = {}) {
    const prepared = await prepare(options);
    if (prepared.ok !== true)
      return prepared;

    const api = root.printAPI;
    if (!api || api.available !== true) {
      setBusy(false);
      showError('印刷の機能が使えません。');
      return { error: '印刷の機能が使えません。' };
    }

    let result = null;
    try {
      result = await api.print({ silent: options.silent === true });
    } catch (error) {
      result = { ok: false, reason: error?.message ?? String(error) };
    }
    setBusy(false);
    el.area.replaceChildren();
    if (result?.ok !== true && result?.canceled !== true)
      showError(`印刷できませんでした。${result?.reason ?? ''}`.trim());
    else
      close();
    return result ?? { ok: false };
  }

  // ---- 出し入れ ----

  function open() {
    if (el === null)
      return false;
    if (viewer().getState().open !== true)
      return false;

    showError(null);
    setBusy(false);
    el.doc.getElementById('print-mode-all').checked = true;
    el.pages.value = '';
    el.area.replaceChildren();

    // 開いている <dialog> に showModal() をもう一度呼ぶと InvalidStateError に
    // なる。Ctrl+P を続けて押しても落ちないよう、開いていれば中身を戻すだけに
    // する。jsdom には showModal が無いので open 属性で代用する（doc-info と
    // 同じ作法）。
    if (el.dialog.open === true || el.dialog.hasAttribute('open'))
      return true;
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    return true;
  }

  function close() {
    if (el === null)
      return false;
    // 作りかけがあれば捨てる。世代を上げれば飛んでいる準備は無効になる。
    token += 1;
    setBusy(false);
    el.area.replaceChildren();
    if (typeof el.dialog.close === 'function')
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    return true;
  }

  function init(doc, win) {
    if (win.__sigkPrintReady === true)
      return false;

    const dialog = doc.getElementById('print-dialog');
    const area = doc.getElementById('print-area');
    if (dialog === null || area === null)
      return false;

    el = {
      doc,
      dialog,
      area,
      pages: doc.getElementById('print-pages'),
      error: doc.getElementById('print-error'),
      progress: doc.getElementById('print-progress'),
      progressText: doc.getElementById('print-progress-text'),
      bar: doc.getElementById('print-bar'),
      run: doc.getElementById('print-run'),
      cancel: doc.getElementById('print-cancel'),
    };
    if (Object.values(el).some((node) => node === null)) {
      el = null;
      return false;
    }
    win.__sigkPrintReady = true;

    // ページ指定の欄を触ったら、その場で「ページ指定」へ寄せる。
    el.pages.addEventListener('focus', () => {
      doc.getElementById('print-mode-custom').checked = true;
    });
    el.pages.addEventListener('input', () => showError(null));
    el.run.addEventListener('click', () => {
      if (el.run.getAttribute('aria-disabled') !== 'true')
        run();
    });
    el.cancel.addEventListener('click', () => close());
    doc.getElementById('print-close')?.addEventListener('click', () => close());
    doc.getElementById('btn-print')?.addEventListener('click', () => {
      if (doc.getElementById('btn-print').getAttribute('aria-disabled') !== 'true')
        open();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.print = {
    MAX_PAGES,
    PRINT_DPI,
    PRINT_SCALE,
    normalizeRangeText,
    parsePageList,
    resolvePages,
    prepare,
    run,
    open,
    close,
    init,
    isBusy: () => busy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
