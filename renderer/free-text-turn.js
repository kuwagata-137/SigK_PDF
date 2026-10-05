(function (root) {
  'use strict';

  // 回したテキストの箱の純粋層（spec-4b-4b 確定事項B・D1）。DOM に触れない。
  //
  // テキストの angle は四角・丸と同じく画面で時計回りの度で、回す中心は回す前の箱（rect）の中心（shape-rotation.js）。置いた向きの
  // 4 方向（rotation）は描き方の中で足すので、画面の角度は 4 方向の角度＋angle、描く起点は「回した箱の左上の角」になる
  // （中心で回してから左上へ移して 4 方向に回すのと、回した左上へ移して足した角度で回すのは同じ絵）。
  //
  // 箱の大きさが変わるとき（打つ・確定する・大きさや書式を変える・幅のつまみ・動かす）は、今の作りが回す前の座標で動かさない点
  // （箱の左上・中身の左上・引かない辺）を保って箱を組み、その箱を (I − R)(c旧 − c新) だけずらす（turned）。R は角度の回転、c は箱の
  // 中心で、保つ点がどれでも同じ式になる。こうすると、その点は回した紙の上でも動かない。

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function angleOf(entry) {
    return Number.isFinite(entry?.angle) ? entry.angle : 0;
  }

  function centerOf([x1, y1, x2, y2]) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  // 回す前の座標で組んだ frame（{ rect, quads }）を、entry（回す前の箱 rect と angle）の回し方で紙の上に置き直す。
  // 回していなければ frame のまま。
  function turned(entry, frame) {
    const angle = angleOf(entry);
    if (angle === 0)
      return frame;
    const t = (angle * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const [ox, oy] = centerOf(entry.rect);
    const [nx, ny] = centerOf(frame.rect);
    const dx = ox - nx;
    const dy = oy - ny;
    // 紙の座標（y が上）での時計回り: R·d ＝ (dx·cos ＋ dy·sin, −dx·sin ＋ dy·cos)。
    const sx = dx - (dx * cos + dy * sin);
    const sy = dy - (-dx * sin + dy * cos);
    const rect = [frame.rect[0] + sx, frame.rect[1] + sy, frame.rect[2] + sx, frame.rect[3] + sy].map(round);
    return { rect, quads: [rotation().quadOf(rect, angle)] };
  }

  // 回す前の座標の点を、entry の回し方で紙の上へ移す。
  function turnPoint(point, entry) {
    const angle = angleOf(entry);
    return angle === 0 ? point : rotation().rotatePoint(point, centerOf(entry.rect), angle);
  }

  // 回した箱の左上の角（置いた向きでの左上。紙の座標）。画面に描く起点。
  function cornerOf(entry) {
    return turnPoint(geometry().frameOrigin(entry.rect, entry.rotation), entry);
  }

  // 画面に描く角度（時計回り）。4 方向の画面の角度に angle を足す。
  function screenAngleOf(viewportRotation, entry) {
    return (geometry().screenAngle(viewportRotation, entry.rotation) + angleOf(entry)) % 360;
  }

  // 入力欄の左上（紙の座標）と画面の角度（確定事項D1）。直している書き込み（draft.entry）が回っていれば、その回し方で
  // 下書きの左上を移す。新しく置くもの（entry が無い）は回さない。
  function draftCornerOf(draft) {
    return draft.entry ? turnPoint(draft.origin, draft.entry) : draft.origin;
  }

  function draftAngleOf(viewportRotation, draft) {
    return (geometry().screenAngle(viewportRotation, draft.rotation) + angleOf(draft.entry)) % 360;
  }

  // 角度を当てる patch（確定事項A3・B3・C1・C2）。今までの形は新しい形（今の最長行の固定の幅）へ移し、箱を組み直す（中身の左上は動かない。
  // 今までの形は回っていないので、ずらしは要らない）。四角は回した 4 隅（0° なら回す前の四角）。angle は 0 以上 360 未満の数。
  function anglePatch(entry, angle) {
    const patch = {};
    // 今と同じ角度（今までの形は 0°）なら移さない（形が変わらず、履歴にも積まれない。点検で直した）。
    if (entry.width === undefined && angle !== angleOf(entry)) {
      patch.width = root.SigK.freeTextStyle.fixedWidthOf(entry);
      Object.assign(patch, root.SigK.freeTextMetrics.reframe(entry, patch));
    }
    const rect = patch.rect ?? entry.rect;
    // 吹き出しのしっぽの先は、箱の中心のまわりに一緒に回す（spec-4b-4b 確定事項B3）。
    if (entry.callout !== undefined) {
      const tip = rotation().rotatePoint(entry.callout.tip, centerOf(rect), angle - angleOf(entry)).map(round);
      patch.callout = { tip };
    }
    return { ...patch, angle, rect, quads: [angle === 0 ? geometry().quadOfRect(rect) : rotation().quadOf(rect, angle)] };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextTurn = { angleOf, turned, turnPoint, cornerOf, screenAngleOf, draftCornerOf, draftAngleOf, anglePatch };
})(typeof window !== 'undefined' ? window : globalThis);
