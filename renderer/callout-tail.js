(function (root) {
  'use strict';

  // 吹き出しのしっぽの先のつまみ（spec-4b-4b 確定事項C3・F）。DOM に触れない純粋層。free-text-handles.js がつまみの位置を、
  // annotate-transform.js が引いたときの patch をここに聞く。
  //
  // 先（tip）は回す前の紙の座標で持つ。引いた差（表示の座標）を紙の座標へ直し、回していれば回す前の向きへ戻して足す（CheckListMaker の
  // localDelta と同じ）。Shift を押していれば、画面での差の大きい方の向きだけを残す（画面の横か縦。確定事項F1）。先が箱の中に
  // 来ても特別な扱いはしない（確定事項F3）。

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function round(value) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function isCallout(entry) {
    return entry?.kind === 'text' && Array.isArray(entry.tip) && entry.readonly !== true;
  }

  // 先が紙の上で来る点（回していれば箱の中心まわりに回した点）。
  function tipOnPaper(entry) {
    return rotation().rotatePoint(entry.tip, rotation().centerOf(entry.rect), rotation().angleOf(entry));
  }

  // 先のつまみ（表示の座標）。吹き出しでなければ null。
  function handleOf(entry, viewport) {
    if (!isCallout(entry))
      return null;
    return { id: 'tip', kind: 'tip', at: viewport.convertToViewportPoint(...tipOnPaper(entry)), cursor: 'move' };
  }

  // Shift: 画面での差の大きい方の向きだけを残す。
  function locked(press, point) {
    const dx = point[0] - press[0];
    const dy = point[1] - press[1];
    return Math.abs(dx) >= Math.abs(dy) ? [press[0] + dx, press[1]] : [press[0], press[1] + dy];
  }

  // 押した点 press から point まで引いたときの patch（{ tip }。表示の座標）。
  function tipPatch(entry, press, point, viewport, { shift = false } = {}) {
    if (!isCallout(entry))
      return null;
    const to = shift ? locked(press, point) : point;
    const [fromX, fromY] = viewport.convertToPdfPoint(...press);
    const [toX, toY] = viewport.convertToPdfPoint(...to);
    const [x, y] = tipOnPaper(entry);
    const moved = [x + toX - fromX, y + toY - fromY];
    const tip = rotation().toLocal(moved, entry.rect, rotation().angleOf(entry));
    return { tip: tip.map(round) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.calloutTail = { tipOnPaper, handleOf, tipPatch };
})(typeof window !== 'undefined' ? window : globalThis);
