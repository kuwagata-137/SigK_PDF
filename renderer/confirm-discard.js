(function (root) {
  'use strict';

  // 未保存の編集を捨てる前の確認（spec-1-5 I・spec-1-6 確定事項31〜36）。
  //
  // dirty になる経路は塊④ で生まれた。ここを空けたままにすると、編集したタブを
  // 閉じたときに確認も出ずに編集が消える。
  //
  // 塊④ の時点では保存の手段が無かったので**2択**だった。塊⑤ で保存の行き先が
  // できたので、docs/04 第7章が定める**3択**（保存／保存しない／キャンセル）に
  // した。ask() の戻り値も真偽値から 'save' | 'discard' | 'cancel' に変わっている。
  //
  // ネイティブの messageBox ではなくアプリ内の <dialog> にしてあるのは、
  // 文書情報・印刷と同じ意匠に揃えるためである（spec-1-5 確定事項57）。

  const CANCEL = 'cancel';
  const DISCARD = 'discard';
  const SAVE = 'save';

  let el = null;
  // 開いている間の答え待ち。二重に開かないよう1つだけ持つ。
  let pending = null;

  function finish(answer) {
    if (pending === null)
      return false;
    const waiting = pending;
    pending = null;
    closeDialog();
    waiting.resolve(answer);
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

  // 1回だけ聞く。戻り値は 'save' / 'discard' / 'cancel'。
  //
  // ダイアログを組み立てられない環境（要素が無い）では、確認できないまま
  // 編集を捨てるより「閉じない」ほうが安全なので cancel を返す。
  function ask({ name = null } = {}) {
    if (el === null)
      return Promise.resolve(CANCEL);
    // すでに聞いている最中なら、その答えに相乗りする。
    if (pending !== null)
      return pending.promise;

    el.text.textContent = name === null || name === undefined
      ? '編集内容は保存されていません。'
      : `${name} の編集内容は保存されていません。`;

    pending = Promise.withResolvers();
    openDialog();
    // 既定のフォーカスは安全側（キャンセル）に置く（docs/04 第7章・確定事項32）。
    el.cancel.focus?.();
    return pending.promise;
  }

  // 聞いたうえで、「保存」を選ばれたら保存まで済ませる。
  // 戻り値は「閉じてよいか」。**保存に失敗したら閉じない**（確定事項34）。
  // 編集を消さないためで、失敗の理由は保存の層が帯に出す。
  async function askAndSave({ name = null } = {}) {
    const answer = await ask({ name });
    if (answer === CANCEL)
      return false;
    if (answer === DISCARD)
      return true;

    const save = root.SigK.save;
    if (save === undefined)
      return false;
    const result = await save.saveActive();
    return result?.ok === true;
  }

  // アプリを終了するとき。未保存のタブを1枚ずつ聞き、1つでも取りやめたら
  // 終了そのものを中止する（spec-1-5 確定事項56）。
  //
  // 聞く前にそのタブへ切り替えるのは、何について聞かれているのかを
  // 画面でも分かるようにするためと、保存が「いま映しているタブ」を対象に
  // するためである。
  async function askAll() {
    const tabs = root.SigK.tabs;
    if (tabs === undefined)
      return true;

    for (const info of tabs.list()) {
      if (!tabs.isDirty(info.id))
        continue;
      tabs.activate(info.id);
      if (!(await askAndSave({ name: info.name })))
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
      save: doc.getElementById('confirm-discard-save'),
      discard: doc.getElementById('confirm-discard-discard'),
      cancel: doc.getElementById('confirm-discard-cancel'),
    };

    el.save?.addEventListener('click', () => finish(SAVE));
    el.discard?.addEventListener('click', () => finish(DISCARD));
    el.cancel?.addEventListener('click', () => finish(CANCEL));
    // Esc で閉じたときも「キャンセル」と同じ扱いにする。黙って編集が
    // 消えるより、閉じないほうが安全である。
    dialog.addEventListener('close', () => finish(CANCEL));
    dialog.addEventListener('cancel', () => finish(CANCEL));

    // 終了しようとしていることがメインから届く（spec-1-5 決定1 の IPC）。
    root.appCloseAPI?.onCloseRequest?.(async () => {
      const ok = await askAll();
      root.appCloseAPI.confirm(ok);
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.confirmDiscard = { CANCEL, DISCARD, SAVE, init, ask, askAndSave, askAll, isOpen };
})(typeof window !== 'undefined' ? window : globalThis);
