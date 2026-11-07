(function (root) {
  'use strict';

  // 画像のタブを上書き保存する前の確認（spec-7-1 確定事項B1・B6。docs/07 決定86 ①。.claude/CLAUDE.md 付則C）。
  //
  // 書き込みを画像の画素に焼き込むと、保存したあとは書き込みを動かしたり直したりできず、書き込みの下にあった元の画像も戻せない。
  // それを名指しし、控え（.bak）を作るなら、元の画像がそこに残ることも伝える。［焼き込んで上書き保存］は危険の色で、**既定のフォーカスは
  // ［キャンセル］**に置く（confirm-mosaic.js と同じ）。意匠と逃げ道（jsdom に showModal が無い）も confirm-mosaic.js と揃える。

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

  // 文面（確定事項B6）。name は画像のファイル名、backup は控えを作るか。
  function textsOf({ name, backup }) {
    return [
      `書き込みを「${name}」の画像に焼き込んで、上書き保存します。`,
      '保存したあとは、書き込みを動かしたり直したりできません。書き込みの下にあった元の画像も元に戻せません。',
      backup ? `元の画像は、控えのファイル（${name}.bak）に残します。` : '',
    ];
  }

  // 上書きしてよければ true。組み立てられない環境では、失うものを伝えないまま焼き込むより「進めない」ほうを採る。
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
    if (win.__sigkConfirmImageSaveReady === true)
      return false;
    const dialog = doc.getElementById('confirm-image-save');
    if (dialog === null)
      return false;
    win.__sigkConfirmImageSaveReady = true;

    el = {
      dialog,
      text: doc.getElementById('confirm-image-save-text'),
      loss: doc.getElementById('confirm-image-save-loss'),
      backup: doc.getElementById('confirm-image-save-backup'),
      ok: doc.getElementById('confirm-image-save-ok'),
      cancel: doc.getElementById('confirm-image-save-cancel'),
    };
    el.ok.addEventListener('click', () => finish(true));
    el.cancel.addEventListener('click', () => finish(false));
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmImageSave = { init, ask, isOpen, textsOf };
})(typeof window !== 'undefined' ? window : globalThis);
