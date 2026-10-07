(function (root) {
  'use strict';

  // Esc の振り分け（spec-4b-7a 確定事項A。決定68 ①）。viewer-keys.js の handleKey が、文書が開いているときの Esc をここへ渡す。
  // 窓が開いている間は handleKey が先に返すので、ここへは来ない（確定事項B1）。
  //
  // Esc 1 回で取りやめるのは 1 つだけで、手元の操作から先に止める。
  //   押して引いている途中の操作 → 浮いている小窓 → 欄（戻して抜ける）→ 検索バーの中で押したなら検索バー → 描きかけ → 検索バー →
  //   紙の上の文字の選択 → 書き込み・ページの選択 → 道具
  // 編集モードの分は annotate-cancel.js の段（cancelHeld・closeOverlays・dropDrafts・unselect・dropTool）が持つ。
  // ページ・ツールの一覧の行のドラッグは、page-grid.js・row-drag.js が先に受けて取りやめる（確定事項C1）。

  function isTextField(node) {
    const name = node?.tagName;
    return name === 'INPUT' || name === 'TEXTAREA';
  }

  function inMode(doc, mode) {
    return doc.documentElement.getAttribute('data-mode') === mode;
  }

  function cancel() {
    return root.SigK.annotateCancel;
  }

  function inFindBar(event) {
    return (event.target?.closest?.('#find-bar') ?? null) !== null;
  }

  // 欄の中の Esc は欄のもの（検索バーの入力欄は除く）。field-escape.js に登録した欄は戻す・確定して抜ける（確定事項E）。
  // 紙の上の入力欄とパレットの窓は自分で受ける。登録していない入力欄（ツールの画面の欄など）は何もしない。
  function inField(event) {
    if (inFindBar(event))
      return false;
    return (event.target?.closest?.('.free-text-editor, .props-field, .color-pop') ?? null) !== null || isTextField(event.target);
  }

  function closeFindBar() {
    const findBar = root.SigK.findBar;
    if (findBar?.isOpen() !== true)
      return false;
    findBar.close();
    return true;
  }

  // 紙の上（#view の中）の文字の選択を外す（確定事項F1。決定68 ③）。
  function clearTextSelection(doc) {
    const selection = doc.defaultView?.getSelection?.();
    if (selection === null || selection === undefined || selection.isCollapsed)
      return false;
    const view = doc.getElementById('view');
    if (view === null || !view.contains(selection.anchorNode))
      return false;
    selection.removeAllRanges();
    return true;
  }

  function clearPageSelection() {
    const grid = root.SigK.pageGrid;
    if ((grid?.getSelection().length ?? 0) === 0)
      return false;
    grid.clearSelection();
    return true;
  }

  // 先に処理された Esc（ページ・行のドラッグの取りやめ、本文の欄の確定）と、IME の変換中の Esc は何もしない
  // （確定事項C1）。page-grid.js・row-drag.js の受け口は、この振り分けより先に登録されている（app.js の init の順）。
  function isSpent(event) {
    return event.defaultPrevented || event.isComposing === true || event.keyCode === 229;
  }

  // A1 の 2〜10 を上から見て、最初に当たった 1 つを取りやめたら true。
  function run(event, doc) {
    const annot = inMode(doc, 'annot') && cancel() !== undefined;
    if (annot && (cancel().cancelHeld() || cancel().closeOverlays()))
      return true;
    if (inField(event))
      return root.SigK.fieldEscape?.leave(event.target) === true;
    if (inFindBar(event) && closeFindBar())
      return true;
    if (annot && cancel().dropDrafts())
      return true;
    if (closeFindBar() || clearTextSelection(doc))
      return true;
    if (annot)
      return cancel().unselect() || cancel().dropTool();
    return inMode(doc, 'pages') && clearPageSelection();
  }

  // 何かを取りやめたら preventDefault して true（確定事項C2）。
  function handle(event, doc) {
    if (isSpent(event))
      return false;
    const done = run(event, doc);
    if (done)
      event.preventDefault();
    return done;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.escapeOrder = { handle };
})(typeof window !== 'undefined' ? window : globalThis);
