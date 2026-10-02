(function (root) {
  'use strict';

  // 書き込みを紙の座標で delta だけ動かした形の値（spec-4-2 確定事項6、spec-4-3 確定事項5、spec-4-4 確定事項14）。
  //
  // annotate-shape.js・annotate-text.js・annotate-note.js の move から、値を作る部分だけを移した（spec-4b-3a。中身は変えていない）。
  // まとめて動かす・写しを作るとき（spec-4b-3a 確定事項F・G）は、ここで作った値を 1 件ずつ当てて 1 世代にする。

  const round = (value) => Math.round(value * 100) / 100;

  // 掴んで動かせる種類（テキスト・ノート・図形・ペン）。マークアップと表示のみは動かさない。
  function isMovable(entry) {
    return entry?.kind === 'text' || entry?.kind === 'note' || root.SigK.annotationEntry.isDrawnKind(entry?.kind);
  }

  // 図形・ペン: 箱と点列をずらし、/Rect を作り直す。
  function shiftedShape(entry, delta) {
    const patch = {};
    if (entry.paths !== undefined)
      patch.paths = entry.paths.map((path) => path.map((point) => [round(point[0] + delta[0]), round(point[1] + delta[1])]));
    const rect = [round(entry.rect[0] + delta[0]), round(entry.rect[1] + delta[1]), round(entry.rect[2] + delta[0]), round(entry.rect[3] + delta[1])];
    return { ...patch, ...root.SigK.shapeGeometry.rectOfShape({ kind: entry.kind, rect, paths: patch.paths, lineWidth: entry.lineWidth, angle: entry.angle }) };
  }

  // テキスト: 表示の左上をずらし、箱の大きさは本文から取り直す（読み込んだ /Rect の余白を引きずらない）。
  function shiftedText(entry, delta) {
    const geometry = root.SigK.freeTextGeometry;
    const [x, y] = geometry.frameOrigin(entry.rect, entry.rotation);
    const origin = [x + delta[0], y + delta[1]].map(round);
    const size = root.SigK.freeTextMetrics.sizeOf(entry);
    const rect = geometry.rectFromOrigin(origin, size, entry.rotation);
    return { rect, quads: [geometry.quadOfRect(rect)] };
  }

  // ノート: 基準の点（紙の左上）に足して箱を作り直す。
  function shiftedNote(entry, delta) {
    const graphics = root.SigK.noteGraphics;
    const [x, y] = graphics.anchorOf(entry);
    const rect = graphics.rectFromAnchor([x + delta[0], y + delta[1]]);
    return { rect, quads: [graphics.quadOfRect(rect)] };
  }

  // 動かした形の値（updateAnnot に渡す patch）。動かせない種類や、delta が数でなければ null。
  function movedPatch(entry, delta) {
    if (!isMovable(entry) || !Array.isArray(delta) || delta.length !== 2 || !delta.every(Number.isFinite))
      return null;
    if (entry.kind === 'text')
      return shiftedText(entry, delta);
    if (entry.kind === 'note')
      return shiftedNote(entry, delta);
    return shiftedShape(entry, delta);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationMoves = { isMovable, movedPatch };
})(typeof window !== 'undefined' ? window : globalThis);
