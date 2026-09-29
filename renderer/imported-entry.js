(function (root) {
  'use strict';

  // ファイルにある注釈 1 件を、自前の層で描ける形にする純粋層（spec-4-1 確定事項17、spec-4-2 確定事項13、
  // spec-4-3 確定事項13、spec-4-4 確定事項20）。annotation-import.js から移した（spec-4b-1a 確定事項36）。
  //
  // pdf.js の getAnnotations() の 1 件から、Highlight／Underline／StrikeOut、自分で付けた FreeText
  // （/DA のフォント名が SigKJP のもの）、Square／Circle／Ink と 2 点の PolyLine、Text（ノート）を拾い、
  // 自前の層で描ける形 { ref, src, kind, color, opacity, quads, rect（テキストは text・fontSize・rotation、
  // 図形は lineWidth・paths、ノートは text・author も）} にする。
  // 他のツールが作った FreeText・Line（pdf.js が /L の向きを落とす）・3 点以上の PolyLine・Polygon・
  // スタンプ等の markup 注釈は「表示のみ」の entry { ref, src, kind: 'other', subtype, readonly: true } にする
  // （一覧に出て消せる。pdf.js が描き続ける）。Link・Widget・Popup は拾わない。DOM に触れない。
  // 値の変換は imported-values.js、図形・ペンの組み立ては imported-shape.js が持つ。

  // pdf.js の subtype → 種類。PolyLine は頂点と矢じりで line／arrow に分ける。
  const SUBTYPES = Object.freeze({
    Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', FreeText: 'text',
    Square: 'square', Circle: 'circle', PolyLine: 'polyline', Ink: 'ink', Text: 'note',
  });
  // 規格が markup annotation とする種類（ISO 32000-1 表 170）。拾えなかったものは表示のみで一覧に出す。
  const MARKUP_SUBTYPES = Object.freeze([
    'Text', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
    'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound', 'Redact',
  ]);
  function values() {
    return root.SigK.importedValues;
  }

  // ノートの色が無いときの塗り（ノートの既定の黄。spec-4b-1b 確定事項14 でパレットの色にした）。
  const DEFAULT_NOTE_COLOR = '#ffd966';
  // 自分で付けたテキストの印（worker/font-embed.js の DA_FONT_NAME と同じ）。
  const OWN_FONT_NAME = 'SigKJP';
  // pdf.js の id のうち、参照の形のもの（世代 0 は 12R、世代 1 以上は 12R1）。/Annots に直に置いた辞書は
  // annot_… と名付けられ、ワーカーが参照に直せない（消すと保存ごと断られていた）ので読み込まない
  // （spec-4b-1a 確定事項24）。pdf.js が描き続け、一覧には出ない。
  const REF_ID = /^\d+R\d*$/;

  function isRefId(id) {
    return typeof id === 'string' && REF_ID.test(id);
  }

  // 自分で付けたテキスト。/Rect と /Contents・/DA・/Rotate から組む（確定事項13）。
  function importedText(annotation, src) {
    const da = annotation.defaultAppearanceData;
    if (da?.fontName !== OWN_FONT_NAME || !Array.isArray(annotation.rect) || annotation.rect.length !== 4)
      return null;
    const text = root.SigK.freeTextGeometry.linesOf(annotation.contentsObj?.str ?? '').join('\n');
    const rotation = Number.isInteger(annotation.rotation) ? (((annotation.rotation % 360) + 360) % 360) : 0;
    if (text.trim() === '' || !(da.fontSize > 0) || ![0, 90, 180, 270].includes(rotation))
      return null;
    const rect = values().roundRect(annotation.rect);
    return {
      ref: annotation.id,
      src,
      kind: 'text',
      color: values().hexOf(da.fontColor),
      opacity: 1,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
      rect,
      text,
      fontSize: da.fontSize,
      rotation,
    };
  }

  // ノート。/Rect の左上 (x1, y2) から 20×20 を作り直す（/AP の無いものは pdf.js が 22×22 に直して返す。
  // 事前調査 A）。/AP の有無を問わず拾い、自前の付箋で描く（spec-4-4 確定事項20）。
  function importedNote(annotation, src) {
    if (!values().isRect(annotation.rect))
      return null;
    const graphics = root.SigK.noteGraphics;
    const rect = graphics.rectFromAnchor([annotation.rect[0], annotation.rect[3]]);
    return {
      ref: annotation.id,
      src,
      kind: 'note',
      color: annotation.color === null || annotation.color === undefined ? DEFAULT_NOTE_COLOR : values().hexOf(annotation.color),
      opacity: 1,
      quads: [graphics.quadOfRect(rect)],
      rect,
      text: values().contentsOf(annotation),
      author: String(annotation.titleObj?.str ?? ''),
    };
  }

  // 表示のみ。一覧に出す・消すのに要る欄だけ持ち、紙の上では pdf.js が描く（spec-4-4 確定事項16・20）。
  function readonlyEntry(annotation, src) {
    if (!MARKUP_SUBTYPES.includes(annotation.subtype) || annotation.id === undefined || !values().isRect(annotation.rect))
      return null;
    const rect = values().roundRect(annotation.rect);
    return {
      ref: annotation.id,
      src,
      kind: 'other',
      subtype: annotation.subtype,
      color: annotation.color === null || annotation.color === undefined ? '#8b93a1' : values().hexOf(annotation.color),
      opacity: 1,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
      rect,
      text: values().contentsOf(annotation),
      author: String(annotation.titleObj?.str ?? ''),
      readonly: true,
    };
  }

  // 自前で描ける形にする。拾えない markup 注釈は表示のみの entry、それ以外は null。
  function importedEntry(annotation, src) {
    if (!isRefId(annotation?.id))
      return null;
    return editableEntry(annotation, src) ?? readonlyEntry(annotation, src);
  }

  function editableEntry(annotation, src) {
    const kind = SUBTYPES[annotation.subtype];
    if (kind === undefined || annotation.id === undefined)
      return null;
    if (kind === 'text')
      return importedText(annotation, src);
    if (kind === 'note')
      return importedNote(annotation, src);
    if (kind === 'square' || kind === 'circle' || kind === 'polyline' || kind === 'ink')
      return root.SigK.importedShape.importedShape(annotation, src);
    const quads = values().quadsOf(annotation.quadPoints);
    if (quads.length === 0)
      return null;
    return {
      ref: annotation.id,
      src,
      kind,
      color: values().hexOf(annotation.color),
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      quads,
      rect: [...(annotation.rect ?? root.SigK.markupQuads.unionRect(quads))],
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedEntry = { SUBTYPES, MARKUP_SUBTYPES, OWN_FONT_NAME, isRefId, importedEntry };
})(typeof window !== 'undefined' ? window : globalThis);
