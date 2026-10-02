(function (root) {
  'use strict';

  // 吹き出しのしっぽの先のつまみ（spec-4b-4b 確定事項F4）。DOM に触れない純粋層。free-text-handles.js がつまみを置き、annotate-transform.js が
  // 引いたときの patch に使う。
  //
  // 先は紙の上の実際の点（回したあとの位置）で持つので、つまみは先の点そのものに置く。引いた量は押したときからの表示の動きで、
  // Shift なら本体の向き（回した箱の右と下の軸）の大きい方だけを残す（回した吹き出しでも、本体の辺にまっすぐなしっぽを作れるように）。

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function isCallout(entry) {
    return entry?.kind === 'text' && entry.callout !== undefined && entry.readonly !== true;
  }

  // 先のつまみ（表示の座標）。吹き出しでなければ null。
  function handleOf(entry, viewport) {
    if (!isCallout(entry))
      return null;
    return { id: 'tip', kind: 'tip', at: viewport.convertToViewportPoint(...entry.callout.tip), cursor: 'move' };
  }

  // Shift の動き: 本体の右と下の軸に分け、大きい方だけを残す（等しいときは右）。
  function lockToBody(entry, delta, viewport) {
    const { right, down } = root.SigK.freeTextHandles.boxOf(entry, viewport);
    const along = delta[0] * right[0] + delta[1] * right[1];
    const across = delta[0] * down[0] + delta[1] * down[1];
    return Math.abs(along) >= Math.abs(across) ? [right[0] * along, right[1] * along] : [down[0] * across, down[1] * across];
  }

  // 先のつまみを引いた形（updateAnnot に渡す patch）。press・point は押した点と今の点（表示の座標）。形が変わらなければ null。
  function tipPatch(entry, press, point, viewport, { shift = false } = {}) {
    if (!isCallout(entry))
      return null;
    const raw = [point[0] - press[0], point[1] - press[1]];
    const [dx, dy] = shift ? lockToBody(entry, raw, viewport) : raw;
    const [x, y] = viewport.convertToViewportPoint(...entry.callout.tip);
    const tip = viewport.convertToPdfPoint(x + dx, y + dy).map(round);
    if (tip[0] === entry.callout.tip[0] && tip[1] === entry.callout.tip[1])
      return null;
    return { callout: { tip } };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutHandles = { handleOf, tipPatch };
})(typeof window !== 'undefined' ? window : globalThis);
