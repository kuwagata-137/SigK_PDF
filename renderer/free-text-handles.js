(function (root) {
  'use strict';

  // 選んだテキストの枠と、左右の幅のつまみ・回転のつまみの位置（spec-4b-4a 確定事項F1・F2、spec-4b-4b 確定事項C2。モック
  // screenshots/phase4b-4-wrap.png ②④）。DOM に触れない純粋層。shape-handles.js の handlesOf がテキストについてここを呼び、同じ形
  // { frame, stem, handles } を返す。
  //
  // 左右は文字の向き（置いたときの表示）で決める。箱の表示の左上と、表示の右・下の向きを表示の座標へ直し（回したテキストは箱の
  // 中心まわりに回してから直す）、枠は箱に余白を足した四角、つまみは左右の辺の中点の外（余白の分）に置く。つまみの id は left・right、
  // 種類は width。回転のつまみは文字の向きでの上の辺の外（四角・丸と同じ規則。shape-handles.js の rotateHandleOf）。吹き出しは
  // しっぽの先にも白いつまみ（id・種類とも tip。callout-tail.js。spec-4b-4b 確定事項C3）。

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function layout() {
    return root.SigK.freeTextLayout;
  }

  function shapeHandles() {
    return root.SigK.shapeHandles;
  }

  function unit([x, y]) {
    const length = Math.hypot(x, y);
    return length > 0 ? [x / length, y / length] : [0, 0];
  }

  // 回したテキストの紙の上の点（free-text-turn.js が無ければ回さない）。
  function onPaper(entry, point) {
    return root.SigK.freeTextTurn?.onPaper(entry, point) ?? point;
  }

  // 箱の表示の四隅（表示の座標）と、表示の右・下の単位ベクトル。
  function boxOf(entry, viewport) {
    const origin = geometry().frameOrigin(entry.rect, entry.rotation);
    const { width, height } = geometry().frameSize(entry.rect, entry.rotation);
    const corner = (right, down) => viewport.convertToViewportPoint(...onPaper(entry, layout().shiftOrigin(origin, entry.rotation, [right, down])));
    const topLeft = corner(0, 0);
    const topRight = corner(width, 0);
    const bottomLeft = corner(0, height);
    const bottomRight = corner(width, height);
    return {
      topLeft, topRight, bottomLeft, bottomRight,
      right: unit([topRight[0] - topLeft[0], topRight[1] - topLeft[1]]),
      down: unit([bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]]),
    };
  }

  function offset(point, [x, y], by) {
    return [point[0] + x * by, point[1] + y * by];
  }

  function middle(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  // 枠と左右のつまみと回転のつまみ。表示のみのテキストは null。room はつまみが見える範囲（表示の座標。null ならどこでも見える）。
  function handlesOf(entry, viewport, room = null) {
    if (entry?.kind !== 'text' || entry.readonly === true)
      return null;
    const box = boxOf(entry, viewport);
    const pad = shapeHandles().FRAME_PADDING;
    const outward = (point, sx, sy) => offset(offset(point, box.right, sx * pad), box.down, sy * pad);
    const cursor = shapeHandles().resizeCursorOf(box.right);
    const center = middle(box.topLeft, box.bottomRight);
    const half = Math.hypot(box.bottomLeft[0] - box.topLeft[0], box.bottomLeft[1] - box.topLeft[1]) / 2 + pad;
    const rotate = shapeHandles().rotateHandleOf(center, [-box.down[0], -box.down[1]], half, room);
    const tip = root.SigK.calloutTail?.handleOf(entry, viewport) ?? null;
    return {
      frame: { type: 'polygon', points: [outward(box.topLeft, -1, -1), outward(box.topRight, 1, -1), outward(box.bottomRight, 1, 1), outward(box.bottomLeft, -1, 1)] },
      stem: rotate.stem,
      handles: [
        { id: 'left', kind: 'width', at: offset(middle(box.topLeft, box.bottomLeft), box.right, -pad), cursor },
        { id: 'right', kind: 'width', at: offset(middle(box.topRight, box.bottomRight), box.right, pad), cursor },
        rotate.handle,
        ...(tip === null ? [] : [tip]),
      ],
    };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextHandles = { boxOf, handlesOf };
})(typeof window !== 'undefined' ? window : globalThis);
