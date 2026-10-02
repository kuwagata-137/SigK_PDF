(function (root) {
  'use strict';

  // 紙の上の入力欄の要素（spec-4-2 確定事項3・9・10）。free-text-editor.js から、要素を作る・置く・大きさを合わせる部分を
  // 移した（spec-4b-4a。中身は変えていない）。下書きの寿命と確定は free-text-editor.js が持つ。

  // 入力欄の枠線（CSS px）。箱の外側に出し、文字の位置を確定後の SVG と揃える。
  const BORDER = 1.5;

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function shape() {
    return root.SigK.freeTextShape;
  }

  // <textarea class="free-text-editor">。IME を素で扱える。折り返しは無い（確定事項3）。
  function create(doc, text, { onInput, onKeyDown }) {
    const node = doc.createElement('textarea');
    node.className = 'free-text-editor';
    node.setAttribute('aria-label', 'テキストの書き込み');
    node.spellcheck = false;
    node.wrap = 'off';
    node.rows = 1;
    node.value = text;
    node.addEventListener('input', onInput);
    node.addEventListener('keydown', onKeyDown);
    return node;
  }

  // 位置・大きさ・向き。表示の左上（origin）へ枠線ぶんだけ外側に置き、画面での角度で回す。
  function place(node, draft, viewport) {
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

  // 文字に合わせて広げる（確定事項3）。幅は最長行、高さは行数×行送り。字面が行箱より大きいぶん（Noto の hhea。
  // 事前調査 D）は scrollHeight で補う。
  function autosize(node, draft, viewport) {
    const scale = viewport.scale ?? 1;
    const lines = geometry().linesOf(node.value);
    const size = geometry().boxOfLines(lines, draft.fontSize, (line) => shape().measure(node.ownerDocument, line, draft.fontSize));
    const padding = geometry().PADDING * 2;
    node.style.width = `${(size.width - padding) * scale}px`;
    node.style.height = `${(size.height - padding) * scale}px`;
    const overflow = node.scrollHeight - node.clientHeight;
    if (overflow > 0)
      node.style.height = `${(size.height - padding) * scale + overflow}px`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextEditorNode = { BORDER, create, place, autosize };
})(typeof window !== 'undefined' ? window : globalThis);
