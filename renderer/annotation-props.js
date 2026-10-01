(function (root) {
  'use strict';

  // 右のプロパティ（spec-4-1 確定事項4・33、spec-4-2 確定事項2、spec-4-3 確定事項2・7、spec-4-4 確定事項3〜6、
  // spec-4b-1b 確定事項1〜9）。編集モードの間は常に出す。
  //
  // 出し入れは CSS（html[data-mode="annot"] のときだけ表示）が持ち、ここは中身を実態に合わせるだけである。選んでいる書き込みが
  // あればその書き込み、無ければ「次に付ける書き込み」（持っている道具）の種類と値を見せる。色・塗り・線種・線の太さ・不透明度の
  // 行は annotation-style-rows.js、ノートの「本文」「作成者」の行は annotation-note-rows.js、四角・丸の「回転」の行は
  // annotation-angle-row.js（spec-4b-2）、ヒントの文言は annotation-hints.js が
  // 持ち、ここは種類・文字の大きさ・ページ・対象の文字・ヒント・「削除」の出し入れを受け持つ。「文字の大きさ」は
  // annotate.setFontSize、「削除」は annotate.remove へ流す。表示のみの書き込みは種類名に「（表示のみ）」を添え、見た目の行を出さない。

  // 「本文」の行に出す文字数の上限。
  const TEXT_PREVIEW = 200;

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

  function shapeStyle() {
    return root.SigK.shapeStyle;
  }

  function noteRows() {
    return root.SigK.annotationNoteRows;
  }

  function styleRows() {
    return root.SigK.annotationStyleRows;
  }

  function hints() {
    return root.SigK.annotationHints;
  }

  function isNoteKind(kind) {
    return root.SigK.annotationEntry?.isNoteKind(kind) === true;
  }

  // 元ページ番号 src を、いま画面に出ている位置（1 始まり）にする。
  function displayNumberOf(src) {
    const plan = viewer()?.getPlan() ?? [];
    const index = plan.findIndex((page) => page.src === src);
    return index < 0 ? null : index + 1;
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

  function previewOf(text) {
    const flat = text.replace(/\s*\n\s*/g, ' ');
    return flat.length > TEXT_PREVIEW ? `${flat.slice(0, TEXT_PREVIEW)}…` : flat;
  }

  // 種類の見出し。表示のみは subtype の種類名に「（表示のみ）」（spec-4-4 確定事項6）。
  function kindLabelOf(entry) {
    if (entry.readonly === true)
      return `${presets().readonlyLabelOf(entry.subtype)}（表示のみ）`;
    return annotate().TOOL_LABELS[entry.kind];
  }

  function refreshSelected(entry) {
    const isText = entry.kind === 'text';
    const isNote = isNoteKind(entry.kind);
    el.kind.textContent = kindLabelOf(entry);
    styleRows()?.render({
      kind: entry.kind,
      readonly: entry.readonly === true,
      color: entry.color ?? null,
      fill: shapeStyle().fillOf(entry),
      lineStyle: shapeStyle().lineStyleOf(entry),
      lineWidth: entry.lineWidth,
      opacity: entry.opacity ?? 1,
    });
    noteRows()?.render({ text: isNote ? entry.text : null, author: isNote ? (entry.author ?? '') : null, editable: false });
    // 回転の行は四角・丸を選んでいるときだけ（spec-4b-2 確定事項25）。
    root.SigK.annotationAngleRow?.render(entry);
    setSizeRow(isText ? entry.fontSize : null);
    setRow(el.pageRow, displayNumberOf(entry.src), el.page);
    el.textLabel.textContent = isText ? '本文' : '対象の文字';
    setRow(el.textRow, !isNote && entry.text ? `「${previewOf(entry.text)}」` : null, el.text);
    el.hint.textContent = hints().forSelected(entry);
    setDeleteEnabled(true);
  }

  function setDeleteEnabled(enabled) {
    if (enabled)
      el.remove.removeAttribute('aria-disabled');
    else
      el.remove.setAttribute('aria-disabled', 'true');
  }

  // 道具が描く種類（図形は道具の段で選んだ種類、ペンは ink、ほかは道具の名前）。
  function kindOfTool(tool) {
    return root.SigK.annotateShape?.kindOfTool(tool) ?? tool;
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
    const kind = tool === null ? null : kindOfTool(tool);
    // 図形は道具の段で選んだ種類の名前を出す（「四角（次に付ける）」。spec-4b-1a 確定事項8）。
    el.kind.textContent = tool === null ? '–' : `${annotate().TOOL_LABELS[kind]}（次に付ける）`;
    styleRows()?.render(tool === null ? null : {
      kind, ...annotate().nextStyleOf(kind), lineWidth: annotate().getLineWidth(), opacity: annotate().getOpacity(kind),
    });
    noteRows()?.render({ text: null, author: tool === 'note' ? annotate().getAuthor() : null, editable: true });
    root.SigK.annotationAngleRow?.render(null);
    setSizeRow(tool === 'text' ? annotate().getFontSize() : null);
    setRow(el.pageRow, null, el.page);
    setRow(el.textRow, null, el.text);
    el.hint.textContent = hints().forTool(tool, kind, kind === null ? null : annotate().fillOf(kind));
    setDeleteEnabled(false);
    return true;
  }

  // 「本文」欄にフォーカスを移す（置いた直後・ダブルクリック・Enter）。行は annotation-note-rows.js が持つ。
  function focusContents() {
    return noteRows()?.focusContents() === true;
  }

  // 文字の大きさの選択肢はプリセットから 1 度だけ組む（spec-4-2 確定事項34）。
  function fillSizes(doc, select) {
    select.replaceChildren(...presets().FONT_SIZES.map((value) => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = `${value} pt`;
      return option;
    }));
    select.addEventListener('change', () => annotate().setFontSize(Number(select.value)));
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
      pageRow: doc.getElementById('props-page-row'),
      page: doc.getElementById('props-page'),
      textRow: doc.getElementById('props-text-row'),
      textLabel: doc.getElementById('props-text-label'),
      text: doc.getElementById('props-text'),
      sizeRow: doc.getElementById('props-size-row'),
      size: doc.getElementById('props-size'),
      hint: doc.getElementById('props-hint'),
      remove: doc.getElementById('props-delete'),
    };
    fillSizes(doc, el.size);
    // 見た目の行とパレットの窓、本文と作成者の行。refresh より先に結ぶ。
    root.SigK.colorPopover?.init(doc, win);
    styleRows()?.init(doc, win);
    noteRows()?.init(doc, win);
    root.SigK.annotationAngleRow?.init(doc, win);
    el.remove.addEventListener('click', () => {
      if (el.remove.getAttribute('aria-disabled') !== 'true')
        annotate().remove();
    });
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  // HINTS は今までの呼び口（テストが文言を引く）。中身は annotation-hints.js。
  SigK.annotationProps = { HINTS: root.SigK.annotationHints?.HINTS, TEXT_PREVIEW, init, refresh, focusContents };
})(typeof window !== 'undefined' ? window : globalThis);
