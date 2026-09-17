(function (root) {
  'use strict';

  // ファイルにある注釈のうち自前で描くものを集める層（spec-4-1 確定事項17・18、spec-4-2 確定事項13）。
  //
  // pdf.js の getAnnotations() から Highlight／Underline／StrikeOut と、自分で付けた FreeText
  // （/DA のフォント名が SigKJP のもの）だけを拾い、自前の層で描ける形
  // { ref, src, kind, color, opacity, quads, rect（テキストは text・fontSize・rotation も）} にする。
  // pdf.js には描かせない印（annotationStorage の noView。事前調査 B ①）もここで付ける。
  // 他のツールが作った FreeText は拾わず、pdf.js が描く（表示のみ。論点8）。
  // 集めたものは編集ではないので履歴には入らない。viewer.setImported() へ渡すだけ。

  // pdf.js の subtype → 種類。
  const SUBTYPES = Object.freeze({ Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', FreeText: 'text' });
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

  function importedEntry(annotation, src) {
    const kind = SUBTYPES[annotation.subtype];
    if (kind === undefined || annotation.id === undefined)
      return null;
    if (kind === 'text')
      return importedText(annotation, src);
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
      for (const entry of entries)
        doc.annotationStorage?.setValue?.(entry.ref, { noView: true });
    }
    root.SigK.viewer?.setImported(imported, { rerender: Object.keys(imported).map(Number) });
    // 自前のテキストがあれば画面のフォントを先読みする（spec-4-2 確定事項33）。
    if (Object.values(imported).some((entries) => entries.some((entry) => entry.kind === 'text')))
      root.SigK.freeTextShape?.ensureLoaded(root.document);
    return imported;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationImport = { SUBTYPES, OWN_FONT_NAME, hexOf, quadsOf, importedEntry, importDocument };
})(typeof window !== 'undefined' ? window : globalThis);
