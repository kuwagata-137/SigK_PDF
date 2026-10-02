(function (root) {
  'use strict';

  // 選んだテキストの枠と、左右の幅のつまみの位置（spec-4b-4a 確定事項F1・F2。モック screenshots/phase4b-4-wrap.png ②④）。
  // DOM に触れない純粋層。shape-handles.js の handlesOf がテキストについてここを呼び、同じ形 { frame, stem, handles } を返す。
  //
  // 左右は文字の向き（置いたときの表示）で決める。箱の表示の左上と、表示の右・下の向きを表示の座標へ直し、枠は箱に余白を足した
  // 四角、つまみは左右の辺の中点の外（余白の分）に置く。つまみの id は left・right、種類は width。

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

  // 箱の表示の四隅（表示の座標）と、表示の右・下の単位ベクトル。回したテキストは回した四隅と向き（spec-4b-4b 確定事項C3）。
  function boxOf(entry, viewport) {
    const origin = geometry().frameOrigin(entry.rect, entry.rotation);
    const { width, height } = geometry().frameSize(entry.rect, entry.rotation);
    const turn = root.SigK.freeTextTurn;
    const corner = (right, down) => viewport.convertToViewportPoint(...turn.turnPoint(layout().shiftOrigin(origin, entry.rotation, [right, down]), entry));
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

  // 回転のつまみ（spec-4b-4b 確定事項C1。四角・丸と同じ）。上の辺（文字の向きの上）の外に出し、見える範囲 room から出て下の辺の外なら
  // 収まるときだけ下の辺の外に出す。
  function rotateHandleOf(box, pad, room) {
    const { ROTATE_GAP, ROTATE_RADIUS, fits } = shapeHandles();
    const sideOf = (edge, sign) => ({ edge, sign, at: offset(edge, box.down, sign * (pad + ROTATE_GAP)) });
    const top = sideOf(middle(box.topLeft, box.topRight), -1);
    const bottom = sideOf(middle(box.bottomLeft, box.bottomRight), 1);
    const side = !fits(top.at, room, ROTATE_RADIUS) && fits(bottom.at, room, ROTATE_RADIUS) ? bottom : top;
    return {
      handle: { id: 'rotate', kind: 'rotate', at: side.at, cursor: 'rotate' },
      stem: { from: offset(side.edge, box.down, side.sign * pad), to: offset(side.edge, box.down, side.sign * (pad + ROTATE_GAP - ROTATE_RADIUS)) },
    };
  }

  // 枠と左右のつまみと回転のつまみ。表示のみのテキストは null。room はつまみが見える範囲（表示の座標。null ならどこでも見える）。
  function handlesOf(entry, viewport, room = null) {
    if (entry?.kind !== 'text' || entry.readonly === true)
      return null;
    const box = boxOf(entry, viewport);
    const pad = shapeHandles().FRAME_PADDING;
    const outward = (point, sx, sy) => offset(offset(point, box.right, sx * pad), box.down, sy * pad);
    const cursor = shapeHandles().resizeCursorOf(box.right);
    const rotate = rotateHandleOf(box, pad, room);
    // 吹き出しはしっぽの先にもつまみを出す（callout-handles.js。spec-4b-4b 確定事項F4）。
    const tip = root.SigK.calloutHandles?.handleOf(entry, viewport) ?? null;
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
