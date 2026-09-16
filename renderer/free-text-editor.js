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

  // 入力欄の枠線（CSS px）。箱の外側に出し、文字の位置を確定後の SVG と揃える。
  const BORDER = 1.5;

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

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function shape() {
    return root.SigK.freeTextShape;
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

  // 位置・大きさ・向き。表示の左上（origin）へ枠線ぶんだけ外側に置き、画面での角度で回す。
  function place(viewport) {
    const { draft, node } = state;
    const scale = viewport.scale ?? 1;
    const [x, y] = viewport.convertToViewportPoint(draft.origin[0], draft.origin[1]);
    const angle = geometry().screenAngle(viewport.rotation ?? 0, draft.rotation);
    node.style.left = `${x - BORDER}px`;
    node.style.top = `${y - BORDER}px`;
    node.style.fontSize = `${draft.fontSize * scale}px`;
    node.style.lineHeight = String(geometry().LINE_HEIGHT);
    node.style.padding = `${geometry().PADDING * scale}px`;
    node.style.borderWidth = `${BORDER}px`;
    node.style.color = draft.color;
    node.style.transformOrigin = `${BORDER}px ${BORDER}px`;
    node.style.transform = angle === 0 ? '' : `rotate(${angle}deg)`;
  }

  // 文字に合わせて広げる（確定事項3）。幅は最長行、高さは行数×行送り。字面が行箱より
  // 大きいぶん（Noto の hhea。事前調査 D）は scrollHeight で補う。
  function autosize() {
    const page = state.pages.get(state.mountedIndex);
    if (page === undefined || state.node === null)
      return;
    const { draft, node } = state;
    const scale = page.viewport.scale ?? 1;
    const lines = geometry().linesOf(node.value);
    const size = geometry().boxOfLines(lines, draft.fontSize, (line) => shape().measure(state.doc, line, draft.fontSize));
    const padding = geometry().PADDING * 2;
    node.style.width = `${(size.width - padding) * scale}px`;
    node.style.height = `${(size.height - padding) * scale}px`;
    const overflow = node.scrollHeight - node.clientHeight;
    if (overflow > 0)
      node.style.height = `${(size.height - padding) * scale + overflow}px`;
  }

  function mount({ focus }) {
    const page = state.pages.get(state.draft.index);
    if (page === undefined)
      return false;
    const node = state.doc.createElement('textarea');
    node.className = 'free-text-editor';
    node.setAttribute('aria-label', 'テキスト注釈');
    node.spellcheck = false;
    node.wrap = 'off';
    node.rows = 1;
    node.value = state.draft.text;
    node.addEventListener('input', onInput);
    node.addEventListener('keydown', onKeyDown);
    page.node.append(node);
    state.node = node;
    state.mountedIndex = state.draft.index;
    place(page.viewport);
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
    BORDER,
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
