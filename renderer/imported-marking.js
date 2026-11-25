(function (root) {
  'use strict';

  // 読み込んだ丸の注釈のうち、外観にマーキングの値（マーク付き内容の属性 /MK）を持つものを、マーキングの書き込みに組み直す層
  // （spec-7-9 確定事項F6。読み戻し）。口の答えの欄は worker/appearance-marking.js の markingOf（{ shape, outer, dot, ring, cross,
  // fontSize, number? } か null）。
  //
  // 丸として組んだ書き込み（imported-shape.js）の線の色・線の太さと、辞書の /CA を使い、位置は /Rect の中心にする。値が範囲の外の
  // ものと、線の色が無いものは組み直さず、今までどおり丸として扱う（annotation-details.js の applyDetails が続きを見る）。

  function geometry() {
    return root.SigK.markingGeometry;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // 1 件をマーキングにした形。組み直せなければ null。
  function withMarking(entry, detail) {
    const raw = detail?.marking ?? null;
    if (entry?.kind !== 'circle' || raw === null || typeof entry.color !== 'string' || !Array.isArray(entry.rect))
      return null;
    const marking = { shape: raw.shape, outer: raw.outer, dot: raw.dot, ring: raw.ring, cross: raw.cross, fontSize: raw.fontSize };
    if (raw.number !== undefined)
      marking.number = raw.number;
    if (!root.SigK.markingRules.validMarking(marking))
      return null;
    const opacity = Number.isFinite(detail.ca) && detail.ca > 0 ? Math.min(1, detail.ca) : 1;
    const next = {
      ref: entry.ref, src: entry.src, kind: 'marking', color: entry.color, opacity, lineWidth: entry.lineWidth, text: '', marking,
      ...geometry().frameOf(marking, geometry().centerOf(entry.rect).map(round)),
    };
    return root.SigK.annotationEntry.validEntry(next) ? next : null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedMarking = { withMarking };
})(typeof window !== 'undefined' ? window : globalThis);
