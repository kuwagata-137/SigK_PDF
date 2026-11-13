(function (root) {
  'use strict';

  // 印刷画面の表示（docs/spec-7-7-print-dialog.md）。設定（print-settings.js の形）を画面に反映する。
  // 操作で設定を変えるのは print-dialog-input.js、アクセスキーと移動は print-dialog-keys.js、開閉と印刷の流れは print.js。

  const ctx = { el: null, state: null, config: null, printers: [], pageCount: 0, busy: false };

  const settings = () => root.SigK.printSettings;
  const $ = (id) => ctx.el.doc.getElementById(id);

  function setChecked(id, value) {
    const node = $(id);
    if (node !== null)
      node.checked = value === true;
  }

  function setValue(id, value) {
    const node = $(id);
    if (node !== null && node !== ctx.el.doc.activeElement)
      node.value = String(value ?? '');
  }

  function setDisabled(id, value) {
    const node = $(id);
    if (node !== null)
      node.disabled = value === true;
  }

  function renderPrinters() {
    const select = $('print-printer');
    const names = ctx.printers.map((printer) => printer.name);
    const current = [...select.options].map((option) => option.value);
    if (names.join('\n') !== current.join('\n')) {
      select.replaceChildren(...ctx.printers.map((printer) => {
        const option = ctx.el.doc.createElement('option');
        option.value = printer.name;
        option.textContent = printer.displayName || printer.name;
        return option;
      }));
    }
    select.value = ctx.state.printer ?? '';
    // 一覧の取得中は押せる状態のままにする（開いた時にフォーカスを当てるため。Acrobat の画面写真 1）。
    select.disabled = ctx.printers.length === 0 && ctx.config !== null;
    setDisabled('print-props', ctx.state.printer === null || ctx.busy);
  }

  function renderTop() {
    renderPrinters();
    setValue('print-copies', ctx.state.copies);
    setChecked('print-gray', settings().grayscaleOf(ctx.state, ctx.config));
    setChecked('print-ink', ctx.state.inkSave);
  }

  function renderRange() {
    const { state } = ctx;
    for (const range of ['all', 'current', 'custom', 'view'])
      setChecked(`print-range-${range}`, state.range === range);
    const pages = $('print-pages');
    pages.disabled = state.range !== 'custom';
    if (pages !== ctx.el.doc.activeElement)
      pages.value = state.range === 'custom' ? state.text : root.SigK.printPages.rangeHint(ctx.pageCount);
    $('print-more').setAttribute('aria-expanded', state.moreOpen ? 'true' : 'false');
    $('print-more-body').hidden = !state.moreOpen;
    const booklet = state.handling === 'booklet';
    setValue('print-parity', state.parity);
    setDisabled('print-parity', booklet);
    setChecked('print-reverse', state.reverse);
    setDisabled('print-reverse', booklet);
  }

  function renderHandling() {
    const { state } = ctx;
    for (const handling of settings().HANDLINGS) {
      $(`print-handling-${handling}`).setAttribute('aria-pressed', state.handling === handling ? 'true' : 'false');
      $(`print-panel-${handling}`).hidden = state.handling !== handling;
    }
    for (const fit of ['fit', 'actual', 'shrink', 'custom'])
      setChecked(`print-fit-${fit}`, state.size.fit === fit);
    setValue('print-fit-scale', state.size.scale);
    setDisabled('print-fit-scale', state.size.fit !== 'custom');
    setChecked('print-choose-paper', state.size.choosePaper);
    setValue('print-poster-scale', state.poster.scale);
    setValue('print-poster-overlap', state.poster.overlap);
    setChecked('print-poster-marks', state.poster.tileMarks);
    setChecked('print-poster-labels', state.poster.labels);
    setChecked('print-poster-large', state.poster.largeOnly);
    renderMultiple();
    renderBooklet();
  }

  function renderMultiple() {
    const { multiple } = ctx.state;
    const custom = multiple.perSheet === 'custom';
    setValue('print-multi-count', multiple.perSheet);
    const grid = custom ? multiple : root.SigK.printSheetMulti.gridFor(multiple, settings().orientationOf(ctx.state) === 'landscape');
    setValue('print-multi-cols', grid.cols);
    setValue('print-multi-rows', grid.rows);
    setDisabled('print-multi-cols', !custom);
    setDisabled('print-multi-rows', !custom);
    setValue('print-multi-order', multiple.order);
    setChecked('print-multi-border', multiple.border);
  }

  function renderBooklet() {
    const { booklet } = ctx.state;
    setValue('print-booklet-method', booklet.method);
    setValue('print-booklet-from', booklet.from);
    setValue('print-booklet-to', booklet.to ?? sheetCount());
    setValue('print-booklet-binding', booklet.binding);
  }

  // 小冊子の紙の枚数（印刷するページの数から）。ページ指定が読めない時は総ページ数で数える。
  function sheetCount() {
    const resolved = settings().pagesOf({ ...ctx.state, handling: 'booklet' }, { pageCount: ctx.pageCount, current: 0 });
    return root.SigK.printSheetPlan.bookletSheetCount(resolved.pages?.length ?? ctx.pageCount);
  }

  function renderOrientation() {
    const { state, config } = ctx;
    const booklet = state.handling === 'booklet';
    const poster = state.handling === 'poster';
    // ポスターと小冊子では、用紙の両面に印刷(B) の行を表示しない（Acrobat の画面写真 3-02・3-03。小冊子の両面は、小冊子の印刷方法で決める）。
    const shown = config?.duplex?.supported !== false && !booklet && !poster;
    $('print-duplex-row').hidden = !shown;
    setChecked('print-duplex', settings().duplexOf(state, config));
    $('print-flip-row').hidden = !shown || !settings().duplexOf(state, config);
    setChecked('print-flip-long', state.flip !== 'shortEdge');
    setChecked('print-flip-short', state.flip === 'shortEdge');
    const size = state.handling === 'size';
    const orientation = settings().orientationOf(state);
    $('print-orient-auto-label').hidden = !size;
    for (const value of ['auto', 'portrait', 'landscape'])
      setChecked(`print-orient-${value}`, orientation === value);
    setDisabled('print-orient-portrait', booklet);
    setDisabled('print-orient-landscape', booklet);
    // 各シート内でページを自動回転(W) は、複数と小冊子だけ（画面写真 2・3-05）。ポスターでは表示しない（Claude の案。画面写真 3-02 に写っていない）。
    $('print-autorotate-row').hidden = size || poster;
    setChecked('print-autorotate', state.autoRotate);
  }

  function renderComments() {
    setValue('print-comments', ctx.state.comments);
    $('print-summary').setAttribute('aria-pressed', ctx.state.summary ? 'true' : 'false');
  }

  function render() {
    // 窓を閉じた後（アプリの終了・試験の片付け）に、取得の結果が遅れて届くことがある。
    if (ctx.el === null || ctx.state === null || $('print-printer') === null)
      return;
    renderTop();
    renderRange();
    renderHandling();
    renderOrientation();
    renderComments();
    const ready = ctx.config !== null && !ctx.busy;
    $('print-run').disabled = !ready;
    $('print-setup').disabled = !ready;
  }

  function showError(message) {
    const node = $('print-error');
    node.textContent = message ?? '';
    node.hidden = message === null || message === undefined || message === '';
  }

  function init(doc) {
    if (ctx.el !== null)
      return false;
    ctx.el = { doc, dialog: doc.getElementById('print-dialog') };
    return ctx.el.dialog !== null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printDialog = {
    init,
    render,
    showError,
    sheetCount,
    getState: () => ctx.state,
    setState: (state) => { ctx.state = state; render(); },
    getConfig: () => ctx.config,
    setConfig: (config) => { ctx.config = config; render(); },
    getPrinters: () => ctx.printers,
    setPrinters: (printers) => { ctx.printers = Array.isArray(printers) ? printers : []; render(); },
    setPageCount: (count) => { ctx.pageCount = count; },
    getPageCount: () => ctx.pageCount,
    setBusy: (busy) => { ctx.busy = busy === true; render(); },
    isBusy: () => ctx.busy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
