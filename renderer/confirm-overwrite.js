(function (root) {
  'use strict';

  // 開いたあとで元ファイルが外から書き換えられていたときの確認
  // （spec-1-6 確定事項21）。
  //
  // ワーカーは書く直前にサイズと更新時刻を照合し、食い違えば何も書かずに
  // { changed: true } を返す。**黙って上書きすると、他で加えられた変更が
  // 消える**ので、そのときだけここを通す。
  //
  // 確認は「上書き」と「取りやめ」の2択である。docs/04 第7章の3択
  // （上書き／別名で保存／中止）は、出力先を自分で組み立てる Phase 2 の
  // 結合・分割の話であり、ここは保存先が決まっている場面である。
  //
  // 意匠は confirm-discard.js と揃える。jsdom には showModal が無いので
  // open 属性で代用する逃げ道も同じである。

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

  // 上書きしてよければ true。組み立てられない環境では、聞けないまま
  // 他の変更を消すより「上書きしない」ほうが安全なので false を返す。
  function ask({ name = null } = {}) {
    if (el === null)
      return Promise.resolve(false);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = name === null || name === undefined
      ? 'このファイルは、開いたあとで変更されています。上書きすると、その変更は失われます。'
      : `${name} は、開いたあとで変更されています。上書きすると、その変更は失われます。`;

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    // 既定のフォーカスは安全側（取りやめ）に置く（docs/04 第7章）。
    el.cancel.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmOverwriteReady === true)
      return false;

    const dialog = doc.getElementById('confirm-overwrite');
    if (dialog === null)
      return false;
    win.__sigkConfirmOverwriteReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('confirm-overwrite-text'),
      ok: doc.getElementById('confirm-overwrite-ok'),
      cancel: doc.getElementById('confirm-overwrite-cancel'),
    };

    el.ok?.addEventListener('click', () => finish(true));
    el.cancel?.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmOverwrite = { init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
