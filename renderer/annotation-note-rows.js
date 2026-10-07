(function (root) {
  'use strict';

  // 右パネルの「本文」「作成者」の行（spec-4-4 確定事項3〜5）。annotation-props.js から移した
  // （spec-4b-1a 確定事項36。中身は変えていない）。
  //
  // 行の出し入れと値は、annotation-props.js の refresh から render で受ける。「本文」はノートを選んでいるときだけ
  // 出し、欄の外を押す（blur）か Ctrl+Enter で annotate.setContents へ流す。「作成者」はノートの道具なら書き換えられ、
  // ノートを選んでいれば読み取りで、変えたら annotate.setAuthor へ流す。.props-field の中のキーは欄のもの
  // （viewer-keys.js が素通しする。Esc は escape-order.js が field-escape.js を通して受ける。spec-4b-7a 確定事項E）。

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  // 「本文」の行（ノートを選んでいるときだけ）。書いている最中は値を触らない。
  function setContentsRow(text) {
    el.contentsRow.hidden = text === null;
    if (text !== null && el.doc.activeElement !== el.contents)
      el.contents.value = text;
  }

  // 「作成者」の行。ノートの道具なら編集でき、ノートを選んでいれば読み取り。
  function setAuthorRow(author, { editable }) {
    el.authorRow.hidden = author === null;
    if (author === null)
      return;
    el.author.readOnly = !editable;
    el.authorShown = author;
    if (el.doc.activeElement !== el.author)
      el.author.value = author;
  }

  // text は本文（null なら行を隠す）、author は作成者（null なら行を隠す）、editable は作成者を書き換えられるか。
  function render({ text = null, author = null, editable = false } = {}) {
    if (el === null)
      return false;
    setContentsRow(text);
    setAuthorRow(author, { editable });
    return true;
  }

  // 「本文」欄にフォーカスを移す（置いた直後・ダブルクリック・Enter）。出ていなければ何もしない。
  function focusContents() {
    if (el === null || el.contentsRow.hidden)
      return false;
    el.contents.focus();
    return true;
  }

  // 「本文」欄。欄の外を押す（blur）か Ctrl+Enter で確定、Esc は欄を離れる（＝確定）。キーの側でも確定を
  // 呼ぶのは、窓が非活性のとき Chromium が blur() で活性要素を変えても blur イベントを流さないため（起動確認で実測）。
  // Esc は Esc の振り分けから field-escape.js を通して受ける（紙の上で引いている途中の操作を先に取りやめる。spec-4b-7a 確定事項E2・E4）。
  function bindContents(textarea) {
    const commit = () => annotate().setContents(textarea.value);
    textarea.addEventListener('blur', commit);
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        commit();
        textarea.blur();
      }
    });
    root.SigK.fieldEscape?.bind(textarea, { commit });
  }

  function init(doc, win) {
    if (win.__sigkAnnotationNoteRowsReady === true)
      return false;
    const refs = {
      contentsRow: doc.getElementById('props-contents-row'),
      contents: doc.getElementById('props-contents'),
      authorRow: doc.getElementById('props-author-row'),
      author: doc.getElementById('props-author'),
    };
    if (Object.values(refs).some((node) => node === null))
      return false;
    win.__sigkAnnotationNoteRowsReady = true;
    el = { doc, ...refs };
    bindContents(el.contents);
    el.author.addEventListener('change', () => annotate().setAuthor(el.author.value));
    // Esc は打ちかけを捨てて今の作成者に戻し、欄から抜ける（spec-4b-7a 確定事項E1）。
    root.SigK.fieldEscape?.bind(el.author, { shown: () => el.authorShown ?? '' });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationNoteRows = { init, render, focusContents };
})(typeof window !== 'undefined' ? window : globalThis);
