(function (root) {
  'use strict';

  // ファイルにあるテキストマークアップを集める層（spec-4-1 確定事項17・18）。
  //
  // pdf.js の getAnnotations() から Highlight／Underline／StrikeOut だけを拾い、自前の
  // 層で描ける形 { ref, src, kind, color, opacity, quads, rect } にする。pdf.js には
  // 描かせない印（annotationStorage の noView。事前調査 B ①）もここで付ける。
  // 集めたものは編集ではないので履歴には入らない。viewer.setImported() へ渡すだけ。

  // pdf.js の subtype → 種類。
  const SUBTYPES = Object.freeze({ Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout' });

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

  function importedEntry(annotation, src) {
    const kind = SUBTYPES[annotation.subtype];
    if (kind === undefined || annotation.id === undefined)
      return null;
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
    return imported;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationImport = { SUBTYPES, hexOf, quadsOf, importedEntry, importDocument };
})(typeof window !== 'undefined' ? window : globalThis);
