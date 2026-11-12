(function (root) {
  'use strict';

  // ページ一覧のキー（spec-7-5 確定事項K1・K2・M3・D1・R1・T2・P2）。viewer-keys.js の handleKey から、欄の振り分けの後・ページ編集の
  // キー（handlePageEditKey）の前に呼ぶ。
  //
  //   Delete          … 選択したページを削除する（削除確認画面を通す。D1）。左パネルでは、何も選択していなければ表示中のページ
  //                     （ページ編集の［削除］ボタンと同じ。page-actions.js の targetIndices）
  //   Ctrl+C・Ctrl+X  … 選択したページをコピー・切り取り（M4・M5）
  //   Ctrl+V          … 選択したページのうち最も前のページの前へ、何も選択していなければ末尾へ貼り付ける（M3）
  //   Backspace       … 何もしない（編集モードで、書き込みの削除にしない。K2）
  //
  // ページ一覧にフォーカスがあるときだけ受ける（ツールモードは帯をクリックした後、ほかは左パネルのサムネイルをクリックした後。K1）。
  // ページ表示にフォーカスがあるときは今までどおり（Delete・Backspace は書き込みの削除、Ctrl+C は文字のコピー。K2）。
  // 受けたキーは、操作できないとき（P2・T2・R1）も既定の動きを止めて何もしない。扱ったら true。

  const target = () => root.SigK.pageListTarget;
  const commands = () => root.SigK.pageListCommands;

  const CTRL_KEYS = Object.freeze({ c: 'copy', x: 'cut', v: 'paste' });

  // キーに当たる操作の名前。当たらなければ null。
  function commandOf(event) {
    if (event.altKey || event.metaKey)
      return null;
    if (event.ctrlKey)
      return event.shiftKey ? null : CTRL_KEYS[String(event.key ?? '').toLowerCase()] ?? null;
    if (event.shiftKey)
      return null;
    if (event.key === 'Delete')
      return 'delete';
    return event.key === 'Backspace' ? 'none' : null;
  }

  function deleteTargets(list) {
    return list.kind === 'thumbs' ? root.SigK.pageActions.targetIndices() : list.selection();
  }

  function run(command, list) {
    if (command === 'delete')
      return commands().remove(list, deleteTargets(list));
    const selection = list.selection();
    if (command === 'paste')
      return commands().paste(list, selection.length > 0 ? Math.min(...selection) : target().pageCount());
    if (selection.length === 0 || (command === 'cut' && !commands().canCut(selection)))
      return null;
    return commands()[command](list, selection);
  }

  // ページ編集モードの Delete は、ページ表示にフォーカスがあっても効かせる（spec-1-5 確定事項55 のまま。ページ編集モードの Delete には
  // ページの削除のほかの意味が無いため。spec-7-5 確定事項K1 の 2026-11-12 の直し）。
  function focusAllows(command, doc) {
    if (target().hasFocus(doc))
      return true;
    return command === 'delete' && doc.documentElement.getAttribute('data-mode') === 'pages';
  }

  function handleKey(event, doc) {
    const command = commandOf(event);
    if (command === null || !focusAllows(command, doc) || root.SigK.viewerKeys?.isTypingField(event.target) === true)
      return false;
    const list = target().current(doc);
    if (list === null)
      return false;
    event.preventDefault();
    if (command !== 'none' && target().isReady(doc))
      run(command, list);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageListKeys = { commandOf, handleKey };
})(typeof window !== 'undefined' ? window : globalThis);
