(function (root) {
  'use strict';

  // ファイルにある注釈のうち自前で描くものを集める層（spec-4-1 確定事項17・18、spec-4-2 確定事項13、
  // spec-4-3 確定事項13、spec-4-4 確定事項20）。
  //
  // pdf.js の getAnnotations() から Highlight／Underline／StrikeOut、自分で付けた FreeText
  // （/DA のフォント名が SigKJP のもの）、Square／Circle／Ink と 2 点の PolyLine、Text（ノート）を拾い、
  // 自前の層で描ける形 { ref, src, kind, color, opacity, quads, rect（テキストは text・fontSize・rotation、
  // 図形は lineWidth・paths、ノートは text・author も）} にする。pdf.js には描かせない印
  // （annotationStorage の noView。事前調査 B ①）もここで付ける。
  // 他のツールが作った FreeText・Line（pdf.js が /L の向きを落とす）・3 点以上の PolyLine・Polygon・
  // スタンプ等の markup 注釈は「表示のみ」の entry { ref, src, kind: 'other', subtype, readonly: true } に
  // して imported に入れる（一覧に出て消せる。pdf.js が描き続けるので noView は付けない）。Link・Widget・
  // Popup は拾わない。
  // 集めたものは編集ではないので履歴には入らない。viewer.setImported() へ渡すだけ。

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
  // ノートの色が無いときの塗り（プリセットの黄）。
  const DEFAULT_NOTE_COLOR = '#ffe45a';
  // 自分で付けたテキストの印（worker/font-embed.js の DA_FONT_NAME と同じ）。
  const OWN_FONT_NAME = 'SigKJP';

  function hexOf(color) {
    if (color === null || color === undefined || color.length < 3)
      return '#000000';
    return `#${[...color].slice(0, 3).map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
  }

  // pdf.js の quadPoints（正規化済み。四角ごとに 8 つ）を四角の並びにする。
  function quadsOf(points) {
    const quads = [];
    for (let index = 0; index + 8 <= (points?.length ?? 0); index += 8)
      quads.push([...points.slice(index, index + 8)].map((value) => Math.round(value * 100) / 100));
    return quads;
  }

  function roundRect(rect) {
    return [...rect].map((value) => Math.round(value * 100) / 100);
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
    const rect = roundRect(annotation.rect);
    return {
      ref: annotation.id,
      src,
      kind: 'text',
      color: hexOf(da.fontColor),
      opacity: 1,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
      rect,
      text,
      fontSize: da.fontSize,
      rotation,
    };
  }

  function isRect(rect) {
    return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite);
  }

  // pdf.js の平たい数の並び（x y x y …）を点列にする。2 点未満なら null。
  function pathOf(flat) {
    if (flat === null || flat === undefined || flat.length < 4)
      return null;
    const path = [];
    for (let index = 0; index + 2 <= flat.length; index += 2)
      path.push([Math.round(flat[index] * 100) / 100, Math.round(flat[index + 1] * 100) / 100]);
    return path;
  }

  // PolyLine の種類。2 点で矢じりが無ければ直線、終点だけ開いた矢じりなら矢印。それ以外は拾わない。
  function polylineKind(annotation) {
    const [start, end] = annotation.lineEndings ?? ['None', 'None'];
    if (annotation.vertices?.length !== 4 || start !== 'None')
      return null;
    if (end === 'None')
      return 'line';
    return end === 'OpenArrow' ? 'arrow' : null;
  }

  function pathsOf(kind, annotation) {
    if (kind === 'ink') {
      const paths = (annotation.inkLists ?? []).map(pathOf).filter((path) => path !== null);
      return paths.length === 0 ? null : paths;
    }
    if (kind === 'line' || kind === 'arrow')
      return [pathOf(annotation.vertices)];
    return undefined;
  }

  // 図形・ペン。/Rect・/C・/BS /W と、/Vertices（PolyLine）・/InkList（Ink）から組む（spec-4-3 確定事項13）。
  function importedShape(annotation, src) {
    const kind = annotation.subtype === 'PolyLine' ? polylineKind(annotation) : SUBTYPES[annotation.subtype];
    if (kind === null || !isRect(annotation.rect) || annotation.color === null || annotation.color === undefined)
      return null;
    const paths = pathsOf(kind, annotation);
    if (paths === null)
      return null;
    const rect = roundRect(annotation.rect);
    const width = annotation.borderStyle?.width;
    const entry = {
      ref: annotation.id,
      src,
      kind,
      color: hexOf(annotation.color),
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      lineWidth: Number.isFinite(width) && width > 0 ? width : 1,
      rect,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
    };
    if (paths !== undefined)
      entry.paths = paths;
    return entry;
  }

  function contentsOf(annotation) {
    return String(annotation.contentsObj?.str ?? '').replace(/\r\n?/g, '\n');
  }

  // ノート。/Rect の左上 (x1, y2) から 20×20 を作り直す（/AP の無いものは pdf.js が 22×22 に直して返す。
  // 事前調査 A）。/AP の有無を問わず拾い、自前の付箋で描く（spec-4-4 確定事項20）。
  function importedNote(annotation, src) {
    if (!isRect(annotation.rect))
      return null;
    const graphics = root.SigK.noteGraphics;
    const rect = graphics.rectFromAnchor([annotation.rect[0], annotation.rect[3]]);
    return {
      ref: annotation.id,
      src,
      kind: 'note',
      color: annotation.color === null || annotation.color === undefined ? DEFAULT_NOTE_COLOR : hexOf(annotation.color),
      opacity: 1,
      quads: [graphics.quadOfRect(rect)],
      rect,
      text: contentsOf(annotation),
      author: String(annotation.titleObj?.str ?? ''),
    };
  }

  // 表示のみ。一覧に出す・消すのに要る欄だけ持ち、紙の上では pdf.js が描く（spec-4-4 確定事項16・20）。
  function readonlyEntry(annotation, src) {
    if (!MARKUP_SUBTYPES.includes(annotation.subtype) || annotation.id === undefined || !isRect(annotation.rect))
      return null;
    const rect = roundRect(annotation.rect);
    return {
      ref: annotation.id,
      src,
      kind: 'other',
      subtype: annotation.subtype,
      color: annotation.color === null || annotation.color === undefined ? '#8b93a1' : hexOf(annotation.color),
      opacity: 1,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
      rect,
      text: contentsOf(annotation),
      author: String(annotation.titleObj?.str ?? ''),
      readonly: true,
    };
  }

  // 自前で描ける形にする。拾えない markup 注釈は表示のみの entry、それ以外は null。
  function importedEntry(annotation, src) {
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
      return importedShape(annotation, src);
    const quads = quadsOf(annotation.quadPoints);
    if (quads.length === 0)
      return null;
    return {
      ref: annotation.id,
      src,
      kind,
      color: hexOf(annotation.color),
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      quads,
      rect: [...(annotation.rect ?? root.SigK.markupQuads.unionRect(quads))],
    };
  }

  // 文書のテキストマークアップを全ページから集め、pdf.js に描かせない印を付ける
  // （事前調査 B ①）。1,000 ページで 0.1 秒（事前調査 A）。集め終えたら映す。
  // 待っている間に別の文書へ移っていたら捨てる（isCurrent）。
  async function importDocument(doc, isCurrent = () => true) {
    if (doc === null || doc === undefined || typeof doc.getPage !== 'function')
      return null;
    const imported = {};
    for (let number = 1; number <= doc.numPages; number += 1) {
      let annotations;
      try {
        const page = await doc.getPage(number);
        annotations = typeof page.getAnnotations === 'function' ? await page.getAnnotations() : [];
      } catch {
        annotations = [];
      }
      if (!isCurrent())
        return null;
      const entries = annotations.map((annotation) => importedEntry(annotation, number - 1)).filter((entry) => entry !== null);
      if (entries.length === 0)
        continue;
      imported[number - 1] = entries;
      for (const entry of entries) {
        if (entry.readonly !== true)
          doc.annotationStorage?.setValue?.(entry.ref, { noView: true });
      }
    }
    root.SigK.viewer?.setImported(imported, { rerender: Object.keys(imported).map(Number) });
    // 自前のテキストがあれば画面のフォントを先読みする（spec-4-2 確定事項33）。
    if (Object.values(imported).some((entries) => entries.some((entry) => entry.kind === 'text')))
      root.SigK.freeTextShape?.ensureLoaded(root.document);
    return imported;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationImport = { SUBTYPES, MARKUP_SUBTYPES, OWN_FONT_NAME, hexOf, quadsOf, importedEntry, importDocument };
})(typeof window !== 'undefined' ? window : globalThis);
