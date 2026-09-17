(function (root) {
  'use strict';

  // 右のプロパティ（spec-4-1 確定事項4・33、spec-4-2 確定事項2、spec-4-3 確定事項2・7）。注釈モードの間は常に出す。
  //
  // 出し入れは CSS（html[data-mode="annot"] のときだけ表示）が持ち、ここは中身を
  // 実態に合わせるだけである。選んでいる注釈があればその注釈、無ければ「次に付ける
  // 注釈」（持っている道具）の種類と色を見せる。色の丸を押すと annotate.setColor、
  // 「文字の大きさ」は annotate.setFontSize、「線の太さ」は annotate.setLineWidth、
  // 「図形の種類」は annotate.setShapeKind、「この注釈を削除」は annotate.remove へ流す。

  const HINTS = Object.freeze({
    selected: 'Delete で消せます。Esc で選択を解除します。Ctrl+Z で元に戻せます。',
    tool: '文字をなぞると付きます。先に文字を選んでから道具を押しても付きます。',
    none: 'レールの道具を選ぶか、文字を選んでから道具を押してください。',
    text: '紙の上を押すと、そこに文字を置けます。Enter で改行、枠の外を押すか Ctrl+Enter で確定します。',
    textSelected: 'ダブルクリックか Enter で直せます。掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
    shape: '紙の上をドラッグすると描けます。Shift を押しながらで正方形・正円・45° 刻みになります。Esc で道具を離します。',
    pen: '紙の上をなぞると線が引けます。1 回のなぞりが 1 つの注釈になります。Esc で道具を離します。',
    shapeSelected: '掴んで動かせます。Delete で消せます。Ctrl+Z で元に戻せます。',
  });

  // 「本文」の行に出す文字数の上限。
  const TEXT_PREVIEW = 200;

  // 「図形の種類」のボタンのアイコン（assets/icons.js）。
  const SHAPE_ICONS = Object.freeze({ square: 'shapeSquare', circle: 'shapeCircle', line: 'shapeLine', arrow: 'shapeArrow' });

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  function isDrawnKind(kind) {
    return root.SigK.annotationEntry?.isDrawnKind(kind) === true;
  }

  // 元ページ番号 src を、いま画面に出ている位置（1 始まり）にする。
  function displayNumberOf(src) {
    const plan = viewer()?.getPlan() ?? [];
    const index = plan.findIndex((page) => page.src === src);
    return index < 0 ? null : index + 1;
  }

  function renderSwatches(kind, current) {
    const doc = el.doc;
    const colors = annotate().COLORS[presets().paletteOf(kind)] ?? [];
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

  // 「文字の大きさ」の行。テキストの道具を持っているか、テキストを選んでいるときだけ出す。
  function setSizeRow(size) {
    el.sizeRow.hidden = size === null;
    if (size !== null)
      el.size.value = String(size);
  }

  // 「線の太さ」の行。図形・ペンの道具か図形系の注釈を選んでいるときだけ出す。読み込んだ注釈の
  // プリセットに無い太さは、その値の選択肢を末尾に足して見せる（選び直せば消える）。
  function setWidthRow(width) {
    el.widthRow.hidden = width === null;
    for (const extra of el.width.querySelectorAll('option[data-extra]'))
      extra.remove();
    if (width === null)
      return;
    if (!presets().isLineWidth(width)) {
      const option = el.doc.createElement('option');
      option.value = String(width);
      option.textContent = `${width} pt`;
      option.dataset.extra = 'true';
      el.width.append(option);
    }
    el.width.value = String(width);
  }

  // 「図形の種類」の行。図形の道具を持ち、何も選んでいないときだけ出す。
  function setShapeRow(kind) {
    el.shapeRow.hidden = kind === null;
    for (const button of el.shapeKinds.querySelectorAll('button'))
      button.classList.toggle('on', button.dataset.kind === kind);
  }

  function previewOf(text) {
    const flat = text.replace(/\s*\n\s*/g, ' ');
    return flat.length > TEXT_PREVIEW ? `${flat.slice(0, TEXT_PREVIEW)}…` : flat;
  }

  function hintForSelected(entry) {
    if (entry.kind === 'text')
      return HINTS.textSelected;
    return isDrawnKind(entry.kind) ? HINTS.shapeSelected : HINTS.selected;
  }

  function refreshSelected(entry) {
    const isText = entry.kind === 'text';
    el.kind.textContent = annotate().TOOL_LABELS[entry.kind];
    renderSwatches(entry.kind, entry.color);
    setSizeRow(isText ? entry.fontSize : null);
    setWidthRow(isDrawnKind(entry.kind) ? entry.lineWidth : null);
    setShapeRow(null);
    setRow(el.pageRow, displayNumberOf(entry.src), el.page);
    el.textLabel.textContent = isText ? '本文' : '対象の文字';
    setRow(el.textRow, entry.text ? `「${previewOf(entry.text)}」` : null, el.text);
    el.hint.textContent = hintForSelected(entry);
    setDeleteEnabled(true);
  }

  function setDeleteEnabled(enabled) {
    if (enabled)
      el.remove.removeAttribute('aria-disabled');
    else
      el.remove.setAttribute('aria-disabled', 'true');
  }

  function hintFor(tool) {
    if (tool === null)
      return HINTS.none;
    return HINTS[tool] ?? HINTS.tool;
  }

  function refresh() {
    if (el === null)
      return false;
    const entry = annotate().selectedEntry();
    if (entry !== null) {
      refreshSelected(entry);
      return true;
    }
    const tool = annotate().getTool();
    el.kind.textContent = tool === null ? '–' : `${annotate().TOOL_LABELS[tool]}（次に付ける）`;
    if (tool === null)
      el.colors.replaceChildren();
    else
      renderSwatches(tool, annotate().colorOf(tool));
    setSizeRow(tool === 'text' ? annotate().getFontSize() : null);
    setWidthRow(tool === 'shape' || tool === 'pen' ? annotate().getLineWidth() : null);
    setShapeRow(tool === 'shape' ? annotate().getShapeKind() : null);
    setRow(el.pageRow, null, el.page);
    setRow(el.textRow, null, el.text);
    el.hint.textContent = hintFor(tool);
    setDeleteEnabled(false);
    return true;
  }

  // 選択肢はプリセットから 1 度だけ組む（spec-4-2 確定事項34、spec-4-3 確定事項29）。
  function fillSelect(doc, select, values, onChange) {
    select.replaceChildren(...values.map((value) => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = `${value} pt`;
      return option;
    }));
    select.addEventListener('change', () => onChange(Number(select.value)));
  }

  // 「図形の種類」の 4 つのボタン（spec-4-3 確定事項2）。
  function fillShapeKinds(doc, container) {
    container.replaceChildren(...presets().SHAPE_KINDS.map((kind) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.kind = kind;
      button.title = presets().TOOL_LABELS[kind];
      button.setAttribute('aria-label', button.title);
      if (root.SigK.icons?.has(SHAPE_ICONS[kind]))
        button.append(root.SigK.icons.create(doc, SHAPE_ICONS[kind], { size: 20, strokeWidth: 1.75 }));
      button.addEventListener('click', () => annotate().setShapeKind(kind));
      return button;
    }));
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
      textLabel: doc.getElementById('props-text-label'),
      text: doc.getElementById('props-text'),
      sizeRow: doc.getElementById('props-size-row'),
      size: doc.getElementById('props-size'),
      widthRow: doc.getElementById('props-width-row'),
      width: doc.getElementById('props-width'),
      shapeRow: doc.getElementById('props-shape-row'),
      shapeKinds: doc.getElementById('props-shape-kinds'),
      hint: doc.getElementById('props-hint'),
      remove: doc.getElementById('props-delete'),
    };
    fillSelect(doc, el.size, presets().FONT_SIZES, (size) => annotate().setFontSize(size));
    fillSelect(doc, el.width, presets().LINE_WIDTHS, (width) => annotate().setLineWidth(width));
    fillShapeKinds(doc, el.shapeKinds);
    el.remove.addEventListener('click', () => {
      if (el.remove.getAttribute('aria-disabled') !== 'true')
        annotate().remove();
    });
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationProps = { HINTS, TEXT_PREVIEW, init, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
