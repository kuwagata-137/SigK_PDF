(function (root) {
  'use strict';

  // モザイクを入れて保存する前の確認（spec-4b-6b 確定事項18。決定64 ⑤⑧。見本 screenshots/phase4b-6-mosaic-confirm.png・
  // phase4b-6b-mosaic-saveas.png。.claude/CLAUDE.md 付則C）。
  //
  // 画像に置き換えるページ・保存先・失うもの（そのページの文字の検索・選択・コピー、モザイクの下の内容）・残るもの（書き込み）を名指しし、
  // 上書きなら控え（.bak）を作らないことも伝える。「置き換えて保存」は危険色で、**既定のフォーカスはキャンセル**に置く（保存したファイルの
  // 中では戻せないため。confirm-flatten.js と同じ）。意匠と逃げ道（jsdom に showModal が無い）は confirm-flatten.js と揃える。

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

  // 文面（確定事項18）。mode は 'overwrite'（上書き）か 'saveAs'（名前を付けて保存）。
  function textsOf({ mode, count, pages, name, sourceName }) {
    const head = `モザイクを入れた ${count} ページ（${pages}）を、丸ごと画像に置き換えて「${name}」に`;
    if (mode === 'saveAs') {
      return [
        `${head}保存します。元のファイル「${sourceName}」は変わりません。`,
        '保存したファイルでは、そのページの文字は検索・選択・コピーできず、モザイクの下の内容は元に戻せません。書き込みは書き込みのまま残ります。',
        '',
      ];
    }
    return [
      `${head}上書き保存します。`,
      'そのページの文字は検索・選択・コピーできなくなり、モザイクの下の内容は元に戻せません。書き込みは書き込みのまま残ります。',
      '元の内容が残らないよう、このときは控えのファイル（.bak）を作りません。前に作った控えがあれば消します。',
    ];
  }

  // 置き換えてよければ true。組み立てられない環境では、失うものを伝えないまま置き換えるより「進めない」ほうを採る。
  function ask(options = {}) {
    if (el === null)
      return Promise.resolve(false);
    if (pending !== null)
      return pending.promise;

    const [text, loss, backup] = textsOf(options);
    el.text.textContent = text;
    el.loss.textContent = loss;
    el.backup.textContent = backup;
    el.backup.hidden = backup === '';

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.cancel.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkConfirmMosaicReady === true)
      return false;
    const dialog = doc.getElementById('confirm-mosaic');
    if (dialog === null)
      return false;
    win.__sigkConfirmMosaicReady = true;

    el = {
      dialog,
      text: doc.getElementById('confirm-mosaic-text'),
      loss: doc.getElementById('confirm-mosaic-loss'),
      backup: doc.getElementById('confirm-mosaic-backup'),
      ok: doc.getElementById('confirm-mosaic-ok'),
      cancel: doc.getElementById('confirm-mosaic-cancel'),
    };
    el.ok.addEventListener('click', () => finish(true));
    el.cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmMosaic = { init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
