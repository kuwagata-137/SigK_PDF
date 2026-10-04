(function (root) {
  'use strict';

  // 四角・丸の回転の純粋層（spec-4b-2 確定事項1〜7・19・29・32）。DOM にも pdf.js にも触れない。
  //
  // 角度は画面で時計回りの度で、回転の中心は回す前の箱の中心。紙の座標は y が上なので、点を回す式は
  // x' = cx + dx·cos + dy·sin、y' = cy − dx·sin + dy·cos（PDF の行列 [a b c d] では a=cos・b=−sin・c=sin・d=cos）になる。
  // 表示の座標（y が下）では同じ角度が rotate(角度) のまま時計回りに見える（ページの回転は 90° 刻みで向きを保つ。事前調査 A）。
  // 保存の /Matrix の式は worker/shape-rotation.js と同じで、一致はテストで見張る（プロセスが違うので読み込み合わない）。

  // 読み込んだ角度を整数とみなす差（確定事項1）。
  const INTEGER_TOLERANCE = 0.01;

  function round(value, digits = 2) {
    const scale = 10 ** digits;
    const rounded = Math.round(value * scale) / scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  // 0 以上 360 未満の小数 2 桁にする（整数との差が 0.01 未満なら整数）。数でなければ 0。
  function normalizeAngle(angle) {
    if (!Number.isFinite(angle))
      return 0;
    const value = round(((angle % 360) + 360) % 360);
    const nearest = Math.round(value);
    const snapped = Math.abs(value - nearest) < INTEGER_TOLERANCE ? nearest : value;
    return snapped >= 360 ? 0 : snapped;
  }

  // step 度の刻みにそろえる（Shift で 15°。確定事項19）。
  function snapAngle(angle, step) {
    return normalizeAngle(Math.round(angle / step) * step);
  }

  function angleOf(entry) {
    return normalizeAngle(entry?.angle ?? 0);
  }

  function isRotated(entry) {
    return angleOf(entry) !== 0;
  }

  function centerOf([x1, y1, x2, y2]) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  // 紙の座標の点を center まわりに、画面で時計回りに angle 度回す。
  function rotatePoint([x, y], [cx, cy], angle) {
    const t = (angle * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
  }

  // 表示の座標（y が下）の点を center まわりに、時計回りに angle 度回す。
  function rotateViewPoint([x, y], [cx, cy], angle) {
    const t = (angle * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  }

  // 回した箱の 4 隅（UL・UR・LL・LR。quadOfRect と同じ順）。
  function cornersOf(box, angle) {
    const [x1, y1, x2, y2] = box;
    const center = centerOf(box);
    return [[x1, y2], [x2, y2], [x1, y1], [x2, y1]].map((point) => rotatePoint(point, center, angle));
  }

  // 回した箱を 1 つの四角（8 つの数。小数 2 桁）にする（確定事項2）。
  function quadOf(box, angle) {
    return cornersOf(box, angle).flat().map((value) => round(value));
  }

  // 回した箱の外接 [minX minY maxX maxY]（小数 2 桁）。
  function boundsOf(box, angle) {
    const corners = cornersOf(box, angle);
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    return [round(Math.min(...xs)), round(Math.min(...ys)), round(Math.max(...xs)), round(Math.max(...ys))];
  }

  // 回した図形の上の点を、回す前の座標へ戻す（当たり判定・大きさ変え。確定事項15・16）。
  function toLocal(point, box, angle) {
    return rotatePoint(point, centerOf(box), -angle);
  }

  // 回す前の座標で組み直した新しい箱 next を、その中心を元の箱 box の中心まわりに angle 度回した位置へずらす（確定事項16）。
  // 回す前の座標で動かさなかった点は、紙の上でも動かない（大きさ変えの反対側、spec-4b-4b 確定事項B1 のテキストの左上）。
  // 丸めない（呼ぶ側が丸める）。回していなければ next の写し。
  function recentered(box, next, angle) {
    if (normalizeAngle(angle) === 0)
      return [...next];
    const center = rotatePoint(centerOf(next), centerOf(box), angle);
    const half = [(next[2] - next[0]) / 2, (next[3] - next[1]) / 2];
    return [center[0] - half[0], center[1] - half[1], center[0] + half[0], center[1] + half[1]];
  }

  // 保存の /Matrix（確定事項29）。cos・sin と移動は小数 4 桁。worker/shape-rotation.js の matrixOf と同じ式。
  function matrixOf(box, angle) {
    const t = (angle * Math.PI) / 180;
    const cos = round(Math.cos(t), 4);
    const sin = round(Math.sin(t), 4);
    const [cx, cy] = centerOf(box);
    const [a, b, c, d] = [cos, round(-sin, 4), sin, cos];
    return [a, b, c, d, round(cx - (a * cx + c * cy), 4), round(cy - (b * cx + d * cy), 4)];
  }

  // 画面の <g> に付ける transform（確定事項6）。回していなければ null。
  function svgTransformOf(entry, viewport) {
    const angle = angleOf(entry);
    if (angle === 0)
      return null;
    const [cx, cy] = viewport.convertToViewportPoint(...centerOf(entry.rect));
    return `rotate(${angle} ${round(cx)} ${round(cy)})`;
  }

  // 印刷の canvas を回す中心（表示の座標）と角度（確定事項7）。回していなければ null。
  function viewRotationOf(entry, viewport) {
    const angle = angleOf(entry);
    if (angle === 0)
      return null;
    return { angle, center: viewport.convertToViewportPoint(...centerOf(entry.rect)) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.shapeRotation = {
    normalizeAngle,
    snapAngle,
    angleOf,
    isRotated,
    centerOf,
    rotatePoint,
    rotateViewPoint,
    cornersOf,
    quadOf,
    boundsOf,
    toLocal,
    recentered,
    matrixOf,
    svgTransformOf,
    viewRotationOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
