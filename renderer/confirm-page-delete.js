(function (root) {
  'use strict';

  // 削除確認画面（spec-7-5 確定事項D1〜D3。見本 screenshots/question-pg2-page-edit-mode.png）。
  //
  // ページを削除する操作（Delete キー・右クリックメニューの［削除］・ページ編集モードの［削除］ボタン・サムネイルの［このページを削除］）は、
  // すべてこの画面を通す（page-list-commands.js の remove）。［削除］（危険色）を左、［キャンセル］を右に並べ、最初のフォーカスは［キャンセル］
  // （Enter を押しただけでは削除しない）。すべてのページが対象のときは、削除できないことを書き、［削除］を押せなくする（D3。spec-1-5
  // 確定事項41）。削除は Ctrl+Z で戻せるので、「次回から表示しない」は付けない。
  //
  // 意匠と逃げ道（jsdom に showModal が無い）は confirm-extract.js と同じ。

  const ALL_TEXT = 'すべてのページを削除することはできません。少なくとも 1 ページは残してください。';

  let el = null;
  let pending = null;

  // count は対象のページ数、page は対象が 1 ページのときの番号（1 起点）、all はすべてのページが対象か。
  function textOf({ count, page, all }) {
    if (all)
      return ALL_TEXT;
    return count === 1 ? `${page} ページ目を削除しますか？` : `選択した ${count} ページを削除しますか？`;
  }

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

  // ［削除］を押したら true。画面を組み立てられない環境では、確認しないまま削除するより「削除しない」ほうを採る。
  function ask({ count = 1, page = 1, all = false } = {}) {
    if (el === null)
      return Promise.resolve(false);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = textOf({ count, page, all });
    el.note.hidden = all;
    el.ok.disabled = all;

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.cancel.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmPageDeleteReady === true)
      return false;
    const dialog = doc.getElementById('confirm-page-delete');
    if (dialog === null)
      return false;
    win.__sigkConfirmPageDeleteReady = true;

    el = {
      dialog,
      text: doc.getElementById('confirm-page-delete-text'),
      note: doc.getElementById('confirm-page-delete-note'),
      ok: doc.getElementById('confirm-page-delete-ok'),
      cancel: doc.getElementById('confirm-page-delete-cancel'),
    };

    el.ok.addEventListener('click', () => {
      if (!el.ok.disabled)
        finish(true);
    });
    el.cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmPageDelete = { ALL_TEXT, textOf, init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
