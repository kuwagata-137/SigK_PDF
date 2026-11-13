(function (root) {
  'use strict';

  // 空のタブの画面と、空のタブでの Ctrl+V（spec-7-8 確定事項NT2・NT3・NT6〜NT8。見本 screenshots/question-nt1-new-tab-modes.png・
  // question-nt2-new-tab-recent.png）。空のタブそのもの（開く・切り替える・ファイルのタブに置き換える）は tabs.js が持ち、ここは空のタブを
  // 映している間の画面と操作を担当する。
  //
  //   sync()            … 空のタブを映している間だけ、ページの表示域の中央に［ファイルを開く］と案内文（#newtab）を表示し、「文書が開かれて
  //                       いません」（#view-message）を隠す（NT2）。tabs.js の render から呼ぶ。下の「最近使ったファイル」の一覧は recent-panel.js
  //                       が表示する。ツールモードでは、ツールの画面（#tools-view）が上に重なり、CSS も #newtab を隠す（NT1）
  //   ［ファイルを開く］ … ツールバーの［開く］と同じダイアログを開く（NT3。tabs.runOpenCommand）
  //   Ctrl+V            … クリップボードの画像を、空のタブの位置に「新しい画像 N」のタブで開く（NT6〜NT8）。キーは viewer-keys.js の handleKey
  //                       から受ける（確認画面が開いている間はどのキーも下の画面へ届けない決まりを、ほかのキーと同じ 1 か所で守るため）
  //
  // 画像は、メインが PDF に組み立てて返す（clipboardAPI.readImage。clipboard-image.js）。名前の無い画像（path が null・untitled）として開き、
  // 開いた直後から保存していない扱いにする（NT8。名前の無い帯と同じ。viewer.js の isDirty）。

  // 通知バーに表示する文言。画像が無いとき（NT7）・クリップボードの画像を開けなかったとき・貼り付ける機能が無いとき。
  const NO_IMAGE = 'クリップボードに画像がありません。';
  const FAILED = 'クリップボードの画像を開けませんでした。';
  const UNAVAILABLE = 'クリップボードの画像を貼り付ける機能を使用できません。';

  // pasting は、クリップボードを読み込んでから開き終えるまでの間（続けて押した Ctrl+V で 2 枚にしない）。
  // number は「新しい画像 N」の N（アプリを起動してから貼り付けた順。閉じても番号を戻さない。page-transfer.js の「新しい PDF N」と同じ）。
  const state = { pasting: false, number: 0 };
  let el = null;

  const tabs = () => root.SigK.tabs;
  const banner = () => root.SigK.viewBanner;

  function isShown() {
    return tabs()?.isBlankActive() === true;
  }

  function sync() {
    if (el === null)
      return false;
    const shown = isShown();
    el.panel.hidden = !shown;
    el.message.hidden = shown;
    return shown;
  }

  function isPasteKey(event) {
    return event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && String(event.key ?? '').toLowerCase() === 'v';
  }

  // Ctrl+V を受ける（NT6）。空のタブを映していて、ツールモードでないときだけ。文字を入力する欄（input・textarea・編集中のテキスト）に
  // フォーカスがあるときは、欄への貼り付けのまま。扱ったら true。空のタブには文書が無いので、ページの貼り付けの Ctrl+V（page-list-keys.js）
  // とは重ならない。
  function handleKey(event, doc) {
    if (!isPasteKey(event) || !isShown() || doc.documentElement.getAttribute('data-mode') === 'tools')
      return false;
    if (root.SigK.viewerKeys?.isTypingField(event.target) === true)
      return false;
    event.preventDefault();
    paste();
    return true;
  }

  // クリップボードの画像を開く。画像が無ければ通知バー（黄色）に表示し、ほかには何もしない（NT7）。読み込んでいる間に空のタブから
  // 離れていたら、今までどおりタブバーの右端に開く（押した人の依頼なので、捨てない）。
  async function paste() {
    const api = root.clipboardAPI;
    if (!api || api.available !== true) {
      banner().show(UNAVAILABLE);
      return false;
    }
    if (state.pasting)
      return false;
    state.pasting = true;
    try {
      const result = await api.readImage();
      if (result?.empty === true) {
        banner().show(NO_IMAGE, { tone: 'warn' });
        return false;
      }
      if (result?.ok !== true) {
        banner().show(result?.error ?? FAILED);
        return false;
      }
      state.number += 1;
      return await tabs().openSource({ ...result, path: null, name: `新しい画像 ${state.number}`, untitled: true, folder: null });
    } catch (error) {
      root.SigK.log?.warn('newTab', 'クリップボードの画像を開けませんでした', error);
      banner().show(FAILED);
      return false;
    } finally {
      state.pasting = false;
    }
  }

  function init(doc, win) {
    if (win.__sigkNewTabReady === true)
      return false;
    const panel = doc.getElementById('newtab');
    const open = doc.getElementById('newtab-open');
    const message = doc.getElementById('view-message');
    if (panel === null || open === null || message === null)
      return false;
    win.__sigkNewTabReady = true;
    el = { doc, panel, message };
    open.addEventListener('click', () => tabs().runOpenCommand());
    sync();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.newTab = { NO_IMAGE, init, sync, handleKey, paste, isShown };
})(typeof window !== 'undefined' ? window : globalThis);
