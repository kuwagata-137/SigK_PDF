(function (root) {
  'use strict';

  // 注釈一覧の行を組む純粋層（spec-4-4 確定事項28）。DOM に触れない。
  //
  // 差分（{ added, removed }）と読み込み（imported）から、いまの並び（plan）の順にページを回し、
  // ページの中は紙の上から下（rect の上辺が高い順）、同じ高さなら左から右に並べる。行は
  // { key, kind, subtype, readonly, page（1 始まりの表示位置）, src, title, label, icon, color }。
  // 描くのは annotation-list.js。

  // 見出しに出す本文の先頭行の長さの上限。
  const TITLE_MAX = 120;

  // 種類ごとのアイコン（assets/icons.js）。表示のみは subtype で引き、無ければ注釈モードの絵。
  const ICONS = Object.freeze({
    highlight: 'highlight', underline: 'underline', strikeout: 'strikeout', text: 'text', callout: 'callout',
    square: 'shapeSquare', circle: 'shapeCircle', line: 'shapeLine', arrow: 'shapeArrow', cross: 'shapeCross', polygon: 'shapePolygon', ink: 'pen', marker: 'marker',
    note: 'note',
  });
  const READONLY_ICONS = Object.freeze({
    Text: 'note', FreeText: 'text', Line: 'shapeLine', PolyLine: 'shapeLine', Square: 'shapeSquare', Polygon: 'shapePolygon',
    Circle: 'shapeCircle', Highlight: 'highlight', Underline: 'underline', Squiggly: 'underline', StrikeOut: 'strikeout', Ink: 'pen',
  });

  function presets() {
    return root.SigK.annotationPresets;
  }

  function annotationState() {
    return root.SigK.annotationState;
  }

  // 本文の先頭行（空行は飛ばす。前後の空白を落とし、長ければ切る）。無ければ ''。
  function titleOf(entry) {
    const text = typeof entry?.text === 'string' ? entry.text : '';
    const line = text.split('\n').map((item) => item.trim()).find((item) => item !== '') ?? '';
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX)}…` : line;
  }

  // 種類名。表示のみは subtype の名前。
  function labelOf(entry) {
    if (entry.readonly === true)
      return presets().readonlyLabelOf(entry.subtype);
    return presets().TOOL_LABELS[presets().kindOf(entry)] ?? presets().readonlyLabelOf(entry.subtype);
  }

  // 吹き出しは吹き出しのアイコン（spec-4b-4b 確定事項F6）。
  function iconOf(entry) {
    if (entry.kind === 'other')
      return READONLY_ICONS[entry.subtype] ?? 'modeAnnot';
    return ICONS[presets().kindOf(entry)] ?? 'modeAnnot';
  }

  // 行の色。線なしの四角・丸は塗りの色（spec-4b-1b 確定事項16）、吹き出しは枠線の色（無ければ文字の色。spec-4b-4b 確定事項F6）。
  function colorOf(entry) {
    if (entry.kind === 'text' && entry.callout !== undefined)
      return entry.borderColor ?? entry.color;
    return entry.color ?? entry.fill ?? null;
  }

  function rowOf(entry, page) {
    return {
      key: entry.ref ?? entry.id,
      kind: entry.kind,
      subtype: entry.subtype,
      readonly: entry.readonly === true,
      page,
      src: entry.src,
      title: titleOf(entry),
      label: labelOf(entry),
      icon: iconOf(entry),
      color: colorOf(entry),
    };
  }

  // 紙の上から下、同じ高さなら左から右。
  function byPosition(a, b) {
    return (b.rect[3] - a.rect[3]) || (a.rect[0] - b.rect[0]);
  }

  function rowsOf(annots, imported, plan) {
    if (!Array.isArray(plan))
      return [];
    const rows = [];
    plan.forEach((page, index) => {
      if (!Number.isInteger(page?.src))
        return;
      const entries = annotationState().annotsOnPage(annots, imported ?? {}, page.src);
      for (const entry of [...entries].sort(byPosition))
        rows.push(rowOf(entry, index + 1));
    });
    return rows;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationIndex = { TITLE_MAX, ICONS, READONLY_ICONS, titleOf, labelOf, iconOf, rowsOf };
})(typeof window !== 'undefined' ? window : globalThis);
