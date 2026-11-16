(function (root) {
  'use strict';

  // 右クリックメニューとキー（Delete・Ctrl+C/X/V）で操作するページ一覧（spec-7-5 確定事項E1・K1・T1・T2・R1・P2）。
  //
  //   ツールモード                  → 枠の帯（映しているタブ）。選択は strip-selection.js（タブごと）。元に戻すはツールモードの記録にも控える（U1）
  //   ページ編集モード・編集モード → 左パネルのサムネイル（編集モードはサムネイルを表示しているときだけ）。選択は page-grid.js（タブごと。E1）
  //
  // どちらも、操作は映しているタブ（viewer）に対して行う。ツールモードで枠でない帯を右クリックしたときは、先に枠を移す（T1。page-menu-route.js）。

  const tabs = () => root.SigK.tabs;
  const viewer = () => root.SigK.viewer;

  function modeOf(doc) {
    return doc.documentElement.getAttribute('data-mode');
  }

  // 左パネルにサムネイルを表示しているモードか。ページ編集モードと、サムネイルに切り替えている編集モード（注釈一覧ではない）。
  function thumbsShown(doc) {
    const html = doc.documentElement;
    const mode = html.getAttribute('data-mode');
    return mode === 'pages' || (mode === 'annot' && html.getAttribute('data-edit-side') !== 'list');
  }

  function strips() {
    const tabId = tabs().activeId();
    if (tabId === null)
      return null;
    return {
      kind: 'strips',
      tabId,
      selection: () => root.SigK.stripSelection.get(tabId),
      select: (indices) => root.SigK.stripSelection.set(tabId, indices, tabs().peek(tabId)?.plan ?? null),
      record: () => root.SigK.toolHistory?.record('pages', tabId) === true,
    };
  }

  function thumbs() {
    return {
      kind: 'thumbs',
      tabId: tabs()?.activeId() ?? null,
      selection: () => root.SigK.pageGrid.getSelection(),
      select: (indices) => root.SigK.pageGrid.setSelection(indices, { anchor: indices[0] ?? null }),
      record: () => false,
    };
  }

  // 今のモードのページ一覧。帯もサムネイルも無ければ null。
  function current(doc) {
    if (modeOf(doc) === 'tools')
      return strips();
    return thumbsShown(doc) ? thumbs() : null;
  }

  // ページ一覧にフォーカスがあるか（K1）。ツールモードは帯の画面（#strips）、ほかは左パネル（#side）。
  function hasFocus(doc) {
    const id = modeOf(doc) === 'tools' ? 'strips' : 'side';
    return doc.getElementById(id)?.contains(doc.activeElement) === true;
  }

  // 開いている途中・保存の途中・ツールの実行中・コピーを作っている途中（P2）。
  function isBusy() {
    return root.SigK.stripInput?.isLocked() === true || root.SigK.pageClipboard?.isBusy() === true;
  }

  // ツールモードで分割を選んでいるか（分割画面。T2）。分割画面は分割の操作だけにする。
  function isSplitScreen(doc) {
    return modeOf(doc) === 'tools' && root.SigK.toolPane?.shown() === 'split';
  }

  // ツールモードで、キーをページ一覧の操作にしない画面（T2）。分割画面と、「変換する画像」の帯に枠があるとき（画像は帯の［×］で削除する）。
  // 右クリックは、PDF の帯を右クリックすれば枠がその帯へ移るので、分割画面だけを見る（page-menu-route.js）。
  function isExcluded(doc) {
    return isSplitScreen(doc) || (modeOf(doc) === 'tools' && root.SigK.imageStrip?.hasFrame() === true);
  }

  // 開けなかった帯・文書の無いタブか（R1。ページが無い）。
  function isEmpty() {
    return viewer()?.getState().open !== true;
  }

  // パスワード付きの帯・タブか（R1。保存できないので、メニューの項目をすべて灰色にし、キーは何もしない）。
  function isLocked() {
    return viewer()?.getState().file?.encrypted === true;
  }

  // キーで操作してよいか（P2・T2・R1）。
  function isReady(doc) {
    return !isBusy() && !isExcluded(doc) && !isEmpty() && !isLocked();
  }

  function pageCount() {
    return viewer()?.getState().pageCount ?? 0;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageListTarget = {
    modeOf, thumbsShown, strips, thumbs, current, hasFocus, isBusy, isSplitScreen, isExcluded, isEmpty, isLocked, isReady, pageCount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
