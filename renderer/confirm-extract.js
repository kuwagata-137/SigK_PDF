(function (root) {
  'use strict';

  // 抽出の確認（spec-1-6 確定事項48）。
  //
  // 抽出は新規文書へ複製するため、**しおり・入力欄・名前付きのリンク先は必ず消える**
  // （実測）。黙って落とすと、開いてみて初めて気づくことになる。**失うものを先に
  // 名指しする**のがこのダイアログの唯一の役目である。
  //
  // 元ファイルは変えないので取り返しはつく。既定のフォーカスは破棄側ではなく
  // 「抽出」に置く（confirm-discard.js が安全側に置くのは、あちらが編集を捨てる
  // 操作だからである）。
  //
  // 意匠と逃げ道（jsdom に showModal が無い）は confirm-overwrite.js と揃える。

  let el = null;
  let pending = null;

  function finish(ok) {
    if (pending === null)
      return false;
    const waiting = pending;
    pending = null;
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    waiting.resolve(ok);
    return true;
  }

  function isOpen() {
    return el !== null && pending !== null;
  }

  // 抽出してよければ true。組み立てられない環境では、失うものを伝えないまま
  // 書き出すより「進めない」ほうを採る。
  function ask({ count = 0 } = {}) {
    if (el === null)
      return Promise.resolve(false);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = `選択した ${count} ページを別のファイルへ書き出します。`
      + 'しおり・入力欄・名前付きのリンク先は引き継がれません。元のファイルは変更されません。';

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.ok.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmExtractReady === true)
      return false;

    const dialog = doc.getElementById('confirm-extract');
    if (dialog === null)
      return false;
    win.__sigkConfirmExtractReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('confirm-extract-text'),
      ok: doc.getElementById('confirm-extract-ok'),
      cancel: doc.getElementById('confirm-extract-cancel'),
    };

    el.ok?.addEventListener('click', () => finish(true));
    el.cancel?.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmExtract = { init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
