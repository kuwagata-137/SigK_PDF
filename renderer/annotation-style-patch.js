(function (root) {
  'use strict';

  // 見た目の欄（線の色・線なし・塗り・線種・線の太さ・不透明度・文字の大きさ・太字・斜体・枠線）を書き込みに当てる値と、右パネルに
  // 出す形（spec-4b-1b 確定事項1〜9、spec-4b-3a 確定事項I、spec-4b-4a 確定事項G）。DOM に触れない。
  //
  // 1 件でも複数でも同じ形で扱う。複数のときは、その欄を持てる書き込みにだけ当て、出すときはそろっていない値を「混在」にする。
  // テキストの文字の大きさ・太字・斜体・塗り・枠線・枠線の太さ（太さの行）の当て方は free-text-style.js、テキストの行に出す形は
  // free-text-style-view.js が持つ。

  // 塗りの透明度（fillOpacity）とハッチング（hatch。種類・色・間隔・線幅の一部）は spec-7-9 確定事項B2・C1 で追加した。
  // 枠線「あり」（strokeOn。線なしの書き込みに、その種類の次に付ける線の色を当てる）は決定102 ④で追加した。
  const FIELDS = Object.freeze(['color', 'strokeNone', 'strokeOn', 'fill', 'lineStyle', 'lineWidth', 'opacity', 'fontSize', 'bold', 'italic', 'border', 'fillOpacity', 'hatch']);
  // テキストにだけある欄（テキスト以外には当てない）。
  const TEXT_ONLY = Object.freeze(['fontSize', 'bold', 'italic', 'border']);

  function style() {
    return root.SigK.shapeStyle;
  }

  function textStyle() {
    return root.SigK.freeTextStyle;
  }

  function fill() {
    return root.SigK.fillStyle;
  }

  // テキストについて free-text-style.js へ回す欄か。
  function isTextField(field, entry) {
    return entry?.kind === 'text' && textStyle()?.FIELDS.includes(field) === true;
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
    if (isTextField(field, entry))
      return textStyle().appliesTo(field, entry, value);
    if (TEXT_ONLY.includes(field))
      return false;
    switch (field) {
      case 'color': return true;
      case 'strokeNone': return style().canFill(entry) && style().fillOf(entry) !== null;
      case 'strokeOn': return style().canFill(entry);
      // 線なしのまま塗りなしにはできない（spec-4b-1b 確定事項4）。塗れるのは四角・丸と閉じた多角形（spec-4b-5a 確定事項5）。
      case 'fill': return style().canFill(entry) && (value !== null || entry.color !== null);
      case 'lineStyle': return hasLineStyles(entry.kind) && style().lineStylesOf(entry.kind).includes(value);
      case 'lineWidth': return isDrawnKind(entry.kind);
      case 'opacity': return isOpacityKind(entry.kind);
      case 'fillOpacity':
      case 'hatch': return style().canFill(entry);
      default: return false;
    }
  }

  // 当てる値（updateAnnot に渡す patch）。当てられないか、今と同じなら null。太さは /Rect も作り直す（回した四角・丸は回したまま）。
  function patchFor(field, value, entry) {
    if (!appliesTo(field, entry, value))
      return null;
    if (isTextField(field, entry))
      return textStyle().patchFor(field, value, entry);
    switch (field) {
      case 'color': return entry.color === value ? null : { color: value };
      case 'strokeNone': return entry.color === null ? null : { color: null };
      case 'strokeOn': return entry.color !== null ? null : { color: root.SigK.annotateNextStyle.colorOf(root.SigK.annotationPresets.kindOf(entry)) };
      case 'fill': return style().fillOf(entry) === value ? null : { fill: value };
      case 'lineStyle': return style().lineStyleOf(entry) === value ? null : { lineStyle: value };
      case 'lineWidth':
        if (entry.lineWidth === value)
          return null;
        return { lineWidth: value, ...root.SigK.shapeGeometry.rectOfEntry(entry, { lineWidth: value }) };
      // 枠線の不透明度を変えても塗りつぶしは変わらないように、持っていない塗りの不透明度を今の値で残す（spec-7-9 確定事項B2）。
      case 'opacity': return (entry.opacity ?? 1) === value ? null : { opacity: value, ...fill().keepFillOpacity(entry) };
      case 'fillOpacity': return fill().fillOpacityOf(entry) === value ? null : { fillOpacity: value };
      case 'hatch': return hatchPatchOf(entry, value);
      default: return null;
    }
  }

  // ハッチングの一部を当てた後のハッチング。今と同じなら null。今がなしの書き込みに種類を当てる時は、次に追加する書き込みの値の
  // 色・間隔・線幅を使う（annotate-fill.js）。
  function hatchPatchOf(entry, partial) {
    const current = fill().hatchOf(entry);
    const next = fill().mergeHatch(current, partial, root.SigK.annotateFill?.hatchMemo());
    if (next === null)
      return current === null ? null : { hatch: null };
    return current !== null && ['pattern', 'color', 'gap', 'width'].every((key) => current[key] === next[key]) ? null : { hatch: next };
  }

  // 右パネルに渡す形（今までの約束）。テキストの太さはその枠線の太さ（枠線が無ければ null）。
  function targetOf(entry) {
    const text = entry.kind === 'text';
    const border = text ? (entry.borderColor ?? null) : null;
    return {
      kind: entry.kind,
      ...(entry.closed === undefined ? {} : { closed: entry.closed }),
      readonly: entry.readonly === true,
      color: entry.color ?? null,
      fill: style().fillOf(entry),
      lineStyle: style().lineStyleOf(entry),
      lineWidth: text ? (border === null ? null : entry.borderWidth) : entry.lineWidth,
      opacity: entry.opacity ?? 1,
      // 塗りの透明度とハッチング（塗りを持てる書き込みだけ。spec-7-9 確定事項B2・C1）。
      fillOpacity: style().canFill(entry) ? fill().fillOpacityOf(entry) : null,
      hatch: style().canFill(entry) ? fill().hatchOf(entry) : null,
      fontSize: text ? entry.fontSize : null,
      bold: text ? entry.bold === true : null,
      italic: text ? entry.italic === true : null,
      border,
    };
  }

  // 欄の値。主（最後）の値と、ほかとそろっていないか。持てるものが無ければ null。
  function valueOf(list, field) {
    if (list.length === 0)
      return null;
    const value = list.at(-1)[field];
    return { value, mixed: list.some((target) => target[field] !== value) };
  }

  // 塗りと線なしを持てる相手か。書き込みは閉じた多角形まで見て、道具の次に付ける値（closed を持たない）は種類で見る（spec-4b-5a 確定事項5・28）。
  function fillable(target) {
    return target.kind === 'polygon' && target.closed === undefined ? style().isFillableKind(target.kind) : style().canFill(target);
  }

  // ハッチングの行の値。種類はなしを 'none' として比べ、色・間隔・線幅はハッチングのある相手だけで比べる（無ければ null）。
  function hatchViewOf(boxed) {
    if (boxed.length === 0)
      return null;
    const hatched = boxed.map((target) => target.hatch ?? null).filter((hatch) => hatch !== null);
    const fieldOf = (field) => (hatched.length === 0 ? null : valueOf(hatched, field));
    return {
      pattern: valueOf(boxed.map((target) => ({ pattern: target.hatch?.pattern ?? 'none' })), 'pattern'),
      color: fieldOf('color'),
      gap: fieldOf('gap'),
      width: fieldOf('width'),
    };
  }

  // 右パネルの行に出す形（確定事項I1）。targets は targetOf の形（道具の次に付ける値も同じ形）。表示のみは除き、残らなければ null。
  function viewOf(targets) {
    const live = targets.filter((target) => target !== null && target !== undefined && target.readonly !== true);
    if (live.length === 0)
      return null;
    const boxed = live.filter(fillable);
    const texts = live.filter((target) => target.kind === 'text');
    const styled = live.filter((target) => hasLineStyles(target.kind));
    const labels = [...new Set(live.map((target) => colorLabelOf(target.kind)))];
    const textView = root.SigK.freeTextStyleView;
    return {
      colorLabel: labels.length === 1 ? labels[0] : '色',
      color: valueOf(live, 'color'),
      // 塗りは四角・丸とテキストに当たる（spec-4b-4a 確定事項G5）。
      fill: valueOf(live.filter((target) => fillable(target) || target.kind === 'text'), 'fill'),
      lineStyle: styled.length === 0 ? null : {
        ...valueOf(styled, 'lineStyle'),
        styles: style().LINE_STYLES.filter((each) => styled.some((target) => style().lineStylesOf(target.kind).includes(each))),
      },
      lineWidth: textView.widthViewOf(live),
      opacity: valueOf(live.filter((target) => isOpacityKind(target.kind)), 'opacity'),
      ...textView.textViewsOf(live),
      // 線なし（見出し「枠線」のラジオボタン「なし」。決定102 ④）は塗りのある四角・丸があるとき、塗りなし（色の一覧の［塗りなし］）は
      // 線のある四角・丸か、テキストがあるときに選べる（下の strokeNoneEnabled・fillNoneEnabled）。
      // 見出し「枠線」「塗り」で分けるか（塗りを持てる相手があり、テキストが無い時。spec-7-9 確定事項B1）と、塗りの行の値。
      split: boxed.length > 0 && texts.length === 0,
      fillOpacity: valueOf(boxed, 'fillOpacity'),
      hatch: hatchViewOf(boxed),
      boxed: boxed.length > 0,
      // 枠線のあり・なし（ラジオボタン。決定102 ④）。value は枠線があれば true。
      stroke: boxed.length === 0 ? null : valueOf(boxed.map((target) => ({ on: target.color !== null })), 'on'),
      strokeNoneEnabled: boxed.some((target) => target.fill !== null),
      fillNoneEnabled: boxed.some((target) => target.color !== null) || texts.length > 0,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationStylePatch = { FIELDS, colorLabelOf, appliesTo, patchFor, targetOf, viewOf };
})(typeof window !== 'undefined' ? window : globalThis);
