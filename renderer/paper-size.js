(function (root) {
  'use strict';

  // 用紙の定義（spec-3-1 確定事項10〜14）。純関数で、画面にもワーカーにも触れない。
  //
  // 単位は pt（1pt = 1/72 インチ）。A 列・B 列は JIS の mm 値を pt に直したもので、
  // A4 は op-insert.js が差し込みの逃げ場に使う値と同じである。
  // 「画像サイズに合わせる」は寸法を持たない。1px = 1pt で画像から決める（ユーザー確定②）。

  const PT_PER_MM = 72 / 25.4;

  const PAPERS = {
    a4: { label: 'A4', width: 595.28, height: 841.89 },
    a3: { label: 'A3', width: 841.89, height: 1190.55 },
    b5: { label: 'B5', width: 515.91, height: 728.50 },       // JIS B5（182×257mm）
    letter: { label: 'レター', width: 612, height: 792 },
    image: { label: '画像サイズ' },
  };

  const MARGINS = {
    none: { label: 'なし', mm: 0 },
    narrow: { label: '狭い', mm: 10 },
    normal: { label: '標準', mm: 20 },
  };

  const ORIENTATIONS = { auto: '自動', portrait: '縦', landscape: '横' };

  function mmToPt(mm) {
    return mm * PT_PER_MM;
  }

  function isPaper(paper) {
    return Object.prototype.hasOwnProperty.call(PAPERS, paper);
  }

  function isMargin(margin) {
    return Object.prototype.hasOwnProperty.call(MARGINS, margin);
  }

  function isOrientation(orientation) {
    return Object.prototype.hasOwnProperty.call(ORIENTATIONS, orientation);
  }

  // 「自動」は画像の幅が高さより大きければ横、それ以外（正方形を含む）は縦（確定事項13）。
  function resolveOrientation(orientation, pixels) {
    if (orientation === 'portrait' || orientation === 'landscape')
      return orientation;
    return pixels?.width > pixels?.height ? 'landscape' : 'portrait';
  }

  // 用紙と向きから紙の寸法を返す。横なら幅と高さを入れ替える。「画像サイズ」は null。
  function paperSize(paper, orientation) {
    const spec = PAPERS[paper];
    if (spec === undefined || spec.width === undefined)
      return null;
    return orientation === 'landscape'
      ? { width: spec.height, height: spec.width }
      : { width: spec.width, height: spec.height };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.paperSize = { PT_PER_MM, PAPERS, MARGINS, ORIENTATIONS, mmToPt, isPaper, isMargin, isOrientation, resolveOrientation, paperSize };
})(typeof window !== 'undefined' ? window : globalThis);
