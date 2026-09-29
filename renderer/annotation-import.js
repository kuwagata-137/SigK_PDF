(function (root) {
  'use strict';

  // ファイルにある注釈のうち自前で描くものを集める層（spec-4-1 確定事項17・18、spec-4-2 確定事項13、
  // spec-4-3 確定事項13、spec-4-4 確定事項20）。
  //
  // pdf.js の getAnnotations() を全ページから集め、1 件ずつ imported-entry.js で自前の形にし、
  // pdf.js には描かせない印（annotationStorage の noView。事前調査 B ①）を付ける。表示のみの entry には
  // 付けない（pdf.js が描き続ける）。集めたものは編集ではないので履歴には入らない。viewer.setImported() へ渡すだけ。

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
      const entries = annotations.map((annotation) => root.SigK.importedEntry.importedEntry(annotation, number - 1)).filter((entry) => entry !== null);
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
  SigK.annotationImport = { importDocument };
})(typeof window !== 'undefined' ? window : globalThis);
