(function (root) {
  'use strict';

  // 図形・ペン（Square・Circle・Ink と 2 点の PolyLine）の 1 件を自前の形にする純粋層（spec-4-3 確定事項13）。
  // imported-entry.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。拾えなければ null を返し、
  // imported-entry.js が表示のみの entry にする。値の変換は imported-values.js。

  // pdf.js の subtype → 種類（PolyLine は頂点と矢じりで line／arrow に分ける）。
  const SHAPE_KINDS = Object.freeze({ Square: 'square', Circle: 'circle', Ink: 'ink' });

  function values() {
    return root.SigK.importedValues;
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
    const kind = annotation.subtype === 'PolyLine' ? polylineKind(annotation) : SHAPE_KINDS[annotation.subtype];
    if (kind === null || kind === undefined || !values().isRect(annotation.rect) || annotation.color === null || annotation.color === undefined)
      return null;
    const paths = pathsOf(kind, annotation);
    if (paths === null)
      return null;
    const rect = values().roundRect(annotation.rect);
    const width = annotation.borderStyle?.width;
    const entry = {
      ref: annotation.id,
      src,
      kind,
      color: values().hexOf(annotation.color),
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      lineWidth: Number.isFinite(width) && width > 0 ? width : 1,
      rect,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
    };
    if (paths !== undefined)
      entry.paths = paths;
    return entry;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedShape = { importedShape };
})(typeof window !== 'undefined' ? window : globalThis);
