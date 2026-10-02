(function (root) {
  'use strict';

  // 色・塗り・線なし・線種の指揮（spec-4-1 確定事項6、spec-4b-1b 確定事項2〜5・16〜18・28）。
  //
  // 右パネルの色と塗りのチップ（パレット）・線種のボタンから来た値を、選んでいる書き込みに当てて 1 世代積むか、選んでいなければ
  // 道具の「次に付ける値」として覚える。書き込みを直したときも、その値を次に付ける値にする（今までの色と同じ）。次に付ける値の
  // 置き場と settings.json への出し入れは annotate-next-style.js。線と塗りを両方「なし」にはできない。annotate.js から同じ名前で
  // 委ねる（今までの呼び口を保つ）。

  function next() {
    return root.SigK.annotateNextStyle;
  }

  function palette() {
    return root.SigK.annotationPalette;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function annotate() {
    return root.SigK.annotate;
  }

  function viewer() {
    return root.SigK.viewer;
  }

  function refresh() {
    root.SigK.annotationProps?.refresh();
  }

  // いまの道具が描く種類（図形は道具の段で選んだ種類、ペンは ink）。描く道具が無ければ（「選択」を含む）null。
  function toolKind() {
    const tool = annotate().drawingTool();
    if (tool === null)
      return null;
    return root.SigK.annotateShape?.kindOfTool(tool) ?? tool;
  }

  // 選んでいる書き込みを patch で直して 1 世代積む。読み込んだものは写しに変わり、選択はその写しへ移す。形が崩れる（線と塗りを
  // 両方なしにする、など。annotation-state.updateAnnot が断る）なら何もしない。
  // gesture は欄の名前（同じ欄を続けて変えたら 1 世代に畳む。spec-4b-3a 確定事項J）。
  function updateSelected(entry, patch, gesture) {
    const annots = viewer().getAnnotations();
    const changed = root.SigK.annotationState.updateAnnot(annots, entry, patch);
    if (changed === annots)
      return false;
    const before = annotate().getSelected();
    const after = entry.ref !== undefined ? changed.added.at(-1).id : before;
    root.SigK.pageEdit.commitAnnots(changed, { annot: { before, after }, gesture });
    annotate().select(after);
    return true;
  }

  // 直す相手。選んでいる書き込み（表示のみなら null）か、何も選んでいなければ undefined（次に付ける値を変える）。
  function editableSelected() {
    const entry = annotate().selectedEntry();
    if (entry === null)
      return undefined;
    return entry.readonly === true ? null : entry;
  }

  // 線の色。四角・丸を線なしから戻すときもこれを使う。
  // 2 件以上を選んでいれば、その欄を持てる全部に当てる（spec-4b-3a 確定事項I2）。
  function isMany() {
    return annotate().getSelection().length > 1;
  }

  function bulk() {
    return root.SigK.annotateBulk;
  }

  function setColor(color) {
    const value = palette().normalizeHex(color);
    if (value !== null && isMany())
      return bulk().applyField('color', value);
    const entry = editableSelected();
    if (value === null || entry === null)
      return false;
    const kind = entry?.kind ?? toolKind();
    if (kind === null)
      return false;
    if (entry !== undefined && entry.color !== value && !updateSelected(entry, { color: value }, 'color'))
      return false;
    next().rememberColor(kind, value);
    if (style().isBoxedKind(kind))
      next().rememberShape('strokeNone', false);
    refresh();
    return true;
  }

  // 線なし（四角・丸で、塗りがあるときだけ）。
  function setStrokeNone() {
    if (isMany())
      return bulk().applyField('strokeNone', null);
    const entry = editableSelected();
    if (entry === null)
      return false;
    const kind = entry?.kind ?? toolKind();
    const fill = entry === undefined ? next().fillOf(kind) : style().fillOf(entry);
    if (!style().isBoxedKind(kind) || fill === null)
      return false;
    if (entry !== undefined && entry.color !== null && !updateSelected(entry, { color: null }, 'color'))
      return false;
    next().rememberShape('strokeNone', true);
    refresh();
    return true;
  }

  // 塗り（四角・丸とテキスト）。null は塗りなしで、四角・丸は線なしのときは選べない。塗りを外せば線なしの印も外す。テキストの塗りは
  // annotate-text-style.js が当てる（spec-4b-4a 確定事項G4）。
  function setFill(color) {
    const value = color === null ? null : palette().normalizeHex(color);
    if ((color === null || value !== null) && isMany())
      return bulk().applyField('fill', value);
    const entry = editableSelected();
    if ((color !== null && value === null) || entry === null)
      return false;
    const kind = entry?.kind ?? toolKind();
    if (kind === 'text')
      return root.SigK.annotateTextStyle.setTextFill(value);
    const stroked = entry === undefined ? !next().strokeNoneOf(kind) : entry.color !== null;
    if (!style().isBoxedKind(kind) || (value === null && !stroked))
      return false;
    if (entry !== undefined && style().fillOf(entry) !== value && !updateSelected(entry, { fill: value }, 'fill'))
      return false;
    next().rememberShape('fills', value);
    if (value === null)
      next().rememberShape('strokeNone', false);
    refresh();
    return true;
  }

  // 線種（四角・丸は実線・破線・雲形、直線・矢印は実線・破線）。実線だけの種類（ペン）では覚え直さない。
  function setLineStyle(lineStyle) {
    if (isMany())
      return bulk().applyField('lineStyle', lineStyle);
    const entry = editableSelected();
    if (entry === null)
      return false;
    const kind = entry?.kind ?? toolKind();
    if (kind === null || !style().lineStylesOf(kind).includes(lineStyle))
      return false;
    if (entry !== undefined && style().lineStyleOf(entry) !== lineStyle && !updateSelected(entry, { lineStyle }, 'lineStyle'))
      return false;
    if (style().lineStylesOf(kind).length > 1)
      next().rememberShape('lineStyles', lineStyle);
    refresh();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotateColor = { setColor, setStrokeNone, setFill, setLineStyle };
})(typeof window !== 'undefined' ? window : globalThis);
