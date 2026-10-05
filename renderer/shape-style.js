(function (root) {
  'use strict';

  // 図形の見た目（線の色・塗り・線種・破線の間隔・雲形の強さ）の純粋層（spec-4b-1b 確定事項16〜21・32・33・35）。DOM に触れない。
  // annotation-entry.js が 1 件の検証・写し・比較・保存の形に使い、描く側（shape-graphics.js）が破線の間隔と雲形の強さを引く。
  //
  //   四角・丸   … color は '#rrggbb' か null（線なし。そのときは fill が要る）、fill は '#rrggbb' か null（塗りなし）、
  //                lineStyle は 'solid'・'dashed'・'cloudy'
  //   直線・矢印・×印 … color は '#rrggbb'、lineStyle は 'solid'・'dashed'
  //   多角形     … 閉じたものは四角・丸と同じく塗りと線なしを持て、lineStyle は 'solid'・'dashed'（spec-4b-5a 確定事項3）
  //   ほかの種類 … 線種と塗りを持たない（実線）
  //   dash           … 'dashed' のときだけ持つ、線の太さに対する倍数の配列（読み込んだ間隔。無ければ 3:2）
  //   cloudIntensity … 'cloudy' のときだけ持つ強さ（0 より大きく 2 以下。SigK PDF で描く雲形は 1）
  // 無い欄は、fill が null・lineStyle が 'solid'・雲形の強さが 1 として扱う（今までの書き込みはこの形のまま読める）。

  const BOXED_KINDS = Object.freeze(['square', 'circle']);
  // 実線と破線を選べる種類（直線・矢印、×印・多角形は spec-4b-5a 確定事項2・3）。
  const LINE_KINDS = Object.freeze(['line', 'arrow', 'cross', 'polygon']);
  // 塗りと線なしを持てる種類（多角形は閉じたものだけ。canFill が 1 件で見る。spec-4b-5a 確定事項5）。
  const FILLABLE_KINDS = Object.freeze(['square', 'circle', 'polygon']);
  const LINE_STYLES = Object.freeze(['solid', 'dashed', 'cloudy']);
  const LINE_STYLES_OF_LINES = Object.freeze(['solid', 'dashed']);
  const SOLID_ONLY = Object.freeze(['solid']);
  // 破線の既定の倍数（線の 3 倍の長さと 2 倍の間。事前調査 H）と、読み込んだ間隔の受け取れる範囲（確定事項21）。
  const DEFAULT_DASH = Object.freeze([3, 2]);
  const DASH_ITEMS_MAX = 8;
  const DASH_RATIO_MAX = 100;
  const DASH_SUM_MIN = 0.1;
  const DEFAULT_CLOUD_INTENSITY = 1;
  const CLOUD_INTENSITY_MAX = 2;
  const HEX = /^#[0-9a-f]{6}$/i;

  function isBoxedKind(kind) {
    return BOXED_KINDS.includes(kind);
  }

  // 塗りと線なしを持てるかもしれない種類（多角形は閉じているかを canFill で見る）。
  function isFillableKind(kind) {
    return FILLABLE_KINDS.includes(kind);
  }

  // この書き込みが塗りと線なしを持てるか（四角・丸と、閉じた多角形。spec-4b-5a 確定事項5）。
  function canFill(entry) {
    return isBoxedKind(entry?.kind) || (entry?.kind === 'polygon' && entry.closed === true);
  }

  // 種類ごとに選べる線種。
  function lineStylesOf(kind) {
    if (isBoxedKind(kind))
      return LINE_STYLES;
    return LINE_KINDS.includes(kind) ? LINE_STYLES_OF_LINES : SOLID_ONLY;
  }

  function isHexColor(value) {
    return typeof value === 'string' && HEX.test(value);
  }

  function fillOf(entry) {
    return entry.fill ?? null;
  }

  function lineStyleOf(entry) {
    return entry.lineStyle ?? 'solid';
  }

  function cloudIntensityOf(entry) {
    return entry.cloudIntensity ?? DEFAULT_CLOUD_INTENSITY;
  }

  function validDash(dash) {
    return Array.isArray(dash) && dash.length >= 1 && dash.length <= DASH_ITEMS_MAX
      && dash.every((value) => Number.isFinite(value) && value >= 0 && value <= DASH_RATIO_MAX)
      && dash.reduce((sum, value) => sum + value, 0) >= DASH_SUM_MIN;
  }

  function validCloudIntensity(value) {
    return Number.isFinite(value) && value > 0 && value <= CLOUD_INTENSITY_MAX;
  }

  // 線の色の欄。線なし（null）は塗りを持てる図形で塗りがあるときだけ。
  function validStroke(entry) {
    if (entry.color === null)
      return canFill(entry) && isHexColor(fillOf(entry));
    return typeof entry.color === 'string';
  }

  // 見た目の欄の組み合わせが正しいか（線と塗りを両方なしにはできない。線種は種類で選べるもの。確定事項16〜18）。
  // 塗りを持てるのは四角・丸とテキスト（テキストの塗りは spec-4b-4a 確定事項A1）。
  function validStyle(entry) {
    const fill = fillOf(entry);
    const fillable = canFill(entry) || entry.kind === 'text';
    if (!validStroke(entry) || (fill !== null && (!fillable || !isHexColor(fill))))
      return false;
    const lineStyle = lineStyleOf(entry);
    if (!lineStylesOf(entry.kind).includes(lineStyle))
      return false;
    if (entry.dash !== undefined && (lineStyle !== 'dashed' || !validDash(entry.dash)))
      return false;
    return entry.cloudIntensity === undefined || (lineStyle === 'cloudy' && validCloudIntensity(entry.cloudIntensity));
  }

  // 見た目の欄のうち、持っているものだけを写す。
  function copyStyle(entry, copy) {
    if (entry.fill !== undefined)
      copy.fill = entry.fill;
    if (entry.lineStyle !== undefined)
      copy.lineStyle = entry.lineStyle;
    if (entry.dash !== undefined)
      copy.dash = [...entry.dash];
    if (entry.cloudIntensity !== undefined)
      copy.cloudIntensity = entry.cloudIntensity;
    return copy;
  }

  function sameDash(a, b) {
    if (a === undefined || b === undefined)
      return a === b;
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  // 見た目が同じか。無い欄は既定の値として比べる（lineStyle が無いものと 'solid' のものは同じ）。
  function sameStyle(a, b) {
    return fillOf(a) === fillOf(b) && lineStyleOf(a) === lineStyleOf(b) && sameDash(a.dash, b.dash)
      && (lineStyleOf(a) !== 'cloudy' || cloudIntensityOf(a) === cloudIntensityOf(b));
  }

  // 線種を替えた書き込み。読み込んだ間隔と強さは捨て、雲形にしたときの強さは 1 にする（確定事項18）。同じ線種なら替えない。
  function restyle(entry, lineStyle) {
    if (lineStyleOf(entry) === lineStyle)
      return { ...entry, lineStyle };
    const next = { ...entry, lineStyle };
    delete next.dash;
    delete next.cloudIntensity;
    if (lineStyle === 'cloudy')
      next.cloudIntensity = DEFAULT_CLOUD_INTENSITY;
    return next;
  }

  // ワーカーへ渡す見た目の欄（確定事項35）。既定と違うものだけを載せる（塗りなし・実線は載せない）。
  function saveStyle(entry) {
    const saved = {};
    if (fillOf(entry) !== null)
      saved.fill = entry.fill;
    const lineStyle = lineStyleOf(entry);
    if (lineStyle === 'solid')
      return saved;
    saved.lineStyle = lineStyle;
    if (lineStyle === 'dashed' && entry.dash !== undefined)
      saved.dash = [...entry.dash];
    if (lineStyle === 'cloudy')
      saved.cloudIntensity = cloudIntensityOf(entry);
    return saved;
  }

  // 描くときの破線の間隔（pt）。破線でなければ null。倍数に線の太さを掛ける（確定事項32）。
  function dashOf(entry) {
    if (lineStyleOf(entry) !== 'dashed')
      return null;
    return (entry.dash ?? DEFAULT_DASH).map((ratio) => ratio * entry.lineWidth);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeStyle = {
    BOXED_KINDS,
    FILLABLE_KINDS,
    LINE_STYLES,
    DEFAULT_DASH,
    DEFAULT_CLOUD_INTENSITY,
    isBoxedKind,
    isFillableKind,
    canFill,
    lineStylesOf,
    isHexColor,
    fillOf,
    lineStyleOf,
    cloudIntensityOf,
    validDash,
    validCloudIntensity,
    validStyle,
    copyStyle,
    sameStyle,
    restyle,
    saveStyle,
    dashOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
