(function (root) {
  'use strict';

  // 紙の上の入力欄の要素（spec-4-2 確定事項3・9・10、spec-4b-4a 確定事項E）。free-text-editor.js から、要素を作る・置く・大きさを
  // 合わせる部分を移した。下書きの寿命と確定は free-text-editor.js が持つ。
  //
  // 今までの形は折り返さず、文字に合わせて広がる。新しい形（下書きが width を持つ）は折り返し（wrap='soft' と CSS の .wrapped。
  // 事前調査 E の 7 つ）、幅は free-text-metrics.js の editorWidthOf（入る行の最長と送った行の最短の真ん中）にして、入力中と
  // 確定後で行をそろえる。余白と斜体の分は内側の余白に、太字・斜体は入力欄の文字にも当てる。

  // 入力欄の枠線（CSS px）。箱の外側に出し、文字の位置を確定後の SVG と揃える。
  const BORDER = 1.5;

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function layout() {
    return root.SigK.freeTextLayout;
  }

  function metrics() {
    return root.SigK.freeTextMetrics;
  }

  // <textarea class="free-text-editor">。IME を素で扱える。折り返すかは place が下書きに合わせて決める。
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

  // 内側の余白（上・右・下・左。CSS px）。四方が同じなら 1 つで書く。
  function paddingOf(inset, scale) {
    const sides = [inset.top, inset.horizontal - inset.left, inset.vertical - inset.top, inset.left].map((value) => `${value * scale}px`);
    return sides.every((side) => side === sides[0]) ? sides[0] : sides.join(' ');
  }

  // 位置・大きさ・向き。表示の左上（origin）へ枠線ぶんだけ外側に置き、画面での角度で回す。
  function place(node, draft, viewport) {
    const scale = viewport.scale ?? 1;
    const [x, y] = viewport.convertToViewportPoint(draft.origin[0], draft.origin[1]);
    const angle = geometry().screenAngle(viewport.rotation ?? 0, draft.rotation);
    const wrapped = draft.width !== undefined;
    node.wrap = wrapped ? 'soft' : 'off';
    node.classList.toggle('wrapped', wrapped);
    node.style.left = `${x - BORDER}px`;
    node.style.top = `${y - BORDER}px`;
    node.style.fontSize = `${draft.fontSize * scale}px`;
    node.style.fontWeight = draft.bold === true ? '700' : '';
    node.style.fontStyle = draft.italic === true ? 'italic' : '';
    node.style.lineHeight = String(geometry().LINE_HEIGHT);
    node.style.padding = paddingOf(layout().insetOf(draft), scale);
    node.style.borderWidth = `${BORDER}px`;
    node.style.color = draft.color;
    node.style.transformOrigin = `${BORDER}px ${BORDER}px`;
    node.style.transform = angle === 0 ? '' : `rotate(${angle}deg)`;
  }

  // 文字に合わせて大きさを決める（確定事項E1・E3）。幅は editorWidthOf、高さは行数×行送り。字面が行箱より大きいぶん（Noto の hhea。
  // spec-4-2 事前調査 D）は scrollHeight で補う。
  function autosize(node, draft, viewport) {
    const scale = viewport.scale ?? 1;
    const entry = { ...draft, kind: 'text', text: node.value };
    const { lines } = metrics().layoutOfEntry(entry);
    node.style.width = `${metrics().editorWidthOf(entry) * scale}px`;
    const height = Math.max(1, lines.length) * draft.fontSize * geometry().LINE_HEIGHT;
    node.style.height = `${height * scale}px`;
    const overflow = node.scrollHeight - node.clientHeight;
    if (overflow > 0)
      node.style.height = `${height * scale + overflow}px`;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextEditorNode = { BORDER, create, place, autosize };
})(typeof window !== 'undefined' ? window : globalThis);
