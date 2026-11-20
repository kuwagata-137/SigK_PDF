(function (root) {
  'use strict';

  // 塗りの透明度とハッチングの欄の純粋層（spec-7-9 確定事項B2・B4・C1〜C4）。DOM に触れない。shape-style.js が検証・写し・比較・
  // 保存の形に使い、描く側（shape-graphics.js・fill-apart-graphics.js）が塗りつぶしの不透明度とハッチングを引く。
  //
  //   fillOpacity … 塗りつぶしの不透明度（0 より大きく 1 以下。画面から入るのは 0.1〜1）。無ければ opacity と同じ値として扱う。
  //                 opacity は枠線の不透明度として残す（B2）
  //   hatch       … { pattern, color: '#rrggbb', gap: pt, width: pt }。なしは持たない（null も受けるが、当てるときに消す）
  // どちらも塗りを持てる書き込み（四角・丸と、閉じた多角形。shape-style.js の canFill）だけが持てる（C4）。
  // worker/fill-style-rules.js が同じ決まりを持ち、一致はテストで見張る。

  const HATCH_PATTERNS = Object.freeze(['diagonal', 'reverse', 'cross', 'horizontal', 'vertical', 'grid']);
  // ハッチング間隔（pt）とハッチング線幅（pt）の範囲と既定（C3）。色の既定は図形の線の色の既定と同じ。
  const HATCH_GAP_MIN = 1;
  const HATCH_GAP_MAX = 50;
  const HATCH_WIDTH_MIN = 0.25;
  const HATCH_WIDTH_MAX = 10;
  const DEFAULT_HATCH = Object.freeze({ pattern: 'diagonal', color: '#ff0000', gap: 6, width: 1 });
  const HEX = /^#[0-9a-f]{6}$/i;

  function canFill(entry) {
    return root.SigK.shapeStyle.canFill(entry);
  }

  function validFillOpacity(value) {
    return Number.isFinite(value) && value > 0 && value <= 1;
  }

  function validHatch(hatch) {
    return typeof hatch === 'object' && hatch !== null && HATCH_PATTERNS.includes(hatch.pattern)
      && typeof hatch.color === 'string' && HEX.test(hatch.color)
      && Number.isFinite(hatch.gap) && hatch.gap >= HATCH_GAP_MIN && hatch.gap <= HATCH_GAP_MAX
      && Number.isFinite(hatch.width) && hatch.width >= HATCH_WIDTH_MIN && hatch.width <= HATCH_WIDTH_MAX;
  }

  // 塗りつぶしの不透明度。持たないものは opacity（それも無ければ 1）。
  function fillOpacityOf(entry) {
    return entry?.fillOpacity ?? entry?.opacity ?? 1;
  }

  function hatchOf(entry) {
    return entry?.hatch ?? null;
  }

  // 欄の形。持てない書き込みが持っていれば崩れている。
  function validFillFields(entry) {
    if (entry.fillOpacity !== undefined && !(canFill(entry) && validFillOpacity(entry.fillOpacity)))
      return false;
    const hatch = hatchOf(entry);
    return hatch === null || (canFill(entry) && validHatch(hatch));
  }

  function copyFillFields(entry, copy) {
    if (entry.fillOpacity !== undefined)
      copy.fillOpacity = entry.fillOpacity;
    if (hatchOf(entry) !== null)
      copy.hatch = { ...entry.hatch };
    return copy;
  }

  function sameHatch(a, b) {
    if (a === null || b === null)
      return a === b;
    return a.pattern === b.pattern && a.color === b.color && a.gap === b.gap && a.width === b.width;
  }

  // 見た目が同じか。fillOpacity を持たないものは opacity と同じ値として比べる。
  function sameFillFields(a, b) {
    return fillOpacityOf(a) === fillOpacityOf(b) && sameHatch(hatchOf(a), hatchOf(b));
  }

  // ワーカーへ渡す欄。塗りを持てる書き込みの、持っている欄だけ。
  function saveFillFields(entry) {
    if (!canFill(entry))
      return {};
    const saved = entry.fillOpacity === undefined ? {} : { fillOpacity: entry.fillOpacity };
    if (hatchOf(entry) !== null)
      saved.hatch = { ...entry.hatch };
    return saved;
  }

  // 塗りと枠線を分けて描くか（B4・B5）。ハッチングがあるか、塗りつぶしと枠線の不透明度が違う時。同じ値でハッチングが無ければ、
  // 今までどおり図形全体を 1 つの絵として薄める。
  function paintsApart(entry) {
    if (!canFill(entry))
      return false;
    return hatchOf(entry) !== null || fillOpacityOf(entry) !== (entry.opacity ?? 1);
  }

  // 枠線の不透明度を変える時に、持っていない塗りつぶしの不透明度を今の値で残す欄（枠線だけが変わるように。B2）。
  function keepFillOpacity(entry) {
    return canFill(entry) && entry.fillOpacity === undefined ? { fillOpacity: entry.opacity ?? 1 } : {};
  }

  // ハッチングの一部（種類・色・間隔・線幅）を当てた後のハッチング。種類 'none' はなし（null）。今がなしで種類を指定しなければ、
  // なしのまま。足りない欄は base（次に付ける値の記憶）で埋める。
  function mergeHatch(current, partial, base = DEFAULT_HATCH) {
    if (partial.pattern === 'none')
      return null;
    if (current === null && partial.pattern === undefined)
      return null;
    const from = current ?? { ...DEFAULT_HATCH, ...base };
    return {
      pattern: partial.pattern ?? from.pattern,
      color: (partial.color ?? from.color).toLowerCase(),
      gap: partial.gap ?? from.gap,
      width: partial.width ?? from.width,
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.fillStyle = {
    HATCH_PATTERNS,
    HATCH_GAP_MIN,
    HATCH_GAP_MAX,
    HATCH_WIDTH_MIN,
    HATCH_WIDTH_MAX,
    DEFAULT_HATCH,
    validFillOpacity,
    validHatch,
    fillOpacityOf,
    hatchOf,
    validFillFields,
    copyFillFields,
    sameFillFields,
    saveFillFields,
    paintsApart,
    keepFillOpacity,
    mergeHatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
