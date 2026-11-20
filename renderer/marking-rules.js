(function (root) {
  'use strict';

  // マーキングの値（形と大きさ）の決まりの純粋層（spec-7-9 確定事項F。決定100 ⑥）。DOM に触れない。
  //
  // マーキングの書き込みは { kind: 'marking', color, opacity, lineWidth, rect, quads, text: '', marking } の形で、marking は
  //   { shape, outer, dot, ring, cross, fontSize, number? }
  //   shape    … 形。'target'（点付き丸）・'double'（二重丸）・'crosshair'（照準）・'number'（番号付き丸）・'caution'（注意マーク）
  //   outer    … 外の円の直径（pt。線の外側の縁まで）。注意マークでは三角形の幅
  //   dot      … 点付き丸の中の円の直径（pt。塗る）
  //   ring     … 二重丸の中の円の直径（pt。線の外側の縁まで）
  //   cross    … 照準の十字線の長さ（pt）
  //   fontSize … 番号付き丸の文字サイズ（pt）
  //   number   … 番号付き丸の番号（1〜9999 の整数）。番号付き丸だけが持つ
  // 形を替えても大きさが崩れないように、形ごとの大きさを別々に持つ（Claude の判断）。位置は rect の中心（marking-geometry.js）。
  // 範囲と既定は marking-settings.js（メイン側の記憶）と同じであること（test/marking-settings.test.js が一致を見張る）。

  const SHAPES = Object.freeze(['target', 'double', 'crosshair', 'number', 'caution']);
  const SHAPE_LABELS = Object.freeze({ target: '点付き丸', double: '二重丸', crosshair: '照準', number: '番号付き丸', caution: '注意マーク' });
  const SIZE_FIELDS = Object.freeze(['outer', 'dot', 'ring', 'cross', 'fontSize']);
  // 大きさの範囲（pt）。Claude の判断。外の円は 4〜720（10 インチ）、中の円は 1 から外の円まで、十字線は 4〜1440、文字サイズは 4〜200。
  const RANGES = Object.freeze({
    outer: Object.freeze([4, 720]),
    dot: Object.freeze([1, 720]),
    ring: Object.freeze([1, 720]),
    cross: Object.freeze([4, 1440]),
    fontSize: Object.freeze([4, 200]),
  });
  const NUMBER_MAX = 9999;
  // 既定（確定事項F3）。十字線は外の円の直径の 1.4 倍。
  const DEFAULTS = Object.freeze({ shape: 'target', outer: 32, dot: 9, ring: 16, cross: 44.8, fontSize: 16 });
  const DEFAULT_LINE_WIDTH = 3;
  const DEFAULT_COLOR = '#ff0000';
  // 中の円のハンドルが変える欄（注意マークは無い）。中の円（dot・ring）は外の円より大きくしない。
  const INNER_FIELDS = Object.freeze({ target: 'dot', double: 'ring', crosshair: 'cross', number: 'fontSize' });

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function isShape(value) {
    return SHAPES.includes(value);
  }

  function inRange(field, value) {
    const [min, max] = RANGES[field];
    return Number.isFinite(value) && value >= min && value <= max;
  }

  function isNumber(value) {
    return Number.isInteger(value) && value >= 1 && value <= NUMBER_MAX;
  }

  // 1 件の marking の形。番号は番号付き丸だけが持ち、中の円は外の円以下。
  function validMarking(marking) {
    if (marking === null || typeof marking !== 'object' || !isShape(marking.shape))
      return false;
    if (!SIZE_FIELDS.every((field) => inRange(field, marking[field])))
      return false;
    if (marking.dot > marking.outer || marking.ring > marking.outer)
      return false;
    return marking.shape === 'number' ? isNumber(marking.number) : marking.number === undefined;
  }

  function copyMarking(marking) {
    const copy = { shape: marking.shape };
    for (const field of SIZE_FIELDS)
      copy[field] = marking[field];
    if (marking.number !== undefined)
      copy.number = marking.number;
    return copy;
  }

  function sameMarking(a, b) {
    if (a === undefined || b === undefined)
      return a === b;
    return a.shape === b.shape && a.number === b.number && SIZE_FIELDS.every((field) => a[field] === b[field]);
  }

  // 形を替えた marking。番号付き丸にするなら number を付け（今の番号が無ければ渡された番号）、ほかの形にするなら外す。
  function withShape(marking, shape, number) {
    const next = { ...copyMarking(marking), shape };
    delete next.number;
    if (shape === 'number')
      next.number = isNumber(marking.number) ? marking.number : number;
    return next;
  }

  // 大きさを 1 つ替えた marking。範囲の外・数でない値は null。外の円を中の円より小さくしたら、中の円も外の円に合わせる。
  // 中の円を外の円より大きくする値は null（数値欄では今の値に戻す。確定事項F4）。
  function withSize(marking, field, value) {
    if (!SIZE_FIELDS.includes(field) || !Number.isFinite(value))
      return null;
    const size = round(value);
    if (!inRange(field, size))
      return null;
    const next = { ...copyMarking(marking), [field]: size };
    if (field === 'outer') {
      next.dot = Math.min(next.dot, size);
      next.ring = Math.min(next.ring, size);
    }
    return next.dot > next.outer || next.ring > next.outer ? null : next;
  }

  // ハンドルで大きさを替えた marking。範囲の端で止め、中の円は外の円で止める（数値欄と違い、null にしない）。
  function clampedSize(marking, field, value) {
    const [min, max] = RANGES[field];
    const limit = (field === 'dot' || field === 'ring') ? Math.min(max, marking.outer) : max;
    const size = round(Math.min(limit, Math.max(min, Number.isFinite(value) ? value : marking[field])));
    return withSize(marking, field, size) ?? copyMarking(marking);
  }

  // 番号を替えた marking。番号付き丸でないか、1〜9999 の整数でなければ null。
  function withNumber(marking, number) {
    if (marking.shape !== 'number' || !isNumber(number))
      return null;
    return { ...copyMarking(marking), number };
  }

  // 数値欄の行の並びと名前（形ごと。確定事項F4。名前は Claude の判断で spec-7-9 に書いた）。2 行目は、点付き丸・二重丸は中の円、
  // 照準は十字線の長さ、番号付き丸は文字サイズ。注意マークは三角形の幅の 1 行だけ。
  function sizeRowsOf(shape) {
    const outer = { field: 'outer', label: shape === 'caution' ? '三角形の幅' : '外の円の直径' };
    const field = INNER_FIELDS[shape];
    if (field === undefined)
      return [outer];
    const label = { dot: '中の円の直径', ring: '中の円の直径', cross: '十字線の長さ', fontSize: '文字サイズ' }[field];
    return [outer, { field, label }];
  }

  function innerFieldOf(shape) {
    return INNER_FIELDS[shape] ?? null;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingRules = {
    SHAPES,
    SHAPE_LABELS,
    SIZE_FIELDS,
    RANGES,
    NUMBER_MAX,
    DEFAULTS,
    DEFAULT_LINE_WIDTH,
    DEFAULT_COLOR,
    isShape,
    isNumber,
    inRange,
    validMarking,
    copyMarking,
    sameMarking,
    withShape,
    withSize,
    clampedSize,
    withNumber,
    sizeRowsOf,
    innerFieldOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
