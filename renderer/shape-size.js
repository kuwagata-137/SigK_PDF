(function (root) {
  'use strict';

  // 四角・丸・×印の大きさ（幅・高さ）の数値欄の純粋層（spec-7-9 確定事項D1〜D3）。DOM に触れない。
  //
  // 幅と高さは、回す前の箱（entry.rect）の幅と高さ（pt）。数値を入力すると、箱の中心を保ったまま大きさを変える。回した図形も
  // 回転の中心（箱の中心）が動かないので、紙の上の位置はそのまま。keep（「縦横比を固定」にチェック）の時は、入力していない側を
  // 今の縦横比で変える。範囲は SIZE_MIN（ハンドルの最小と同じ 1pt）〜 SIZE_MAX で、外になる値は当てない（null）。

  const BOX_KINDS = Object.freeze(['square', 'circle', 'cross']);
  // PDF のページの大きさの上限（200 インチ）。これより大きい図形は作らない。
  const SIZE_MAX = 14400;

  function geometry() {
    return root.SigK.shapeGeometry;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function isBoxKind(kind) {
    return BOX_KINDS.includes(kind);
  }

  // 回す前の箱の幅と高さ（丸めない）。
  function sizeOf(entry) {
    const [x1, y1, x2, y2] = entry.rect;
    return { width: x2 - x1, height: y2 - y1 };
  }

  // 数値欄に表示する値（小数 1 桁）。
  function shownOf(value) {
    // 引き算の誤差（650.3 − 420.05 = 230.2499…）で、同じ長さの幅と高さの表示が 0.1 ずれないように、先に小数 2 桁へ丸める。
    return String(Math.round(round(value) * 10) / 10);
  }

  function inRange(value) {
    return Number.isFinite(value) && value >= geometry().MIN_SIDE && value <= SIZE_MAX;
  }

  // 入力した欄の新しい幅と高さ（小数 2 桁）。keep なら、入力していない側を今の縦横比で変える。
  function nextSizeOf(entry, field, value, keep) {
    const { width, height } = sizeOf(entry);
    if (field === 'width')
      return { width: round(value), height: round(keep ? value * height / width : height) };
    return { width: round(keep ? value * width / height : width), height: round(value) };
  }

  // 幅（field 'width'）か高さ（'height'）を value にした形の patch。四角・丸・×印でないか、範囲の外になれば null。
  function sizedTo(entry, field, value, { keep = false } = {}) {
    if (!isBoxKind(entry?.kind) || (field !== 'width' && field !== 'height') || !inRange(value))
      return null;
    const { width, height } = nextSizeOf(entry, field, value, keep);
    if (!inRange(width) || !inRange(height))
      return null;
    const [cx, cy] = root.SigK.shapeRotation.centerOf(entry.rect);
    const x1 = round(cx - width / 2);
    const y1 = round(cy - height / 2);
    return geometry().rectOfEntry(entry, { rect: [x1, y1, round(x1 + width), round(y1 + height)] });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeSize = { BOX_KINDS, SIZE_MAX, isBoxKind, sizeOf, shownOf, sizedTo };
})(typeof window !== 'undefined' ? window : globalThis);
