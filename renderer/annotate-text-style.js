(function (root) {
  'use strict';

  // テキストの書式（文字の大きさ・太字・斜体・塗り・枠線・枠線の太さ）を選んでいるテキストに当てるか、次に置く値として覚える指揮
  // （spec-4-2 確定事項2・21・34、spec-4b-3a 確定事項J、spec-4b-4a 確定事項A3・G・H・K1）。当てる値は free-text-style.js が作る。
  // 2 件以上を選んでいれば、annotate-bulk.js の applyField でテキストにだけまとめて当てる。書き込みを直したときも、その値を次に付ける
  // 値にする（今までの色と同じ）。文字の大きさは annotate-tools.js、ほかは settings.json の annotTextStyle に覚える（決定47 ⑨と同じく
  // 道具ごと。起草者の判断）。欄の名前は annotation-style-patch.js と同じで、枠線の太さは lineWidth（右パネルの太さの行）。

  // 次に置くテキストの書式。border は枠線の色（null は枠線なし）、borderWidth は枠線を付けるときの太さ。
  const nextStyle = { bold: false, italic: false, fill: null, border: null, borderWidth: 1 };
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

  // 次に付ける値として覚える。文字の大きさ以外は settings.json に書く。
  function rememberFor(field, value) {
    if (field === 'fontSize')
      return annotate().rememberFontSize(value);
    const key = NEXT_KEYS[field];
    if (key === undefined)
      return false;
    nextStyle[key] = value;
    root.SigK.shell?.persist?.({ annotTextStyle: { [key]: value } });
    return true;
  }

  // 欄の値を当てる。2 件以上ならテキストにだけまとめて、1 件ならそのテキストに（テキストでなければ当てない）当て、次に付ける値として覚える。
  function applyText(field, value) {
    if (annotate().getSelection().length > 1)
      return root.SigK.annotateBulk.applyField(field, value);
    const entry = annotate().selectedEntry();
    const patch = root.SigK.freeTextStyle.patchFor(field, value, entry);
    if (patch !== null)
      updateSelected(entry, patch, field);
    rememberFor(field, value);
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

  // 次に置くテキストの書式。
  function getNextStyle() {
    return { ...nextStyle };
  }

  // 起動時に設定から戻す（app.js）。形の合わない欄は今の値のまま。
  function applyNextStyle(style) {
    for (const field of root.SigK.freeTextStyle.FLAGS) {
      if (typeof style?.[field] === 'boolean')
        nextStyle[field] = style[field];
    }
    for (const key of ['fill', 'border']) {
      if (style !== null && style !== undefined && isColorOrNone(style[key]))
        nextStyle[key] = style[key];
    }
    if (presets().isLineWidth(style?.borderWidth))
      nextStyle.borderWidth = style.borderWidth;
    root.SigK.annotationProps?.refresh();
    return getNextStyle();
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTextStyle = { setFontSize, setTextFlag, setTextFill, setBorder, setBorderWidth, getNextStyle, applyNextStyle, rememberFor };
})(typeof window !== 'undefined' ? window : globalThis);
