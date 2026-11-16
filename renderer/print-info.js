(function (root) {
  'use strict';

  // 印刷画面の ⓘ を押すと開く説明の画面（docs/spec-7-7-print-dialog.md・Acrobat の画面写真 3-12・3-13）。
  // ページサイズ処理の ⓘ は「ページサイズ処理」の画面、インク / トナーを節約の ⓘ は「トナー節約情報 :」の画面を開く。
  // ⓘ はクリックと、フォーカスがある時の Enter・Space で開く（Acrobat と同じく、ツールチップは表示しない）。
  // 説明の画面は［閉じる］・Enter・Esc で閉じ、押した ⓘ にフォーカスを戻す。

  const PAIRS = Object.freeze([
    Object.freeze({ button: 'print-handling-info', dialog: 'print-handling-info-dialog', close: 'print-handling-info-close' }),
    Object.freeze({ button: 'print-ink-info', dialog: 'print-ink-info-dialog', close: 'print-ink-info-close' }),
  ]);

  const ctx = { doc: null };
  const $ = (id) => ctx.doc.getElementById(id);

  function isOpen(dialog) {
    return dialog.open === true || dialog.hasAttribute('open');
  }

  function open(pair) {
    const dialog = $(pair.dialog);
    if (dialog === null || isOpen(dialog))
      return false;
    root.SigK.printDialogKeys?.resetPosition(dialog);
    if (typeof dialog.showModal === 'function')
      dialog.showModal();
    else
      dialog.setAttribute('open', '');
    $(pair.close).focus();
    return true;
  }

  function close(pair) {
    const dialog = $(pair.dialog);
    if (isOpen(dialog)) {
      if (typeof dialog.close === 'function')
        dialog.close();
      else
        dialog.removeAttribute('open');
    }
    $(pair.button)?.focus();
  }

  function attach(pair) {
    const button = $(pair.button);
    const dialog = $(pair.dialog);
    if (button === null || dialog === null)
      return;
    button.addEventListener('click', () => open(pair));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ')
        return;
      // 印刷画面の Enter（［印刷］を押す）に渡さない。
      event.preventDefault();
      event.stopPropagation();
      open(pair);
    });
    $(pair.close).addEventListener('click', () => close(pair));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(pair);
    });
    root.SigK.printDialogKeys?.attach(dialog, { onEnter: () => close(pair) });
  }

  function init(doc) {
    if (ctx.doc !== null || doc.getElementById('print-handling-info-dialog') === null)
      return false;
    ctx.doc = doc;
    PAIRS.forEach(attach);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printInfo = { init, openHandling: () => open(PAIRS[0]), openInk: () => open(PAIRS[1]) };
})(typeof window !== 'undefined' ? window : globalThis);
