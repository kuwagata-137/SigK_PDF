(function (root) {
  'use strict';

  // テキストの書式（文字の大きさ・太字・斜体・塗り・枠線・枠線の太さ）を選んでいるテキストに当てるか、次に置く値として覚える指揮
  // （spec-4-2 確定事項2・21・34、spec-4b-3a 確定事項J、spec-4b-4a 確定事項A3・G・H・K1）。当てる値は free-text-style.js が作る。
  // 2 件以上を選んでいれば、annotate-bulk.js の applyField でテキストにだけまとめて当てる。書き込みを直したときも、その値を次に付ける
  // 値にする（今までの色と同じ）。文字の大きさは annotate-tools.js、ほかは settings.json の annotTextStyle に覚える（決定47 ⑨と同じく
  // 道具ごと。起草者の判断）。欄の名前は annotation-style-patch.js と同じで、枠線の太さは lineWidth（右パネルの太さの行）。
  //
  // 吹き出しの次に付ける値はテキストと別に、文字の大きさも含めて annotCalloutStyle に覚える（spec-4b-4b 確定事項G4・G5。決定59 ④）。
  // どちらの値かは鍵（'text'・'callout'。annotation-presets.js の nextKeyOf）で分け、選んでいる書き込みか持っている道具で決める。

  // 次に置くテキスト・吹き出しの書式。border は枠線の色（null は枠線なし）、borderWidth は枠線を付けるときの太さ。吹き出しは
  // 文字の大きさ（fontSize）もここに持つ。
  const nextStyles = {
    text: { bold: false, italic: false, fill: null, border: null, borderWidth: 1 },
    callout: { ...root.SigK.annotationPresets.DEFAULT_CALLOUT_STYLE },
  };
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

  // いま値を覚える置き場の鍵。1 件を選んでいればその書き込み、そうでなければ持っている道具（吹き出しの道具なら 'callout'）。
  function currentKey() {
    const entry = annotate().getSelection().length === 1 ? annotate().selectedEntry() : null;
    if (entry !== null)
      return presets().nextKeyOf(entry) === 'callout' ? 'callout' : 'text';
    return annotate().drawingTool() === 'callout' ? 'callout' : 'text';
  }

  // 次に付ける値として覚える。テキストの文字の大きさは annotate-tools.js、ほかは settings.json に書く。吹き出しは塗りと枠線を
  // 両方なしにはしない（確定事項A5。覚えずに残す）。
  function rememberFor(field, value, key = currentKey()) {
    const style = nextStyles[key];
    if (key === 'text' && field === 'fontSize')
      return annotate().rememberFontSize(value);
    const name = field === 'fontSize' ? 'fontSize' : NEXT_KEYS[field];
    if (name === undefined || style === undefined)
      return false;
    if (key === 'callout' && value === null && ((name === 'fill' && style.border === null) || (name === 'border' && style.fill === null)))
      return false;
    style[name] = value;
    root.SigK.shell?.persist?.({ [key === 'callout' ? 'annotCalloutStyle' : 'annotTextStyle']: { [name]: value } });
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

  // 次に置くテキスト（key が 'callout' なら吹き出し）の書式。
  function getNextStyle(key = 'text') {
    return { ...(nextStyles[key] ?? nextStyles.text) };
  }

  // 次に置く文字の大きさ（テキストは annotate-tools.js が覚える）。
  function fontSizeOf(key = 'text') {
    return key === 'callout' ? nextStyles.callout.fontSize : annotate().getFontSize();
  }

  // 起動時に設定から戻す（app.js）。形の合わない欄は今の値のまま。key が 'callout' なら吹き出し（文字の大きさも戻す）。
  function applyNextStyle(style, key = 'text') {
    const next = nextStyles[key] ?? nextStyles.text;
    for (const field of root.SigK.freeTextStyle.FLAGS) {
      if (typeof style?.[field] === 'boolean')
        next[field] = style[field];
    }
    for (const name of ['fill', 'border']) {
      if (style !== null && style !== undefined && isColorOrNone(style[name]))
        next[name] = style[name];
    }
    if (presets().isLineWidth(style?.borderWidth))
      next.borderWidth = style.borderWidth;
    if (key === 'callout' && presets().isFontSize(style?.fontSize))
      next.fontSize = style.fontSize;
    root.SigK.annotationProps?.refresh();
    return getNextStyle(key);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateTextStyle = {
    setFontSize, setTextFlag, setTextFill, setBorder, setBorderWidth, getNextStyle, fontSizeOf, applyNextStyle, rememberFor, currentKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
