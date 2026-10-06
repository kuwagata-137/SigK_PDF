(function (root) {
  'use strict';

  // トリミングの箱の純関数（spec-4b-6a 確定事項1〜4・7・18）。DOM にも pdf.js にも触れない。
  //
  // 箱は [x1, y1, x2, y2]。PDF の座標（回す前・pt。y は上向き）で、x1 < x2・y1 < y2。plan の要素の crop も、ファイルの見える範囲
  // （pdf.js の page.view）も、紙全体（MediaBox）も、この形で持つ。画面で見る向き（回したあと）の上下左右は、rotation（そのページの
  // /Rotate に plan の回転を足した絶対角。0/90/180/270）で読み替える。

  // 同じ箱と見なす差（各辺。確定事項2）。
  const EPSILON = 0.01;
  // 切ったあとの幅と高さの下限（pt。確定事項13・18）。
  const MIN_SIZE = 10;

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  // 並べ直して小数 2 桁に丸める。数でない・幅か高さが 0 なら null。
  function normalizeBox(box) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite))
      return null;
    const [ax, ay, bx, by] = box;
    const normalized = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map(round2);
    return normalized[2] > normalized[0] && normalized[3] > normalized[1] ? normalized : null;
  }

  function sameBox(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4)
      return false;
    return a.every((value, index) => Math.abs(value - b[index]) <= EPSILON);
  }

  // 2 つの箱の重なり。重ならなければ null。
  function intersectBox(a, b) {
    const left = normalizeBox(a);
    const right = normalizeBox(b);
    if (left === null || right === null)
      return null;
    const box = [Math.max(left[0], right[0]), Math.max(left[1], right[1]), Math.min(left[2], right[2]), Math.min(left[3], right[3])];
    // normalizeBox は並べ直すので、重ならない（左が右を越える）ことは先に見る。
    return box[2] > box[0] && box[3] > box[1] ? normalizeBox(box) : null;
  }

  function quarter(rotation) {
    const turns = Math.round((Number.isFinite(rotation) ? rotation : 0) / 90);
    return ((turns % 4) + 4) % 4;
  }

  // 回す前の辺の幅（左・下・右・上）を、画面で見る向きの上・右・下・左へ読み替える順。/Rotate は時計回りなので、90° 回すと
  // 回す前の左の辺が上に来る（事前調査 B の viewport で確かめた向き）。
  const SIDES = ['left', 'bottom', 'right', 'top'];
  const SHOWN = [
    { top: 'top', right: 'right', bottom: 'bottom', left: 'left' },
    { top: 'left', right: 'top', bottom: 'right', left: 'bottom' },
    { top: 'bottom', right: 'left', bottom: 'top', left: 'right' },
    { top: 'right', right: 'bottom', bottom: 'left', left: 'top' },
  ];

  // visible（見える範囲）の端から box までの幅を、画面で見る向きの上下左右で返す（確定事項18）。
  function marginsOf(visible, box, rotation) {
    const v = normalizeBox(visible);
    const b = normalizeBox(box);
    if (v === null || b === null)
      return null;
    const raw = { left: b[0] - v[0], bottom: b[1] - v[1], right: v[2] - b[2], top: v[3] - b[3] };
    const map = SHOWN[quarter(rotation)];
    return { top: raw[map.top], right: raw[map.right], bottom: raw[map.bottom], left: raw[map.left] };
  }

  // visible を、画面で見る向きの上下左右から margins だけ切った箱。幅か高さが MIN_SIZE 未満になるなら null。
  function shrinkBy(visible, margins, rotation) {
    const v = normalizeBox(visible);
    if (v === null || margins === null || typeof margins !== 'object')
      return null;
    const map = SHOWN[quarter(rotation)];
    const raw = {};
    for (const side of SIDES)
      raw[side] = 0;
    for (const shown of ['top', 'right', 'bottom', 'left'])
      raw[map[shown]] = Math.max(0, Number(margins[shown]) || 0);
    const box = [v[0] + raw.left, v[1] + raw.bottom, v[2] - raw.right, v[3] - raw.top];
    if (box[2] - box[0] < MIN_SIZE - EPSILON || box[3] - box[1] < MIN_SIZE - EPSILON)
      return null;
    return normalizeBox(box);
  }

  // 画面で見る向きの幅と高さ（pt に userUnit を掛けた値。viewport の scale 1 と同じ）。
  function sizeOf(box, rotation, userUnit = 1) {
    const b = normalizeBox(box);
    if (b === null)
      return { width: 0, height: 0 };
    const unit = Number.isFinite(userUnit) && userUnit > 0 ? userUnit : 1;
    const width = (b[2] - b[0]) * unit;
    const height = (b[3] - b[1]) * unit;
    return quarter(rotation) % 2 === 1 ? { width: height, height: width } : { width, height };
  }

  // plan の要素へ切った範囲を当てた写し（確定事項1・2）。box がファイルの見える範囲 view と同じなら欄を消す。box が null なら欄を消す。
  function withCrop(entry, box, view) {
    const next = { ...entry };
    delete next.crop;
    const normalized = normalizeBox(box);
    if (normalized === null || sameBox(normalized, normalizeBox(view)))
      return next;
    next.crop = normalized;
    return next;
  }

  // plan の要素の見える範囲。切っていればその箱、無ければファイルの見える範囲。
  function visibleOf(entry, view) {
    return normalizeBox(entry?.crop) ?? normalizeBox(view);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.pageCrop = { EPSILON, MIN_SIZE, normalizeBox, sameBox, intersectBox, marginsOf, shrinkBy, sizeOf, withCrop, visibleOf };
})(typeof window !== 'undefined' ? window : globalThis);
