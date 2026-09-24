(function (root) {
  'use strict';

  // フラット化の確認（spec-4-5 確定事項10。docs/04 第7章・.claude/CLAUDE.md 付則C）。
  //
  // 焼き込む件数と書き出す先、失うもの（ノートの本文と作成者）を名指しする。「焼き込む」は危険色で、
  // **既定のフォーカスはキャンセル**に置く。元のファイルは残るが、書き出したファイルの中では焼き込みを
  // 戻せないためである（抽出の確認 confirm-extract.js が実行側に置くのは、あちらは失うものが
  // しおりなどに限られ、書き出したファイルの中身そのものは元と同じだから）。
  //
  // 意匠と逃げ道（jsdom に showModal が無い）は confirm-extract.js と揃える。

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

  // 焼き込んでよければ true。組み立てられない環境では、失うものを伝えないまま焼くより
  // 「進めない」ほうを採る。
  function ask({ count = 0, name = '', notes = 0 } = {}) {
    if (el === null)
      return Promise.resolve(false);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = `注釈 ${count} 件をページの内容として焼き込み、「${name}」に書き出します。`
      + '書き出したファイルでは、これらの注釈を選んだり直したりできません。元のファイルは変わりません。';
    el.notes.textContent = notes > 0 ? `ノート ${notes} 件の本文と作成者は、書き出したファイルに残りません。` : '';
    el.notes.hidden = !(notes > 0);

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.cancel.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmFlattenReady === true)
      return false;
    const dialog = doc.getElementById('confirm-flatten');
    if (dialog === null)
      return false;
    win.__sigkConfirmFlattenReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('confirm-flatten-text'),
      notes: doc.getElementById('confirm-flatten-notes'),
      ok: doc.getElementById('confirm-flatten-ok'),
      cancel: doc.getElementById('confirm-flatten-cancel'),
    };
    el.ok.addEventListener('click', () => finish(true));
    el.cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmFlatten = { init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
