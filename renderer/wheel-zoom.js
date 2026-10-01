(function (root) {
  'use strict';

  // ホイールで回した量を溜めて、拡大・縮小の段にする（spec-4b-3b 確定事項C3。決定55）。DOM に触れない。viewer-wheel.js が使う。
  //
  // マウスの 1 目盛りは deltaY が 100 前後（表示の拡大率で 100〜150）で 1 回届き、タッチパッドの 2 本指の広げる・狭めるは
  // 数〜十数の小さな値で細かく何回も届く（事前調査 J）。溜めた量が THRESHOLD を超えたら 1 段進め、0 に戻す（余りを持ち越さないので、
  // 1 目盛りが 125 でも 1 回 1 段のまま）。向きが変わったとき・前の回転から IDLE_MS より空いたときは 0 から溜め直す。

  const THRESHOLD = 50;
  const IDLE_MS = 250;

  // deltaMode をそろえる倍率（0 は px、1 は行、2 はページ）。Chromium は px で送るが、念のため揃える。
  const MODE_SCALE = Object.freeze([1, 40, 800]);

  function deltaOf(event) {
    return event.deltaY * (MODE_SCALE[event.deltaMode ?? 0] ?? 1);
  }

  function continues(acc, delta, now) {
    return acc !== null && acc !== undefined && now - acc.at <= IDLE_MS && Math.sign(acc.sum) === Math.sign(delta);
  }

  // acc は前回の { sum, at }（初めは null）。返すのは次の acc と、進める段（上へ回したら +1＝拡大、下なら -1＝縮小、まだなら 0）。
  function accumulate(acc, delta, now) {
    const sum = continues(acc, delta, now) ? acc.sum + delta : delta;
    if (Math.abs(sum) < THRESHOLD)
      return { acc: { sum, at: now }, step: 0 };
    return { acc: { sum: 0, at: now }, step: sum < 0 ? 1 : -1 };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.wheelZoom = { THRESHOLD, IDLE_MS, deltaOf, accumulate };
})(typeof window !== 'undefined' ? window : globalThis);
