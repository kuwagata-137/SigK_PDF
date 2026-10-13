(function (root) {
  'use strict';

  // 分割の盤の上の段と、選んだときの操作の帯（spec-2-2b 確定事項C4〜C9。見本 screenshots/phase2-2b-04a-band-top.png）。
  //
  // 上の段は、まとめて分ける 4 つ（［1 ページずつに分ける］・［N］［ページごとに分ける］・［番号］［ページの前で切る］・
  // ［分け目をすべて消す］）と［元に戻す］［やり直す］と大きさ 小・中・大。帯は選んでいる間だけ、箱の並びの上に固定して出す
  // （決定77 ①）。押した・打ったことは tools-split-edit.js へ渡すだけで、sync() で見た目を合わせる。

  let el = null;

  const split = () => root.SigK.toolsSplit;
  const edit = () => root.SigK.toolsSplitEdit;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function bandText(band) {
    return `${root.SigK.toolsSplitView.rangeText(band.from, band.to)}を選んでいます`;
  }

  function syncBand(running) {
    const board = edit().board();
    const band = board === null || running ? null : root.SigK.splitSelection.bandOf(board, edit().selection());
    el.band.hidden = band === null;
    el.bandText.textContent = band === null ? '' : bandText(band);
    el.skip.hidden = band?.allSkipped === true;
    el.unskip.hidden = band?.allSkipped !== true;
  }

  function sync() {
    if (el === null)
      return false;
    const running = split().isRunning();
    const ready = split().currentPlan().reason !== 'no-source';
    for (const button of [el.each, el.everyGo, el.atGo, el.clear])
      setDisabled(button, running || !ready);
    setDisabled(el.undo, running || !edit().canUndo());
    setDisabled(el.redo, running || !edit().canRedo());
    const error = edit().bulkError();
    for (const [kind, input] of Object.entries(el.inputs)) {
      input.disabled = running;
      input.classList.toggle('invalid', error?.kind === kind);
      if (el.doc.activeElement !== input && input.value !== edit().bulkText(kind))
        input.value = edit().bulkText(kind);
    }
    el.error.hidden = error === null;
    el.error.textContent = error?.message ?? '';
    for (const button of el.sizes)
      button.setAttribute('aria-checked', button.dataset.size === edit().size() ? 'true' : 'false');
    syncBand(running);
    return true;
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function bindInput(kind) {
    const input = el.inputs[kind];
    input.addEventListener('input', () => edit().setBulkText(kind, input.value));
    // 欄で Enter を押したら、隣のボタンを押したのと同じ。
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing)
        return;
      event.preventDefault();
      edit().bulk(kind);
    });
  }

  function init(doc, win) {
    if (win.__sigkSplitBoardBandReady === true)
      return false;
    const band = doc.getElementById('split-band');
    if (band === null)
      return false;
    win.__sigkSplitBoardBandReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc, band,
      each: byId('split-each'), everyGo: byId('split-every-go'), atGo: byId('split-at-go'), clear: byId('split-clear'),
      undo: byId('split-undo'), redo: byId('split-redo'), error: byId('split-bulk-err'),
      inputs: { every: byId('split-every'), at: byId('split-at') },
      sizes: [...doc.querySelectorAll('#split-size [data-size]')],
      bandText: byId('split-band-text'), one: byId('split-band-one'), skip: byId('split-band-skip'),
      unskip: byId('split-band-unskip'), clearSelection: byId('split-band-clear'),
    };
    onClick(el.each, () => edit().bulk('each'));
    onClick(el.everyGo, () => edit().bulk('every'));
    onClick(el.atGo, () => edit().bulk('at'));
    onClick(el.clear, () => edit().bulk('clear'));
    onClick(el.undo, () => edit().undo());
    onClick(el.redo, () => edit().redo());
    bindInput('every');
    bindInput('at');
    for (const button of el.sizes)
      button.addEventListener('click', () => edit().setSize(button.dataset.size));
    // 帯のボタンは押すと隠れることがあるので、押したらフォーカスを盤の器へ戻す（点検 R1）。
    const toBoard = (action) => () => {
      action();
      doc.getElementById('split-board-scroll')?.focus?.({ preventScroll: true });
    };
    el.one.addEventListener('click', toBoard(() => edit().makeOne()));
    el.skip.addEventListener('click', toBoard(() => edit().skip()));
    el.unskip.addEventListener('click', toBoard(() => edit().unskip()));
    el.clearSelection.addEventListener('click', toBoard(() => edit().clearSelection()));
    sync();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.splitBoardBand = { init, sync };
})(typeof window !== 'undefined' ? window : globalThis);
