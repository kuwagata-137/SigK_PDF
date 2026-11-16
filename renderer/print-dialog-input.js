(function (root) {
  'use strict';

  // 印刷画面の操作で設定を変える（docs/spec-7-7-print-dialog.md）。設定を変えたら画面に反映し（print-dialog.js）、
  // hooks.onChange でプレビューの描き直しを頼む。プリンターの取得・ページ設定・印刷などは hooks で print.js へ渡す。

  const D = () => root.SigK.printDialog;
  let hooks = {};
  let doc = null;

  function update(patch) {
    const next = { ...D().getState(), ...patch };
    D().setState(next);
    D().showError(null);
    hooks.onChange?.(next);
  }

  function updateIn(key, patch) {
    update({ [key]: { ...D().getState()[key], ...patch } });
  }

  // 全角の数字も受け付け、範囲に収める。読めなければ fallback。
  function intOf(value, min, max, fallback) {
    const number = Number(String(value ?? '').normalize('NFKC').trim());
    return Number.isFinite(number) && String(value ?? '').trim() !== '' ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  }

  function setCopies(value) {
    update({ copies: intOf(value, 1, 999, D().getState().copies) });
  }

  function setRange(range) {
    const state = D().getState();
    const text = range === 'custom' && state.text === '' ? root.SigK.printPages.rangeHint(D().getPageCount()) : state.text;
    update({ range, text });
    if (range === 'custom') {
      const field = doc?.getElementById('print-pages');
      field?.focus();
      field?.select?.();
    }
  }

  // ページサイズ処理を替える。複数の決まった数では、Acrobat と同じく用紙の向きを選び直す。
  function setHandling(handling) {
    const state = D().getState();
    const patch = { handling, booklet: { ...state.booklet, from: 1, to: null } };
    if (handling === 'multiple' && state.multiple.perSheet !== 'custom')
      patch.orientation = hooks.bestOrientation?.(state.multiple.perSheet) ?? state.orientation;
    update(patch);
  }

  function setPerSheet(value) {
    const state = D().getState();
    if (value === 'custom') {
      const grid = root.SigK.printSheetMulti.gridFor(state.multiple, root.SigK.printSettings.orientationOf(state) === 'landscape');
      updateIn('multiple', { perSheet: 'custom', cols: grid.cols, rows: grid.rows });
      return;
    }
    const perSheet = Number(value);
    update({ multiple: { ...state.multiple, perSheet }, orientation: hooks.bestOrientation?.(perSheet) ?? state.orientation });
  }

  function setBookletRange(which, value) {
    const state = D().getState();
    const count = D().sheetCount();
    const from = which === 'from' ? intOf(value, 1, count, state.booklet.from) : state.booklet.from;
    const to = which === 'to' ? intOf(value, 1, count, state.booklet.to ?? count) : (state.booklet.to ?? count);
    updateIn('booklet', which === 'from' ? { from, to: Math.max(from, to) } : { from: Math.min(from, to), to });
  }

  function wire() {
    const on = (id, type, fn) => doc.getElementById(id)?.addEventListener(type, fn);
    const checked = (id, fn) => on(id, 'change', (event) => fn(event.currentTarget.checked));
    const value = (id, fn) => on(id, 'change', (event) => fn(event.currentTarget.value));

    value('print-printer', (name) => hooks.onPrinter?.(name));
    on('print-props', 'click', () => hooks.onProperties?.());
    on('print-help', 'click', () => hooks.onHelp?.());
    value('print-copies', setCopies);
    on('print-copies-up', 'click', () => setCopies(D().getState().copies + 1));
    on('print-copies-down', 'click', () => setCopies(D().getState().copies - 1));
    checked('print-gray', (on_) => update({ grayscale: on_ }));
    checked('print-ink', (on_) => update({ inkSave: on_ }));

    for (const range of ['all', 'current', 'custom', 'view'])
      on(`print-range-${range}`, 'change', () => setRange(range));
    on('print-pages', 'input', (event) => update({ text: event.currentTarget.value }));
    on('print-more', 'click', () => update({ moreOpen: !D().getState().moreOpen }));
    value('print-parity', (parity) => update({ parity }));
    checked('print-reverse', (reverse) => update({ reverse }));

    for (const handling of root.SigK.printSettings.HANDLINGS)
      on(`print-handling-${handling}`, 'click', () => setHandling(handling));
    for (const fit of ['fit', 'actual', 'shrink', 'custom'])
      on(`print-fit-${fit}`, 'change', () => updateIn('size', { fit }));
    value('print-fit-scale', (scale) => updateIn('size', { scale: intOf(scale, 1, 1000, 100) }));
    checked('print-choose-paper', (choosePaper) => updateIn('size', { choosePaper }));

    value('print-poster-scale', (scale) => updateIn('poster', { scale: intOf(scale, 1, 1000, 100) }));
    value('print-poster-overlap', (overlap) => updateIn('poster', { overlap: intOf(overlap, 0, 100, 0) }));
    checked('print-poster-marks', (tileMarks) => updateIn('poster', { tileMarks }));
    checked('print-poster-labels', (labels) => updateIn('poster', { labels }));
    checked('print-poster-large', (largeOnly) => updateIn('poster', { largeOnly }));

    value('print-multi-count', setPerSheet);
    value('print-multi-cols', (cols) => updateIn('multiple', { cols: intOf(cols, 1, 99, 1) }));
    value('print-multi-rows', (rows) => updateIn('multiple', { rows: intOf(rows, 1, 99, 1) }));
    value('print-multi-order', (order) => updateIn('multiple', { order }));
    checked('print-multi-border', (border) => updateIn('multiple', { border }));

    value('print-booklet-method', (method) => updateIn('booklet', { method }));
    value('print-booklet-from', (from) => setBookletRange('from', from));
    value('print-booklet-to', (to) => setBookletRange('to', to));
    value('print-booklet-binding', (binding) => updateIn('booklet', { binding }));

    checked('print-duplex', (duplex) => update({ duplex }));
    on('print-flip-long', 'change', () => update({ flip: 'longEdge' }));
    on('print-flip-short', 'change', () => update({ flip: 'shortEdge' }));
    for (const orientation of ['auto', 'portrait', 'landscape'])
      on(`print-orient-${orientation}`, 'change', () => update({ orientation }));
    checked('print-autorotate', (autoRotate) => update({ autoRotate }));

    value('print-comments', (comments) => update({ comments }));
    on('print-summary', 'click', () => hooks.onSummary?.());
    on('print-setup', 'click', () => hooks.onSetup?.());
    on('print-run', 'click', () => hooks.onRun?.());
    on('print-cancel', 'click', () => hooks.onCancel?.());
    on('print-close', 'click', () => hooks.onCancel?.());
  }

  function init(nextDoc, nextHooks) {
    doc = nextDoc;
    hooks = nextHooks ?? {};
    wire();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printDialogInput = { init, update, intOf };
})(typeof window !== 'undefined' ? window : globalThis);
