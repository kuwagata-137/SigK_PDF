(function (root) {
  'use strict';

  // 図形・ペン（Square・Circle・Ink と 2 点の PolyLine）の 1 件を自前の形にする純粋層（spec-4-3 確定事項13）。
  // imported-entry.js から移した（spec-4b-1a 確定事項36。中身は変えていない）。拾えなければ null を返し、
  // imported-entry.js が表示のみの entry にする。値の変換は imported-values.js。

  // pdf.js の subtype → 種類（PolyLine は頂点と矢じりで line／arrow に分ける）。
  const SHAPE_KINDS = Object.freeze({ Square: 'square', Circle: 'circle', Ink: 'ink' });

  // pdf.js の線の形（AnnotationBorderStyleType）。1 が実線、2 が破線、3〜5 は立体と下線。
  const SOLID_STYLE = 1;
  const DASHED_STYLE = 2;
  const BOXED_KINDS = Object.freeze(['square', 'circle']);
  // 線の見えない四角・丸（線幅 0）を線なしで読むときの、線を戻したときの太さ（spec-4b-1b 確定事項19。既定の 2pt）。
  const RESTORE_LINE_WIDTH = 2;
  // 読んだ間隔を既定の 3:2 とみなす差（spec-4b-1b 確定事項37）。
  const DASH_TOLERANCE = 0.01;

  function values() {
    return root.SigK.importedValues;
  }

  function style() {
    return root.SigK.shapeStyle;
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
  function isSolidLine(borderStyle) {
    return borderStyle?.style === undefined || borderStyle.style === SOLID_STYLE;
  }

  // 破線の間隔を、線の太さに対する倍数にする（spec-4b-1b 確定事項37）。pdf.js は /BS /D と /Border の 4 つ目を dashArray に
  // まとめて返す（無ければ [3]）。3:2 と同じなら null（既定）、空の配列なら []（実線）、倍数が範囲の外なら undefined（描けない）。
  function dashRatiosOf(dashArray, width) {
    const dash = Array.from(dashArray ?? [3]);
    if (dash.length === 0)
      return [];
    const ratios = dash.map((value) => Math.round((value / width) * 1000) / 1000);
    if (!style().validDash(ratios))
      return undefined;
    const isDefault = ratios.length === 2 && Math.abs(ratios[0] - 3) <= DASH_TOLERANCE && Math.abs(ratios[1] - 2) <= DASH_TOLERANCE;
    return isDefault ? null : ratios;
  }

  // 線の色・太さ・線種（spec-4b-1b 確定事項36・37）。線の見えない四角・丸（/C が無いか線幅 0）は線なしの候補にし、塗りは
  // 口の答えで当てる（annotation-details.js。塗りも無ければ表示のみ）。ほかの種類で線が見えないもの、描けない線の形
  // （立体・下線、ペンの破線、範囲の外の間隔）は null。
  function lineFieldsOf(kind, annotation) {
    const width = lineWidthOf(annotation.borderStyle);
    const invisible = width === 0 || annotation.color === null || annotation.color === undefined;
    if (invisible)
      return BOXED_KINDS.includes(kind) ? { color: null, lineWidth: width === 0 ? RESTORE_LINE_WIDTH : width } : null;
    const fields = { color: values().hexOf(annotation.color), lineWidth: width };
    if (isSolidLine(annotation.borderStyle))
      return fields;
    if (annotation.borderStyle.style !== DASHED_STYLE || !style().lineStylesOf(kind).includes('dashed'))
      return null;
    const ratios = dashRatiosOf(annotation.borderStyle.dashArray, width);
    if (ratios === undefined)
      return null;
    if (ratios !== null && ratios.length === 0)
      return fields;
    return ratios === null ? { ...fields, lineStyle: 'dashed' } : { ...fields, lineStyle: 'dashed', dash: ratios };
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

  // 終点の矢じりの名前 → 矢印の先の形（spec-4b-5a 確定事項38）。開いた矢じりは head 'open'、塗った三角は head を持たない
  // （/IC が /C と同じ色かは口の答えで確かめる。annotation-details.js）。
  const ARROW_HEADS = Object.freeze({ OpenArrow: 'open', ClosedArrow: null });

  // PolyLine の種類。2 点で矢じりが無ければ直線、終点だけ開いた矢じりか塗った三角なら矢印。それ以外は拾わない。
  function polylineKind(annotation) {
    const [start, end] = annotation.lineEndings ?? ['None', 'None'];
    if (annotation.vertices?.length !== 4 || start !== 'None')
      return null;
    if (end === 'None')
      return 'line';
    return end in ARROW_HEADS ? 'arrow' : null;
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

  // 図形・ペン。/Rect・/C・/BS /W・破線の間隔と、/Vertices（PolyLine）・/InkList（Ink）から組む（spec-4-3 確定事項13、
  // spec-4b-1b 確定事項36・37）。塗り・雲形・/RD・不透明度は pdf.js が返さないので、口の答えで当てる（annotation-details.js）。
  function importedShape(annotation, src) {
    const kind = annotation.subtype === 'PolyLine' ? polylineKind(annotation) : SHAPE_KINDS[annotation.subtype];
    if (kind === null || kind === undefined || !values().isRect(annotation.rect))
      return null;
    const paths = pathsOf(kind, annotation);
    const line = lineFieldsOf(kind, annotation);
    if (paths === null || line === null)
      return null;
    const rect = values().roundRect(annotation.rect);
    const entry = {
      ref: annotation.id,
      src,
      kind,
      ...line,
      opacity: Number.isFinite(annotation.opacity) ? annotation.opacity : 1,
      rect,
      quads: [root.SigK.freeTextGeometry.quadOfRect(rect)],
    };
    if (paths !== undefined)
      entry.paths = paths;
    if (kind === 'arrow' && ARROW_HEADS[annotation.lineEndings[1]] === 'open')
      entry.head = 'open';
    return entry;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.importedShape = { importedShape, lineWidthOf, isSolidLine, dashRatiosOf };
})(typeof window !== 'undefined' ? window : globalThis);
