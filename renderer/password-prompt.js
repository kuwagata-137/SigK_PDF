(function (root) {
  'use strict';

  // パスワード付き PDF を開くときの入力（spec-1-6 確定事項66〜69）。
  //
  // pdf.js は `loadingTask.onPassword` を呼んで聞いてくる。間違えると同じ口が
  // `code = 2`（INCORRECT_PASSWORD）でもう一度呼ばれるので、**何度でも聞き直せる**。
  // 回数制限は設けない（確定事項67）。
  //
  // **覚えない**（確定事項69）。`settings.json` にも `sessionStorage` にも残さず、
  // 閉じたら忘れる。入力欄も閉じるたびに空へ戻す。
  //
  // 意匠と逃げ道（jsdom に showModal が無い）は confirm-overwrite.js と揃える。

  // pdf.js の PasswordResponses。1 = NEED_PASSWORD、2 = INCORRECT_PASSWORD。
  const INCORRECT_PASSWORD = 2;

  let el = null;
  let pending = null;

  function finish(value) {
    if (pending === null)
      return false;
    const waiting = pending;
    pending = null;
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    // 入力欄に残さない。次に開くときへ持ち越さないためである。
    el.input.value = '';
    waiting.resolve(value);
    return true;
  }

  function isOpen() {
    return el !== null && pending !== null;
  }

  function submit() {
    const value = el.input.value;
    // 空のまま押されたら聞き直す。空文字を渡すと pdf.js が「違う」と言って
    // 戻ってくるだけで、同じことを2往復する。
    if (value === '')
      return false;
    return finish(value);
  }

  // パスワードを返す。取りやめは null。組み立てられない環境では聞けないので、
  // null を返して開くのをやめる（無言で開かないより、開けないほうが分かる）。
  function ask({ name = null, retry = false } = {}) {
    if (el === null)
      return Promise.resolve(null);
    if (pending !== null)
      return pending.promise;

    el.text.textContent = name === null || name === undefined
      ? 'この PDF はパスワードで保護されています。'
      : `${name} はパスワードで保護されています。`;
    // 2回目からは違っていたことを添える（確定事項67）。
    el.error.hidden = !retry;
    el.input.value = '';

    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.input.focus?.();
    return pending.promise;
  }

  function init(doc, win) {
    if (win.__sigkPasswordPromptReady === true)
      return false;

    const dialog = doc.getElementById('password-prompt');
    if (dialog === null)
      return false;
    win.__sigkPasswordPromptReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('password-prompt-text'),
      error: doc.getElementById('password-prompt-error'),
      input: doc.getElementById('password-prompt-input'),
      ok: doc.getElementById('password-prompt-ok'),
      cancel: doc.getElementById('password-prompt-cancel'),
    };

    el.ok?.addEventListener('click', () => submit());
    el.cancel?.addEventListener('click', () => finish(null));
    // Enter で送る。1つしかない入力欄で、いちいちボタンへ移らせない。
    el.input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    dialog.addEventListener('close', () => finish(null));
    dialog.addEventListener('cancel', () => finish(null));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.passwordPrompt = { INCORRECT_PASSWORD, init, ask, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
