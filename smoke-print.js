'use strict';

// 起動確認 SIGK_SMOKE_PRINT=<範囲>[:<見せ方>]（spec-1-4 の完了判定・docs/spec-7-7-print-dialog.md の完了判定）。
//
// 印刷画面を開き、プリンターの設定を取得するのを待って、印刷の準備（用紙ごとの画像を #print-area に並べる）までを実測する。
// 範囲は「all」「current」か、それ以外は「ページ指定」の文字列。見せ方は画面写真（SIGK_SMOKE_SHOT）を撮る時の印刷画面の状態で、
// size・poster・multiple・booklet（ページサイズ処理）、more（詳細オプションを開く）、duplex（用紙の両面に印刷をオン）、
// ink（インク / トナーを節約をオン）、setup（ページ設定）、summary（注釈の一覧の確認）、handlinginfo・inkinfo（ⓘ の説明の画面）、
// progress（進行状況画面）、custom<列>x<行>（複数のカスタムの列と行）、portrait・landscape（向き）を「+」でつなぐ
// （例 all:multiple+custom1x2+portrait。ユーザーの画面写真 2 と同じ状態）。
// リポジトリは公開なので、画面写真に写るプリンター名は見本の名前に置き換える（このパソコンのプリンター名を残さない）。
// 本物のプリンターには送らない。紙の寸法と枚数は SIGK_SMOKE_PRINT_PDF（printToPDF）で確かめる。

const SAMPLE_PRINTER = '事務所のプリンター（例）';

function parseSpec(value) {
  const [range = 'all', view = 'size'] = String(value ?? '').split(':');
  return { range, views: view.split('+').filter(Boolean) };
}

// 見せ方のうち、印刷画面の設定を変えるもの（ページサイズ処理・詳細オプション・両面・節約・複数のカスタム・向き）を当てる文。
// 呼ぶ側の文で、views（見せ方の配列）と $（id で要素を取る関数）を先に決めておく。
function applyViewsSource() {
  return `for (const view of views) {
      if (['size', 'poster', 'multiple', 'booklet'].includes(view))
        $('print-handling-' + view).click();
      if (view === 'more')
        $('print-more').click();
      if (view === 'duplex' && !$('print-duplex').checked)
        $('print-duplex').click();
      if (view === 'ink' && !$('print-ink').checked)
        $('print-ink').click();
      const grid = /^custom(\\d+)x(\\d+)$/.exec(view);
      if (grid !== null) {
        const set = (id, value) => {
          $(id).value = value;
          $(id).dispatchEvent(new Event('input', { bubbles: true }));
          $(id).dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('print-multi-count', 'custom');
        set('print-multi-cols', grid[1]);
        set('print-multi-rows', grid[2]);
      }
      if (view === 'portrait' || view === 'landscape')
        $('print-orient-' + view).click();
    }`;
}

function printScript(value) {
  const { range, views } = parseSpec(value);
  return `(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const range = ${JSON.stringify(range)};
    const views = ${JSON.stringify(views)};
    const mode = (range === 'all' || range === 'current') ? range : 'custom';
    const $ = (id) => document.getElementById(id);
    const box = (id) => { const r = $(id)?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; };

    window.SigK.print.open();
    const t0 = performance.now();
    await window.SigK.print.whenConfigReady();
    const configMs = Math.round(performance.now() - t0);
    const config = window.SigK.printDialog.getConfig();
    const printerCount = $('print-printer').options.length;

    const t1 = performance.now();
    const result = await window.SigK.print.prepare({ mode, text: range });
    const prepareMs = Math.round(performance.now() - t1);
    const measured = {
      mode, range, views, configMs, prepareMs, printerCount,
      config: config && { source: config.source, paper: config.paper, imageable: config.imageable, duplex: config.duplex, color: config.color, sizes: config.paperSizes.length },
      error: result.error || null,
      pages: (result.pages || []).slice(0, 12),
      sheets: result.sheets || 0,
      placed: result.placed || 0,
      imgCount: document.querySelectorAll('#print-area img').length,
      totalBytes: (result.images || []).reduce((sum, image) => sum + image.bytes, 0),
      rendered: (result.rendered || []).slice(0, 4),
      elapsedMs: result.elapsedMs || null,
    };
    measured.overLimitError = window.SigK.print.resolvePages({ mode: 'all', pageCount: 300 }).error || null;

    // 画面写真の状態にする（準備で並べた画像は open が捨てるので、先に印刷用の PDF を作る時は SIGK_SMOKE_PRINT_PDF を使う）。
    window.SigK.print.open();
    await window.SigK.print.whenConfigReady();
    for (const option of $('print-printer').options)
      option.textContent = ${JSON.stringify(SAMPLE_PRINTER)};
    if (mode === 'custom')
      $('print-range-custom').click();
    ${applyViewsSource()}
    window.SigK.print.refreshPreview(false);
    await wait(900);
    if (views.includes('setup')) {
      $('print-setup').click();
      await wait(300);
    }
    if (views.includes('summary')) {
      $('print-summary').click();
      await wait(300);
    }
    if (views.includes('handlinginfo'))
      $('print-handling-info').click();
    if (views.includes('inkinfo'))
      $('print-ink-info').click();
    if (views.includes('progress')) {
      $('print-dialog').close();
      window.SigK.printProgress.show(() => {});
      await wait(300);
    }
    measured.dialogBox = box('print-dialog');
    // 印刷画面の上に開いた小さな画面（ページ設定・注釈の一覧の確認・ⓘ の説明・進行状況）の位置
    const sub = [...document.querySelectorAll('dialog[open]')].find((dialog) => dialog.id !== 'print-dialog');
    measured.subDialog = sub ? { id: sub.id, ...box(sub.id) } : null;
    measured.previewBox = box('print-preview-paper');
    measured.preview = {
      scale: $('print-preview-scale').textContent,
      size: $('print-preview-size').textContent,
      count: $('print-preview-count').textContent,
      status: $('print-preview-status').hidden ? null : $('print-preview-status').textContent,
      canvas: !!$('print-preview-paper').querySelector('canvas'),
    };
    return measured;
  })()`;
}

// SIGK_SMOKE_PRINT_PDF 用。見せ方（ページサイズ処理など）を当てて印刷の準備をし、#print-area を印刷する状態のまま残す
// （印刷画面を閉じても、並べた画像は消さない）。
function preparePdfScript(value) {
  const { range, views } = parseSpec(value);
  return `(async () => {
    const range = ${JSON.stringify(range)};
    const views = ${JSON.stringify(views)};
    const mode = (range === 'all' || range === 'current') ? range : 'custom';
    const $ = (id) => document.getElementById(id);
    window.SigK.print.open();
    await window.SigK.print.whenConfigReady();
    ${applyViewsSource()}
    const result = await window.SigK.print.prepare({ mode, text: range });
    // 印刷画面を紙に写さないように閉じる（準備が済んでいるので、並べた画像は残る）。
    document.getElementById('print-dialog').close();
    const style = document.getElementById('print-page-style');
    return { views, ok: result.ok === true, sheets: result.sheets || 0, imgCount: document.querySelectorAll('#print-area img').length, pageStyle: style ? style.textContent : null };
  })()`;
}

module.exports = { SAMPLE_PRINTER, parseSpec, applyViewsSource, printScript, preparePdfScript };
