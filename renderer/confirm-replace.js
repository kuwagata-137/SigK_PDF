(function (root) {
  'use strict';

  // 出力先に同名ファイルがあるときの3択（spec-2-1 確定事項26〜28・docs/04 第7章）。
  //
  // 「上書き」（danger）／「別名で保存」／「中止」。既定のフォーカスは安全側の「中止」。
  // 戻り値は 'replace' | 'rename' | 'cancel'。
  //
  // 塊① の結合では、保存先を OS のダイアログで聞くので同名の確認も OS が出す
  // （spec-1-6 確定事項22）。このダイアログが要るのは、塊② で出力先をアプリが
  // 組み立てるときである。部品だけ先に作り、経路（tools-merge.js の resolveTarget）
  // を通しておく。意匠と逃げ道（jsdom に showModal が無い）は confirm-extract.js と揃える。

  const REPLACE = 'replace';
  const RENAME = 'rename';
  const CANCEL = 'cancel';

  let el = null;
  let pending = null;

  function finish(answer) {
    if (pending === null)
      return false;
    const waiting = pending;
    pending = null;
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    waiting.resolve(answer);
    return true;
  }

  function isOpen() {
    return el !== null && pending !== null;
  }

  // 組み立てられない環境では「中止」を返す。黙って上書きするより安全である。
  function ask({ name = null } = {}) {
    if (el === null)
      return Promise.resolve(CANCEL);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = name === null
      ? '同じ名前のファイルが既にあります。上書きしますか。'
      : `「${name}」は既にあります。上書きしますか。`;

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.cancel.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmReplaceReady === true)
      return false;

    const dialog = doc.getElementById('confirm-replace');
    if (dialog === null)
      return false;
    win.__sigkConfirmReplaceReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('confirm-replace-text'),
      ok: doc.getElementById('confirm-replace-ok'),
      rename: doc.getElementById('confirm-replace-rename'),
      cancel: doc.getElementById('confirm-replace-cancel'),
    };

    el.ok?.addEventListener('click', () => finish(REPLACE));
    el.rename?.addEventListener('click', () => finish(RENAME));
    el.cancel?.addEventListener('click', () => finish(CANCEL));
    dialog.addEventListener('close', () => finish(CANCEL));
    dialog.addEventListener('cancel', () => finish(CANCEL));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmReplace = { REPLACE, RENAME, CANCEL, init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
