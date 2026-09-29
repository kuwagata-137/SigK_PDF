(function (root) {
  'use strict';

  // 図形・ペン（Square・Circle・Ink と 2 点の PolyLine）の 1 件を自前の形にする純粋層（spec-4-3 確定事項13）。
  // imported-entry.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。拾えなければ null を返し、
  // imported-entry.js が表示のみの entry にする。値の変換は imported-values.js。

  // pdf.js の subtype → 種類（PolyLine は頂点と矢じりで line／arrow に分ける）。
  const SHAPE_KINDS = Object.freeze({ Square: 'square', Circle: 'circle', Ink: 'ink' });

  // pdf.js の線の形（AnnotationBorderStyleType）。1 が実線、2 が破線、3〜5 は立体と下線。
  const SOLID_STYLE = 1;

  function values() {
    return root.SigK.importedValues;
  }

  // 線幅。pdf.js は線幅が /Rect の幅か高さの半分を超えると width を 1 に置き換え、元の値を rawWidth に残す
  // （spec-4b-1a 確定事項24。事前調査 A）。width が 0 なら線なしで 0。borderStyle が無ければ 1。
  function lineWidthOf(style) {
    const width = style?.width;
    if (!Number.isFinite(width))
      return 1;
    if (width <= 0)
      return 0;
    return Number.isFinite(style.rawWidth) && style.rawWidth > 0 ? style.rawWidth : width;
  }

  // 実線か。線の形が無ければ実線とみなす（pdf.js の既定）。
  function isSolidLine(style) {
    return style?.style === undefined || style.style === SOLID_STYLE;
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
    const lineWidth = lineWidthOf(annotation.borderStyle);
    // 線幅 0 と実線でない線は、SigK PDF がまだ同じ見た目に描けないので拾わない（imported-entry.js が表示のみにする。
    // spec-4b-1a 確定事項24）。今までは直せる図形として読み、実線・線幅 1 で描き直していた。
    if (lineWidth === 0 || !isSolidLine(annotation.borderStyle))
      return null;
    const entry = {
      ref: annotation.id,
      src,
      kind,
      color: values().hexOf(annotation.color),
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      lineWidth,
      rect,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
    };
    if (paths !== undefined)
      entry.paths = paths;
    return entry;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedShape = { importedShape, lineWidthOf, isSolidLine };
})(typeof window !== 'undefined' ? window : globalThis);
