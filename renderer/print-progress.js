(function (root) {
  'use strict';

  // 印刷の進行状況画面（docs/spec-7-7-print-dialog.md 確定事項C6）と、注釈の一覧(T) の確認画面（質問 PR2）。
  // 進行状況画面の文言は、Acrobat の画面写真（質問 PR4）が届いたら合わせる。

  const ctx = { doc: null, onCancel: null, resolve: null };
  const $ = (id) => ctx.doc.getElementById(id);

  function openModal(dialog) {
    if (dialog.open === true || dialog.hasAttribute('open'))
      return;
    if (typeof dialog.showModal === 'function')
      dialog.showModal();
    else
      dialog.setAttribute('open', '');
  }

  function closeModal(dialog) {
    if (typeof dialog.close === 'function')
      dialog.close();
    else
      dialog.removeAttribute('open');
  }

  // ---- 進行状況画面 ----

  function show(onCancel) {
    ctx.onCancel = onCancel;
    setProgress('', 0);
    openModal($('print-progress-dialog'));
    $('print-progress-cancel').disabled = false;
    $('print-progress-cancel').focus();
  }

  function setProgress(text, ratio) {
    $('print-progress-text').textContent = text;
    $('print-bar').style.width = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
  }

  function hide() {
    ctx.onCancel = null;
    closeModal($('print-progress-dialog'));
  }

  function cancel() {
    const onCancel = ctx.onCancel;
    $('print-progress-cancel').disabled = true;
    setProgress('印刷を中止しています…', 1);
    onCancel?.();
  }

  // ---- 注釈の一覧(T) の確認。［はい(Y)］で true、［いいえ(N)］で false、［×］・Esc で null。 ----

  function askSummary() {
    return new Promise((resolve) => {
      ctx.resolve = resolve;
      openModal($('print-summary-confirm'));
      $('print-summary-yes').focus();
    });
  }

  function answer(value) {
    const resolve = ctx.resolve;
    ctx.resolve = null;
    closeModal($('print-summary-confirm'));
    resolve?.(value);
  }

  function init(doc) {
    if (ctx.doc !== null || doc.getElementById('print-progress-dialog') === null)
      return false;
    ctx.doc = doc;
    $('print-progress-cancel').addEventListener('click', cancel);
    $('print-progress-dialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      cancel();
    });
    $('print-summary-yes').addEventListener('click', () => answer(true));
    $('print-summary-no').addEventListener('click', () => answer(false));
    $('print-summary-close').addEventListener('click', () => answer(null));
    $('print-summary-confirm').addEventListener('cancel', (event) => {
      event.preventDefault();
      answer(null);
    });
    root.SigK.printDialogKeys?.attach($('print-summary-confirm'), { onEnter: () => answer(true) });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printProgress = { init, show, setProgress, hide, cancel, askSummary, isShown: () => ctx.onCancel !== null };
})(typeof window !== 'undefined' ? window : globalThis);
