(function (root) {
  'use strict';

  // 回したテキストの箱の純粋層（spec-4b-4b 確定事項A2・B・C1・D1）。DOM に触れない。
  //
  // テキストの rect は回す前の箱、angle は箱の中心まわりに画面で時計回りの度（四角・丸と同じ）。箱が変わる操作（打つ・幅のつまみ・
  // 文字の大きさ・書式・動かす）は、今までどおり回す前の座標で新しい箱を組んでから、ここで中心を元の中心まわりに回し直す
  // （shape-rotation.js の recentered）。回す前の座標で動かさなかった点（表示の左上・左の幅のつまみでは中身の右）は、紙の上でも
  // 動かない（確定事項B1。決定59 ①）。

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function round(value) {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  // 箱の 4 隅の四角。回していれば回した 4 隅（確定事項B2）。
  function quadsOf(rect, angle) {
    return [rotation().isRotated({ angle }) ? rotation().quadOf(rect, angle) : geometry().quadOfRect(rect)];
  }

  // 回す前の座標で組み直した箱 frame（{ rect }）を、回したテキストなら中心を回し直した箱にする。戻り値は { rect, quads }、吹き出しは
  // tip も（確定事項B3）。entry は変える前の書き込み（rect と angle と tip）。
  function turnedFrame(entry, frame) {
    const angle = rotation().angleOf(entry);
    const rect = angle === 0 ? [...frame.rect] : rotation().recentered(entry.rect, frame.rect, angle).map(round);
    const result = { rect, quads: quadsOf(rect, angle) };
    if (Array.isArray(entry.tip))
      result.tip = keptTip(entry, rect, angle);
    return result;
  }

  // 箱が変わっても、しっぽの先を紙の上で動かさない（確定事項B3。決定59 ②）。回していなければ回す前の座標のまま、回していれば元の
  // 先の紙の上の位置を新しい箱の中心まわりに戻す。
  function keptTip(entry, rect, angle) {
    if (angle === 0)
      return [...entry.tip];
    const onPaperTip = rotation().rotatePoint(entry.tip, rotation().centerOf(entry.rect), angle);
    return rotation().rotatePoint(onPaperTip, rotation().centerOf(rect), -angle).map(round);
  }

  // 紙の上の点を回したテキストの上の点にする（表示の左上・つまみ・入力欄の位置）。回していなければそのまま。
  function onPaper(entry, point) {
    const angle = rotation().angleOf(entry);
    return angle === 0 ? point : rotation().rotatePoint(point, rotation().centerOf(entry.rect), angle);
  }

  // 表示の左上が紙の上で来る点（回していれば回した位置。確定事項C1・D1）。
  function originOnPaper(entry) {
    return onPaper(entry, geometry().frameOrigin(entry.rect, entry.rotation));
  }

  // 角度を変える patch（回転のつまみ・回転の行。確定事項A2・C6）。今までの形は、回すときだけ、書式を付けたときと同じく固定の幅の
  // 新しい形へ移す（spec-4b-4a 確定事項A2。行の並びは変わらない）。0° なら移さず、何も変わらない patch になる（履歴にも積まない）。
  // 0° でも 4 隅を作り直す。
  function anglePatch(entry, angle) {
    const normalized = rotation().normalizeAngle(angle);
    const patch = { angle: normalized };
    let rect = entry.rect;
    if (entry.width === undefined && normalized !== 0) {
      patch.width = root.SigK.freeTextStyle.fixedWidthOf(entry);
      rect = root.SigK.freeTextMetrics.reframe(entry, { width: patch.width }).rect;
    }
    return { ...patch, rect: [...rect], quads: quadsOf(rect, normalized) };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextTurn = { quadsOf, turnedFrame, onPaper, originOnPaper, anglePatch };
})(typeof window !== 'undefined' ? window : globalThis);
