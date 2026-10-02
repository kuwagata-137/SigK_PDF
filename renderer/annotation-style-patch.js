(function (root) {
  'use strict';

  // 見た目の欄（線の色・線なし・塗り・線種・線の太さ・不透明度・文字の大きさ・太字・斜体）を書き込みに当てる値と、右パネルに出す形
  // （spec-4b-1b 確定事項1〜9、spec-4b-3a 確定事項I、spec-4b-4a 確定事項G5）。DOM に触れない。
  //
  // 1 件でも複数でも同じ形で扱う。複数のときは、その欄を持てる書き込みにだけ当て、出すときはそろっていない値を「混在」にする。
  // テキストにだけある欄（文字の大きさ・太字・斜体）の当て方は free-text-style.js が持つ。

  const FIELDS = Object.freeze(['color', 'strokeNone', 'fill', 'lineStyle', 'lineWidth', 'opacity', 'fontSize', 'bold', 'italic']);

  function style() {
    return root.SigK.shapeStyle;
  }

  function textStyle() {
    return root.SigK.freeTextStyle;
  }

  function isTextField(field) {
    return textStyle()?.FIELDS.includes(field) === true;
  }

  function isDrawnKind(kind) {
    return root.SigK.annotationEntry?.isDrawnKind(kind) === true;
  }

  function isOpacityKind(kind) {
    return root.SigK.annotationPresets.isOpacityKind(kind);
  }

  // 色の行の見出し。図形・ペンは「線の色」、テキストは「文字の色」、それ以外は「色」（spec-4b-1b 確定事項1）。
  function colorLabelOf(kind) {
    if (isDrawnKind(kind))
      return '線の色';
    return kind === 'text' ? '文字の色' : '色';
  }

  // 線種を選べる種類か（四角・丸と直線・矢印。ペンは実線だけ）。
  function hasLineStyles(kind) {
    return style().lineStylesOf(kind).length > 1;
  }

  // 欄の値を当てられるか（確定事項I2 の表）。表示のみには当てない。
  function appliesTo(field, entry, value) {
    if (entry === null || entry === undefined || entry.readonly === true)
      return false;
    if (isTextField(field))
      return textStyle().appliesTo(field, entry, value);
    switch (field) {
      case 'color': return true;
      case 'strokeNone': return style().isBoxedKind(entry.kind) && style().fillOf(entry) !== null;
      // 線なしのまま塗りなしにはできない（spec-4b-1b 確定事項4）。
      case 'fill': return style().isBoxedKind(entry.kind) && (value !== null || entry.color !== null);
      case 'lineStyle': return hasLineStyles(entry.kind) && style().lineStylesOf(entry.kind).includes(value);
      case 'lineWidth': return isDrawnKind(entry.kind);
      case 'opacity': return isOpacityKind(entry.kind);
      default: return false;
    }
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。太さは /Rect も作り直す（回した四角・丸は回したまま）。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    if (isTextField(field))
      return textStyle().patchFor(field, value, entry);
    switch (field) {
      case 'color': return entry.color === value ? null : { color: value };
      case 'strokeNone': return entry.color === null ? null : { color: null };
      case 'fill': return style().fillOf(entry) === value ? null : { fill: value };
      case 'lineStyle': return style().lineStyleOf(entry) === value ? null : { lineStyle: value };
      case 'lineWidth':
        if (entry.lineWidth === value)
          return null;
        return { lineWidth: value, ...root.SigK.shapeGeometry.rectOfShape({ kind: entry.kind, rect: entry.rect, paths: entry.paths, lineWidth: value, angle: entry.angle }) };
      case 'opacity': return (entry.opacity ?? 1) === value ? null : { opacity: value };
      default: return null;
    }
  }

  // 右パネルに渡す形（今までの約束）。
  function targetOf(entry) {
    return {
      kind: entry.kind,
      readonly: entry.readonly === true,
      color: entry.color ?? null,
      fill: style().fillOf(entry),
      lineStyle: style().lineStyleOf(entry),
      lineWidth: entry.lineWidth,
      opacity: entry.opacity ?? 1,
      fontSize: entry.kind === 'text' ? entry.fontSize : null,
      bold: entry.kind === 'text' ? entry.bold === true : null,
      italic: entry.kind === 'text' ? entry.italic === true : null,
    };
  }

  // 欄の値。主（最後）の値と、ほかとそろっていないか。持てるものが無ければ null。
  function valueOf(list, field) {
    if (list.length === 0)
      return null;
    const value = list.at(-1)[field];
    return { value, mixed: list.some((target) => target[field] !== value) };
  }

  // テキストにだけある欄の行の名。テキスト以外も混ざっていれば「（テキスト）」を付ける（spec-4b-4a 確定事項G5）。
  function textLabelOf(texts, live, label) {
    return texts.length < live.length ? `${label}（テキスト）` : label;
  }

  function textsOf(live) {
    return live.filter((target) => target.kind === 'text');
  }

  // 文字の大きさの行。テキストが無ければ null。
  function fontSizeViewOf(live) {
    const texts = textsOf(live);
    return texts.length === 0 ? null : { ...valueOf(texts, 'fontSize'), label: textLabelOf(texts, live, '文字の大きさ') };
  }

  // 書式（太字・斜体）の行（spec-4b-4a 確定事項G3）。テキストが無ければ null。
  function formatViewOf(live) {
    const texts = textsOf(live);
    if (texts.length === 0)
      return null;
    return { bold: valueOf(texts, 'bold'), italic: valueOf(texts, 'italic'), label: textLabelOf(texts, live, '書式') };
  }

  // 右パネルの行に出す形（確定事項I1）。targets は targetOf の形（道具の次に付ける値も同じ形）。表示のみは除き、残らなければ null。
  function viewOf(targets) {
    const live = targets.filter((target) => target !== null && target !== undefined && target.readonly !== true);
    if (live.length === 0)
      return null;
    const boxed = live.filter((target) => style().isBoxedKind(target.kind));
    const styled = live.filter((target) => hasLineStyles(target.kind));
    const labels = [...new Set(live.map((target) => colorLabelOf(target.kind)))];
    return {
      colorLabel: labels.length === 1 ? labels[0] : '色',
      color: valueOf(live, 'color'),
      fill: valueOf(boxed, 'fill'),
      lineStyle: styled.length === 0 ? null : {
        ...valueOf(styled, 'lineStyle'),
        styles: style().LINE_STYLES.filter((each) => styled.some((target) => style().lineStylesOf(target.kind).includes(each))),
      },
      lineWidth: valueOf(live.filter((target) => isDrawnKind(target.kind)), 'lineWidth'),
      opacity: valueOf(live.filter((target) => isOpacityKind(target.kind)), 'opacity'),
      fontSize: fontSizeViewOf(live),
      format: formatViewOf(live),
      // パレットの［なし］。線なしは塗りのある四角・丸があるとき、塗りなしは線のある四角・丸があるときに選べる。
      boxed: boxed.length > 0,
      strokeNoneEnabled: boxed.some((target) => target.fill !== null),
      fillNoneEnabled: boxed.some((target) => target.color !== null),
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationStylePatch = { FIELDS, colorLabelOf, appliesTo, patchFor, targetOf, viewOf };
})(typeof window !== 'undefined' ? window : globalThis);
