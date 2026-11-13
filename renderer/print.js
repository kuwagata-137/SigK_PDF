(function (root) {
  'use strict';

  // 印刷（F-01-8・spec-1-4 E・docs/spec-7-7-print-dialog.md）。印刷画面の開閉と印刷の流れ。
  //
  // 印刷用のコンテナ（#print-area）へ用紙 1 枚ぶんずつの画像を並べ、@media print でそれ以外を隠し、メイン側の webContents.print() を
  // silent で呼ぶ（確定事項28・質問 PR1 案A）。レンダラーの window.print() を使わないのは、オプションを渡せず結果も受け取れないため
  // である（確定事項29）。［印刷］を押したら印刷画面を閉じ、進行状況画面を表示する（spec-7-7 確定事項C6）。
  // プリンターの取得は print-printers.js、プレビューとボタンで開く画面は print-actions.js、画像の準備は print-job.js。

  // pdf.js viewer の PRINT_RESOLUTION と同じ 150dpi 相当（確定事項31）。用紙の上でこの解像度になるように描く。
  const PRINT_DPI = 150;
  const PRINT_SCALE = PRINT_DPI / 72;
  const ctx = { doc: null, dialog: null, area: null, token: 0, busy: false, running: false };

  const pagesApi = () => root.SigK.printPages;
  const viewer = () => root.SigK.viewer;
  const D = () => root.SigK.printDialog;
  const S = () => root.SigK.printSettings;
  const printers = () => root.SigK.printPrinters;
  const actions = () => root.SigK.printActions;

  function isDialogOpen() {
    return ctx.dialog !== null && (ctx.dialog.open === true || ctx.dialog.hasAttribute('open'));
  }

  // 試験と起動確認は、印刷するページを { mode: 'all' | 'current' | 'custom', text } で渡せる（以前の作り方）。
  function stateWith(overrides) {
    const state = D().getState() ?? S().defaults();
    if (typeof overrides?.mode !== 'string')
      return state;
    return { ...state, range: overrides.mode, text: overrides.text ?? state.text };
  }

  function jobFor(state) {
    const view = viewer().getState();
    return S().toJob(state, { config: D().getConfig() ?? printers().FALLBACK, pageCount: view.pageCount, current: view.current });
  }

  function setBusy(on) {
    ctx.busy = on;
    D().setBusy(on);
  }

  // 印刷の手前まで（用紙ごとの画像を #print-area に並べる）。SIGK_SMOKE_PRINT と試験はここまでを確かめる。
  async function prepare(overrides = {}) {
    if (ctx.dialog === null)
      return { error: '印刷画面が準備されていません。' };
    const first = jobFor(stateWith(overrides));
    if (first.error !== undefined) {
      D().showError(first.error);
      return { error: first.error };
    }
    D().showError(null);
    // 世代は待つ前に取る（取得を待っている間に閉じられても、準備を捨てられるように）。
    const mine = (ctx.token += 1);
    setBusy(true);
    await printers().whenReady();
    if (mine !== ctx.token)
      return { canceled: true };
    const result = await root.SigK.printJob.prepareImages(ctx.doc, ctx.area, jobFor(stateWith(overrides)), { isAlive: () => mine === ctx.token });
    if (mine === ctx.token)
      setBusy(false);
    if (result.error !== undefined)
      D().showError(result.error);
    return result;
  }

  function progressText(done, total) {
    root.SigK.printProgress.preparing(total === 0 ? 0 : done / total);
  }

  function finishRun(result) {
    if (result.ok !== true && result.canceled !== true)
      root.SigK.viewBanner?.show(`印刷できませんでした。${result.reason ?? result.error ?? ''}`.trim());
    return result;
  }

  // ［印刷］: 印刷画面を閉じ、進行状況画面を表示して、用紙ごとにプリンターへ送る。失敗は通知バー（赤）に表示する（確定事項C6）。
  async function run(overrides = {}) {
    if (ctx.dialog === null)
      return { error: '印刷画面が準備されていません。' };
    const state = stateWith(overrides);
    const first = jobFor(state);
    if (first.error !== undefined) {
      D().showError(first.error);
      return { error: first.error };
    }
    const mine = (ctx.token += 1);
    const isAlive = () => mine === ctx.token;
    ctx.running = true;
    hideDialog();
    setBusy(true);
    root.SigK.printProgress.show(() => abandon());
    try {
      await printers().whenReady();
      if (!isAlive())
        return { canceled: true };
      const job = jobFor(state);
      const prepared = await root.SigK.printJob.prepareImages(ctx.doc, ctx.area, job, { isAlive, onProgress: progressText });
      if (prepared.ok !== true)
        return finishRun(prepared);
      root.SigK.printProgress.preparing(1);
      const options = { ...job.send, duplexMode: prepared.duplexMode ?? job.send.duplexMode };
      return finishRun((await root.SigK.printSend.send(ctx.doc, ctx.area, prepared.jobs, options, { isAlive })) ?? { ok: false });
    } finally {
      ctx.running = false;
      root.SigK.printProgress.hide();
      setBusy(false);
      ctx.area.replaceChildren();
    }
  }

  // ---- 開閉 ----

  function open() {
    if (ctx.dialog === null || viewer().getState().open !== true)
      return false;
    // 入力中のテキストは確定してから映す（spec-4-2 確定事項8）。
    root.SigK.annotate?.finishEditing();
    // 前の準備が残っていれば捨てる（世代を進める。spec-4b-7a 点検の直し）。
    abandon();
    D().showError(null);
    D().setPageCount(viewer().getState().pageCount);
    D().setState(S().forOpen(D().getState()));
    // 開いている <dialog> に showModal() をもう一度呼ぶと InvalidStateError になる。jsdom には showModal が無いので open 属性で代用する。
    if (isDialogOpen())
      return true;
    root.SigK.printDialogKeys.resetPosition(ctx.dialog);
    if (typeof ctx.dialog.showModal === 'function')
      ctx.dialog.showModal();
    else
      ctx.dialog.setAttribute('open', '');
    // Acrobat と同じく、プリンターの一覧にフォーカスを当てる（ユーザーの画面写真 1）。
    ctx.doc.getElementById('print-printer')?.focus();
    printers().load();
    return true;
  }

  function hideDialog() {
    actions().cancelPreview();
    if (!isDialogOpen())
      return;
    if (typeof ctx.dialog.close === 'function')
      ctx.dialog.close();
    else
      ctx.dialog.removeAttribute('open');
  }

  // 作りかけがあれば捨てる。世代を上げれば飛んでいる準備は無効になる（確定事項36）。
  function abandon() {
    ctx.token += 1;
    actions().cancelPreview();
    setBusy(false);
    ctx.area?.replaceChildren();
  }

  function close() {
    if (ctx.dialog === null)
      return false;
    abandon();
    hideDialog();
    return true;
  }

  function init(doc, win) {
    if (win.__sigkPrintReady === true)
      return false;
    const dialog = doc.getElementById('print-dialog');
    const area = doc.getElementById('print-area');
    if (dialog === null || area === null)
      return false;
    win.__sigkPrintReady = true;
    Object.assign(ctx, { doc, dialog, area });
    for (const part of [D(), root.SigK.printPreview, root.SigK.printPageSetup, root.SigK.printProgress, root.SigK.printInfo])
      part.init(doc);
    actions().init({ doc, isOpen: isDialogOpen, isBusy: () => ctx.busy, jobFor, close });
    printers().init({ onLoading: () => actions().refreshPreview(), onLoaded: () => actions().schedulePreview(false) });
    root.SigK.printDialogInput.init(doc, {
      onChange: () => actions().schedulePreview(),
      onPrinter: (name) => printers().select(name),
      onProperties: () => printers().openProperties(),
      onHelp: () => actions().openHelp(),
      onSummary: () => actions().askSummary(),
      onSetup: () => actions().openSetup(),
      onRun: () => run(),
      onCancel: () => close(),
      bestOrientation: (perSheet) => actions().bestOrientation(perSheet),
    });
    root.SigK.printDialogKeys.attach(dialog, { onEnter: () => { if (!doc.getElementById('print-run').disabled) run(); } });
    // Esc で窓が閉じたときも、準備中なら捨てる（spec-4b-7a 確定事項D1）。［印刷］で閉じた時（running）は捨てない。
    for (const type of ['cancel', 'close']) {
      dialog.addEventListener(type, () => {
        if (ctx.busy && !ctx.running)
          abandon();
      });
    }
    doc.getElementById('btn-print')?.addEventListener('click', () => {
      if (doc.getElementById('btn-print').getAttribute('aria-disabled') !== 'true')
        open();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.print = {
    get MAX_PAGES() {
      return pagesApi().MAX_PAGES;
    },
    PRINT_DPI,
    PRINT_SCALE,
    normalizeRangeText: (text) => pagesApi().normalizeRangeText(text),
    parsePageList: (text, pageCount) => pagesApi().parsePageList(text, pageCount),
    resolvePages: (spec) => pagesApi().resolvePages(spec),
    prepare,
    run,
    open,
    close,
    init,
    refreshPreview: (keepIndex) => actions().refreshPreview(keepIndex),
    whenConfigReady: () => printers().whenReady(),
    isBusy: () => ctx.busy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
