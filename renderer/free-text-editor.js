(function (root) {
  'use strict';

  // 紙の上の文字入力（spec-4-2 確定事項3〜5・8〜10）。
  //
  // .pdf-page に <textarea class="free-text-editor"> を絶対配置する（IME を素で扱える）。
  // 下書き { key, entry, src, index, origin, text, fontSize, color, rotation } は **DOM ではなく
  // ここの状態が真**で、textarea は写しである。スクロールや倍率の変更で .pdf-page の枠が
  // 捨てられても（page-render.releasePage）下書きは残り、枠が戻ったら再マウントする
  // （フォーカスは戻さない）。確定（枠の外を押す・Esc・Ctrl+Enter）は annotate-text.js の
  // commitDraft へ渡す。IME の変換中の Enter／Esc は入力欄に任せる。

  const state = {
    doc: null,
    win: null,
    draft: null,
    node: null,
    mountedIndex: null,
    // 描いてあるページの枠と viewport（page-render.js のフックが届ける）。
    pages: new Map(),
    // 枠の外を押して確定した押し離しは、そのまま次の操作に使わない（annotate-pointer.js が見る）。
    swallow: false,
  };

  // 入力欄の要素（作る・置く・大きさを合わせる）。spec-4b-4a で free-text-editor-node.js へ移した。
  function editorNode() {
    return root.SigK.freeTextEditorNode;
  }

  function isEditing() {
    return state.draft !== null;
  }

  function editingKey() {
    return state.draft?.key ?? null;
  }

  function getDraft() {
    return state.draft === null ? null : { ...state.draft, origin: [...state.draft.origin] };
  }

  function pageOf(index) {
    return state.pages.get(index) ?? null;
  }

  // ---- 入力欄 ----

  function onInput() {
    if (state.draft === null || state.node === null)
      return;
    state.draft.text = state.node.value;
    autosize();
    // 吹き出しは打つたびに本体の大きさが変わるので、注釈の層を描き直す（spec-4b-4b 確定事項D3）。
    if (state.draft.callout !== undefined)
      root.SigK.viewer?.redrawAnnotations();
  }

  function onKeyDown(event) {
    // 変換中の Enter／Esc は IME のもの。
    if (event.isComposing || event.keyCode === 229)
      return;
    if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  }

  function autosize() {
    const page = state.pages.get(state.mountedIndex);
    if (page === undefined || state.node === null)
      return;
    editorNode().autosize(state.node, state.draft, page.viewport);
  }

  function mount({ focus }) {
    const page = state.pages.get(state.draft.index);
    if (page === undefined)
      return false;
    const node = editorNode().create(state.doc, state.draft.text, { onInput, onKeyDown });
    page.node.append(node);
    state.node = node;
    state.mountedIndex = state.draft.index;
    editorNode().place(node, state.draft, page.viewport);
    autosize();
    if (focus) {
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    }
    return true;
  }

  function unmount() {
    if (state.node !== null && state.draft !== null)
      state.draft.text = state.node.value;
    state.node?.remove();
    state.node = null;
    state.mountedIndex = null;
  }

  // ---- 下書きの寿命 ----

  // 入力を始める。開いている下書きがあれば先に確定する。
  function begin(draft, { focus = true } = {}) {
    if (state.draft !== null)
      finish();
    state.draft = { ...draft, origin: [...draft.origin] };
    mount({ focus });
    root.SigK.viewer?.redrawAnnotations();
    return true;
  }

  // 確定して閉じる。下書きは annotate-text.js が注釈にする（空なら作らない）。
  function finish() {
    if (state.draft === null)
      return null;
    unmount();
    const draft = state.draft;
    state.draft = null;
    root.SigK.annotateText?.commitDraft(draft);
    return draft;
  }

  // 捨てて閉じる（文書を閉じたときなど）。
  function cancel() {
    if (state.draft === null)
      return false;
    unmount();
    state.draft = null;
    root.SigK.viewer?.redrawAnnotations();
    return true;
  }

  // ---- ページの枠の生死（page-render.js のフック） ----

  function onPageRendered(index, node, viewport) {
    state.pages.set(index, { node, viewport });
    if (state.draft !== null && state.draft.index === index && state.node === null)
      mount({ focus: false });
  }

  function onPageReleased(index) {
    state.pages.delete(index);
    if (state.mountedIndex === index)
      unmount();
  }

  // ---- 枠の外を押したら確定（確定事項4） ----

  function onDocumentMouseDown(event) {
    if (state.draft === null)
      return;
    if (state.node !== null && state.node.contains(event.target))
      return;
    finish();
    state.swallow = true;
  }

  function takeSwallow() {
    const swallow = state.swallow;
    state.swallow = false;
    return swallow;
  }

  function init(doc, win) {
    if (win.__sigkFreeTextEditorReady === true)
      return false;
    win.__sigkFreeTextEditorReady = true;
    state.doc = doc;
    state.win = win;
    doc.addEventListener('mousedown', onDocumentMouseDown, true);
    // 押し離しが終わったら、確定に使った印は消す（#view の外で押したとき用）。
    doc.addEventListener('mouseup', () => { state.swallow = false; }, true);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextEditor = {
    BORDER: root.SigK.freeTextEditorNode.BORDER,
    init,
    begin,
    finish,
    cancel,
    isEditing,
    editingKey,
    getDraft,
    pageOf,
    onPageRendered,
    onPageReleased,
    takeSwallow,
    // テストが入力欄を見る口。
    getNode: () => state.node,
  };
})(typeof window !== 'undefined' ? window : globalThis);
