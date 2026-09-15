(function (root) {
  'use strict';

  // 右のプロパティ（spec-4-1 確定事項4・33）。注釈モードの間は常に出す。
  //
  // 出し入れは CSS（html[data-mode="annot"] のときだけ表示）が持ち、ここは中身を
  // 実態に合わせるだけである。選んでいる注釈があればその注釈、無ければ「次に付ける
  // 注釈」（持っている道具）の種類と色を見せる。色の丸を押すと annotate.setColor、
  // 「この注釈を削除」は annotate.remove へ流す。

  const HINTS = Object.freeze({
    selected: 'Delete で消せます。Esc で選択を解除します。Ctrl+Z で元に戻せます。',
    tool: '文字をなぞると付きます。先に文字を選んでから道具を押しても付きます。',
    none: 'レールの道具を選ぶか、文字を選んでから道具を押してください。',
  });

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  // 元ページ番号 src を、いま画面に出ている位置（1 始まり）にする。
  function displayNumberOf(src) {
    const plan = viewer()?.getPlan() ?? [];
    const index = plan.findIndex((page) => page.src === src);
    return index < 0 ? null : index + 1;
  }

  function renderSwatches(kind, current) {
    const doc = el.doc;
    const colors = annotate().COLORS[kind] ?? [];
    el.colors.replaceChildren(...colors.map((color) => {
      const swatch = doc.createElement('button');
      swatch.type = 'button';
      swatch.className = `swatch${color === current ? ' on' : ''}`;
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.title = annotate().COLOR_NAMES[color] ?? color;
      swatch.setAttribute('aria-label', swatch.title);
      swatch.addEventListener('click', () => annotate().setColor(color));
      return swatch;
    }));
  }

  function setRow(row, value, node) {
    row.hidden = value === null;
    node.textContent = value ?? '';
  }

  function setDeleteEnabled(enabled) {
    if (enabled)
      el.remove.removeAttribute('aria-disabled');
    else
      el.remove.setAttribute('aria-disabled', 'true');
  }

  function refresh() {
    if (el === null)
      return false;
    const entry = annotate().selectedEntry();
    if (entry !== null) {
      el.kind.textContent = annotate().TOOL_LABELS[entry.kind];
      renderSwatches(entry.kind, entry.color);
      setRow(el.pageRow, displayNumberOf(entry.src), el.page);
      setRow(el.textRow, entry.text ? `「${entry.text}」` : null, el.text);
      el.hint.textContent = HINTS.selected;
      setDeleteEnabled(true);
      return true;
    }
    const tool = annotate().getTool();
    el.kind.textContent = tool === null ? '–' : `${annotate().TOOL_LABELS[tool]}（次に付ける）`;
    if (tool === null)
      el.colors.replaceChildren();
    else
      renderSwatches(tool, annotate().colorOf(tool));
    setRow(el.pageRow, null, el.page);
    setRow(el.textRow, null, el.text);
    el.hint.textContent = tool === null ? HINTS.none : HINTS.tool;
    setDeleteEnabled(false);
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAnnotationPropsReady === true)
      return false;
    const panel = doc.getElementById('props');
    if (panel === null)
      return false;
    win.__sigkAnnotationPropsReady = true;
    el = {
      doc,
      panel,
      kind: doc.getElementById('props-kind'),
      colors: doc.getElementById('props-colors'),
      pageRow: doc.getElementById('props-page-row'),
      page: doc.getElementById('props-page'),
      textRow: doc.getElementById('props-text-row'),
      text: doc.getElementById('props-text'),
      hint: doc.getElementById('props-hint'),
      remove: doc.getElementById('props-delete'),
    };
    el.remove.addEventListener('click', () => {
      if (el.remove.getAttribute('aria-disabled') !== 'true')
        annotate().remove();
    });
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationProps = { HINTS, init, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
