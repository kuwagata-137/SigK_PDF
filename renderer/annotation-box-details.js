(function (root) {
  'use strict';

  // 四角・丸の読み戻し（塗り・雲形・/RD・回転）を当てる純粋層（spec-4b-1b 確定事項36〜38、spec-4b-2 確定事項35）。
  // annotation-details.js から移した（spec-4b-4a。中身は変えていない）。

  function hasNonZero(values) {
    return Array.isArray(values) && values.some((value) => value !== 0);
  }

  // /RD（規格の順で 左・上・右・下）の形。どれも 0 以上で、左右の和が幅より、上下の和が高さより小さい（確定事項38）。
  function validDifference(difference, [x1, y1, x2, y2]) {
    return Array.isArray(difference) && difference.length === 4 && difference.every((value) => Number.isFinite(value) && value >= 0)
      && difference[0] + difference[2] < x2 - x1 && difference[1] + difference[3] < y2 - y1;
  }

  function insideOf([x1, y1, x2, y2], [left, top, right, bottom]) {
    return [x1 + left, y1 + bottom, x2 - right, y2 - top].map((value) => Math.round(value * 100) / 100);
  }

  // 回した四角・丸（spec-4b-2 確定事項35）。口が外観から読んだ回す前の箱と角度を当て、四角は回した 4 隅にする。
  function withRotation(next, rotation) {
    next.rect = [...rotation.box];
    next.angle = rotation.angle;
    next.quads = [root.SigK.shapeRotation.quadOf(rotation.box, rotation.angle)];
    return next;
  }

  // 四角・丸の塗り・雲形・/RD・回転（確定事項36・38、spec-4b-2 確定事項35）。描けないもの（雲形の破線・崩れた /RD・回転を読めない
  // 外観）は null。雲形の箱は /Rect のまま（他のアプリの外観も /Rect の中に描かれる）で、弧は SigK PDF の描き方で描き直す
  // （決定47 ⑯）。回した図形の /RD は使わない（/Rect に対する軸平行の余白で、回した箱とは意味が合わない）。
  function withBoxDetails(entry, detail) {
    const next = { ...entry };
    const fill = root.SigK.importedValues.hexOfComponents(detail.interior);
    if (fill !== null)
      next.fill = fill;
    const rotation = detail.rotation ?? null;
    if (rotation === 'skewed')
      return null;
    if (rotation !== null)
      withRotation(next, rotation);
    const difference = rotation === null ? detail.rectDifference : null;
    if (difference !== null && difference !== undefined && !validDifference(difference, entry.rect))
      return null;
    if (detail.cloudy === true && Number.isFinite(detail.cloudIntensity) && detail.cloudIntensity > 0) {
      if (entry.lineStyle === 'dashed')
        return null;
      next.lineStyle = 'cloudy';
      next.cloudIntensity = Math.min(2, detail.cloudIntensity);
      return next;
    }
    if (hasNonZero(difference)) {
      next.rect = insideOf(entry.rect, difference);
      next.quads = [root.SigK.freeTextGeometry.quadOfRect(next.rect)];
    }
    return next;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationBoxDetails = { validDifference, insideOf, withBoxDetails };
})(typeof window !== 'undefined' ? window : globalThis);
