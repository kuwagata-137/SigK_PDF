(function (root) {
  'use strict';

  // テキストの書式（文字の大きさ・太字・斜体・塗り・枠線・枠線の太さ）を選んでいるテキストに当てるか、次に置く値として覚える指揮
  // （spec-4-2 確定事項2・21・34、spec-4b-3a 確定事項J、spec-4b-4a 確定事項A3・G・H・K1）。当てる値は free-text-style.js が作る。
  // 2 件以上を選んでいれば、annotate-bulk.js の applyField でテキストにだけまとめて当てる。書き込みを直したときも、その値を次に付ける
  // 値にする（今までの色と同じ）。文字の大きさは annotate-tools.js、ほかは settings.json の annotTextStyle に覚える（決定47 ⑨と同じく
  // 道具ごと。起草者の判断）。欄の名前は annotation-style-patch.js と同じで、枠線の太さは lineWidth（右パネルの太さの行）。
  // 吹き出しの道具の分（文字の大きさも含む）は別に持ち、annotCalloutStyle に覚える（spec-4b-4b 確定事項F3）。どちらに覚えるかは、
  // 選んでいる書き込みが吹き出しか、何も選んでいなければ持っている道具で決める。

  // 次に置くテキスト（text）と吹き出し（callout）の書式。border は枠線の色（null は枠線なし）、borderWidth は枠線を付けるときの太さ。
  const nextStyles = { text: { bold: false, italic: false, fill: null, border: null, borderWidth: 1 }, callout: { ...root.SigK.annotationPresets.DEFAULT_CALLOUT_STYLE } };
  const SETTING_KEYS = Object.freeze({ text: 'annotTextStyle', callout: 'annotCalloutStyle' });
  // 欄の名前 → 次に付ける値の名前（文字の大きさは annotate-tools.js が覚える）。
  const NEXT_KEYS = Object.freeze({ bold: 'bold', italic: 'italic', fill: 'fill', border: 'border', lineWidth: 'borderWidth' });

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  // 選んでいる書き込みを patch で直して 1 世代積み、選び直す。読み込んだものは写しに変わり、選択は写しへ移す。
  // gesture は欄の名前（同じ欄を続けて変えたら 1 世代に畳む。spec-4b-3a 確定事項J）。
  function updateSelected(entry, patch, gesture) {
    const annots = viewer().getAnnotations();
    const next = root.SigK.annotationState.updateAnnot(annots, entry, patch);
    if (next === annots)
      return false;
    const before = annotate().getSelected();
    const after = entry.ref !== undefined ? next.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(next, { annot: { before, after }, gesture });
    annotate().select(after);
    return true;
  }

  // 覚える先（text か callout）。選んでいる 1 件が吹き出しなら callout、何も選んでいなければ持っている道具。
  function toolKey() {
    const entry = annotate().selectedEntry();
    const kind = entry === null ? annotate().drawingTool() : presets().kindOf(entry);
    return kind === 'callout' ? 'callout' : 'text';
  }

  // 次に付ける値として覚える。テキストの文字の大きさは annotate-tools.js、ほかは settings.json に書く。
  function rememberFor(field, value, tool = toolKey()) {
    if (field === 'fontSize' && tool === 'text')
      return annotate().rememberFontSize(value);
    const key = field === 'fontSize' ? 'fontSize' : NEXT_KEYS[field];
    if (key === undefined)
      return false;
    nextStyles[tool][key] = value;
    root.SigK.shell?.persist?.({ [SETTING_KEYS[tool]]: { [key]: value } });
    return true;
  }

  // 欄の値を当てる。2 件以上ならテキストにだけまとめて、1 件ならそのテキストに（テキストでなければ当てない）当て、次に付ける値として覚える。
  function applyText(field, value) {
    if (annotate().getSelection().length > 1)
      return root.SigK.annotateBulk.applyField(field, value);
    const entry = annotate().selectedEntry();
    const tool = toolKey();
    const patch = root.SigK.freeTextStyle.patchFor(field, value, entry);
    if (patch !== null)
      updateSelected(entry, patch, field);
    rememberFor(field, value, tool);
    root.SigK.annotationProps?.refresh();
    return true;
  }

  function isColorOrNone(value) {
    return value === null || root.SigK.shapeStyle.isHexColor(value);
  }

  function setFontSize(size) {
    return presets().isFontSize(size) && applyText('fontSize', size);
  }

  // 太字か斜体を付け外しする（spec-4b-4a 確定事項G3）。
  function setTextFlag(field, value) {
    return root.SigK.freeTextStyle.FLAGS.includes(field) && typeof value === 'boolean' && applyText(field, value);
  }

  // 塗り（'#rrggbb' か null。spec-4b-4a 確定事項G4）。
  function setTextFill(color) {
    return isColorOrNone(color) && applyText('fill', color === null ? null : color.toLowerCase());
  }

  // 枠線の色（'#rrggbb' か null）。
  function setBorder(color) {
    return isColorOrNone(color) && applyText('border', color === null ? null : color.toLowerCase());
  }

  // 枠線の太さ（右パネルの太さの行。1〜40）。
  function setBorderWidth(width) {
    return presets().isLineWidth(width) && applyText('lineWidth', width);
  }

  // 次に置くテキスト（tool が 'callout' なら吹き出し。文字の大きさも持つ）の書式。
  function getNextStyle(tool = 'text') {
    return { ...nextStyles[tool === 'callout' ? 'callout' : 'text'] };
  }

  // 枠線の太さとして受け取れるか（吹き出しは既定の 1.5 も受ける）。
  function isBorderWidth(value, tool) {
    return presets().isLineWidth(value) || (tool === 'callout' && value === presets().DEFAULT_CALLOUT_STYLE.borderWidth);
  }

  // 起動時に設定から戻す（app.js）。形の合わない欄は今の値のまま。
  function applyNextStyle(style, tool = 'text') {
    const next = nextStyles[tool === 'callout' ? 'callout' : 'text'];
    for (const field of root.SigK.freeTextStyle.FLAGS) {
      if (typeof style?.[field] === 'boolean')
        next[field] = style[field];
    }
    for (const key of ['fill', 'border']) {
      if (style !== null && style !== undefined && isColorOrNone(style[key]))
        next[key] = style[key];
    }
    if (isBorderWidth(style?.borderWidth, tool))
      next.borderWidth = style.borderWidth;
    if (tool === 'callout' && presets().isFontSize(style?.fontSize))
      next.fontSize = style.fontSize;
    root.SigK.annotationProps?.refresh();
    return getNextStyle(tool);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTextStyle = { setFontSize, setTextFlag, setTextFill, setBorder, setBorderWidth, getNextStyle, applyNextStyle, rememberFor };
})(typeof window !== 'undefined' ? window : globalThis);
