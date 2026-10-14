(function (root) {
  'use strict';

  // 保存していない帯をツールで使う前の確認（spec-2-5 確定事項F1〜F4。決定80 ⑥㉜。見本 screenshots/strips2-confirm-run.png）。
  //
  // ツールはファイルに保存してある中身を使うので、保存していない変更は結果に入らない。ボタンは肯定を左に
  // ［上書き保存してから実行］［保存せずに実行］［キャンセル］（~/.claude/CLAUDE.md の窓の並び）。最初のフォーカスは安全側の
  // ［キャンセル］で、Esc も［キャンセル］。押せないボタン（aria-disabled）は押しても何もしない。文は unsaved-changes.js が作る。

  const SAVE = 'save';
  const RUN = 'run';
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

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function fill({ entries, note }) {
    const message = root.SigK.unsavedChanges.messageFor(entries);
    el.text.textContent = message.lead;
    const items = [...message.items, ...(message.more > 0 ? [`ほか ${message.more} 個`] : [])];
    el.list.replaceChildren(...items.map((text) => {
      const item = el.doc.createElement('li');
      item.textContent = text;
      return item;
    }));
    el.list.hidden = items.length === 0;
    el.note.textContent = note ?? '';
    el.note.hidden = note === null || note === undefined || note === '';
  }

  // entries は [{ name, counts }]（counts は unsavedChanges.count）。canSave・canRun が false のボタンは押せない。
  // note は押せない理由（パスワード付きなど）。戻り値は 'save' / 'run' / 'cancel'。窓を組めない環境では取りやめる（安全側）。
  function ask({ entries, canSave = true, canRun = true, note = null }) {
    if (el === null || !Array.isArray(entries) || entries.length === 0)
      return Promise.resolve(CANCEL);
    if (pending !== null)
      return pending.promise;
    fill({ entries, note });
    setDisabled(el.save, !canSave);
    setDisabled(el.run, !canRun);
    pending = Promise.withResolvers();
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.cancel.focus?.();
    return pending.promise;
  }

  function onPress(node, answer) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        finish(answer);
    });
  }

  function init(doc, win) {
    if (win.__sigkConfirmUnsavedRunReady === true)
      return false;
    const dialog = doc.getElementById('confirm-unsaved-run');
    if (dialog === null)
      return false;
    win.__sigkConfirmUnsavedRunReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc, dialog,
      text: byId('confirm-unsaved-run-text'), list: byId('confirm-unsaved-run-list'), note: byId('confirm-unsaved-run-note'),
      save: byId('confirm-unsaved-run-save'), run: byId('confirm-unsaved-run-run'), cancel: byId('confirm-unsaved-run-cancel'),
    };
    onPress(el.save, SAVE);
    onPress(el.run, RUN);
    onPress(el.cancel, CANCEL);
    dialog.addEventListener('close', () => finish(CANCEL));
    dialog.addEventListener('cancel', () => finish(CANCEL));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmUnsavedRun = { SAVE, RUN, CANCEL, init, ask, isOpen: () => pending !== null };
})(typeof window !== 'undefined' ? window : globalThis);
