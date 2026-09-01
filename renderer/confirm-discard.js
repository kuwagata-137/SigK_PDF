(function (root) {
  'use strict';

  // 未保存の編集を捨てる前の確認（spec-1-5 I。決定3）。
  //
  // dirty になる経路は塊④ で初めて生まれる。ここを空けたままにすると、
  // 編集したタブを閉じたときに確認も出ずに編集が消える。
  //
  // 塊④ の時点では保存の手段がまだ無いので**2択**である（確定事項57・58）。
  // docs/04 第7章が定める「保存／保存しない／キャンセル」の3択は、
  // 保存の行き先ができる塊⑤ で完成させる。
  //
  // ネイティブの messageBox ではなくアプリ内の <dialog> にしてあるのは、
  // 文書情報・印刷と同じ意匠に揃えるためである（確定事項57）。

  let el = null;
  // 開いている間の答え待ち。二重に開かないよう1つだけ持つ。
  let pending = null;

  function finish(ok) {
    if (pending === null)
      return false;
    const waiting = pending;
    pending = null;
    closeDialog();
    waiting.resolve(ok);
    return true;
  }

  function openDialog() {
    // jsdom には showModal が無い。open 属性で代用する（doc-info.js と同じ）。
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
  }

  function closeDialog() {
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
  }

  function isOpen() {
    return el !== null && pending !== null;
  }

  // 1回だけ聞く。閉じてよければ true。
  //
  // ダイアログを組み立てられない環境（要素が無い）では、確認できないまま
  // 編集を捨てるより「閉じない」ほうが安全なので false を返す。
  function ask({ name = null } = {}) {
    if (el === null)
      return Promise.resolve(false);
    // すでに聞いている最中なら、その答えに相乗りする。
    if (pending !== null)
      return pending.promise;

    el.text.textContent = name === null || name === undefined
      ? '編集内容は保存されていません。閉じると失われます。'
      : `${name} の編集内容は保存されていません。閉じると失われます。`;

    pending = Promise.withResolvers();
    openDialog();
    // 既定のフォーカスは安全側（キャンセル）に置く（docs/04 第7章）。
    el.cancel.focus?.();
    return pending.promise;
  }

  // アプリを終了するとき。未保存のタブを1枚ずつ聞き、1つでも取りやめたら
  // 終了そのものを中止する（確定事項56）。
  //
  // 聞く前にそのタブへ切り替えるのは、何について聞かれているのかを
  // 画面でも分かるようにするためである。
  async function askAll() {
    const tabs = root.SigK.tabs;
    if (tabs === undefined)
      return true;

    for (const info of tabs.list()) {
      if (!tabs.isDirty(info.id))
        continue;
      tabs.activate(info.id);
      if (!(await ask({ name: info.name })))
        return false;
    }
    return true;
  }

  function init(doc, win) {
    if (win.__sigkConfirmDiscardReady === true)
      return false;

    const dialog = doc.getElementById('confirm-discard');
    if (dialog === null)
      return false;
    win.__sigkConfirmDiscardReady = true;

    el = {
      doc,
      dialog,
      text: doc.getElementById('confirm-discard-text'),
      ok: doc.getElementById('confirm-discard-ok'),
      cancel: doc.getElementById('confirm-discard-cancel'),
    };

    el.ok?.addEventListener('click', () => finish(true));
    el.cancel?.addEventListener('click', () => finish(false));
    // Esc で閉じたときも「キャンセル」と同じ扱いにする。黙って編集が
    // 消えるより、閉じないほうが安全である。
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('cancel', () => finish(false));

    // 終了しようとしていることがメインから届く（決定1 の IPC）。
    root.appCloseAPI?.onCloseRequest?.(async () => {
      const ok = await askAll();
      root.appCloseAPI.confirm(ok);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmDiscard = { init, ask, askAll, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
