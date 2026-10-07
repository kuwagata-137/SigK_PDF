(function (root) {
  'use strict';

  // Esc の振り分け（spec-4b-7a 確定事項A）。viewer-keys.js の handleKey が、文書が開いているときの Esc をここへ渡す。
  //
  // 194 行になった viewer-keys.js から、Esc の枝を移した（spec-4b-7a の a0。順は変えていない）。
  //   検索バーが開いていれば閉じる（spec-1-4 確定事項25）→ 入力欄・右パネルの欄・パレットの中なら素通し（spec-4-2 確定事項8、
  //   spec-4-4 確定事項4、spec-4b-1b 確定事項6・7）→ ページ編集モードならページの選択を外す（spec-1-5 確定事項19）→
  //   編集モードなら annotate.escape()（spec-4-1 確定事項7）

  function isTextField(node) {
    const name = node?.tagName;
    return name === 'INPUT' || name === 'TEXTAREA';
  }

  function inMode(doc, mode) {
    return doc.documentElement.getAttribute('data-mode') === mode;
  }

  // 検索バーが開いていれば閉じる。検索バー自身の入力欄から押されるので、欄の素通しより前に見る。
  function closeFindBar(event) {
    const findBar = root.SigK.findBar;
    if (findBar?.isOpen() !== true)
      return false;
    event.preventDefault();
    findBar.close();
    return true;
  }

  // 欄の中の Esc は欄のもの。紙の上の入力欄と本文の欄は確定に使い、パレットの窓は自分を閉じる。
  function belongsToField(event) {
    return (event.target?.closest?.('.free-text-editor, .props-field, .color-pop') ?? null) !== null || isTextField(event.target);
  }

  // 先に処理された Esc（ページ・行のドラッグの取りやめ、本文の欄の確定）と、IME の変換中の Esc は何もしない
  // （spec-4b-7a 確定事項C1）。page-grid.js・row-drag.js の受け口は、この振り分けより先に登録されている（app.js の init の順）。
  function isSpent(event) {
    return event.defaultPrevented || event.isComposing === true || event.keyCode === 229;
  }

  // 何かを取りやめたら true。
  function handle(event, doc) {
    if (isSpent(event))
      return false;
    if (closeFindBar(event))
      return true;
    if (belongsToField(event))
      return false;
    if (inMode(doc, 'pages')) {
      root.SigK.pageGrid?.clearSelection();
      return true;
    }
    if (inMode(doc, 'annot'))
      return root.SigK.annotate?.escape() === true;
    return false;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.escapeOrder = { handle };
})(typeof window !== 'undefined' ? window : globalThis);
