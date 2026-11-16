(function (root) {
  'use strict';

  // シートの枠に描くページの範囲を、pdf.js に渡す描く範囲（PDF の座標の箱）に直す（docs/spec-7-7-print-dialog.md）。DOM に触らない。
  //
  // 範囲は、画面で見たページ（回転を当てた後）の左上を原点とする割合 { x, y, width, height }（0〜1）で表す。
  // ポスターのタイルは用紙に入る部分だけ、現在の表示範囲(V) は画面に見えている部分だけを描く（拡大して印刷する時に、
  // ページ全体を高い解像度で描かないため）。

  const FULL = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

  function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
  }

  // 画面で見たページの割合の範囲を、回転を外した PDF の座標の箱 [x1, y1, x2, y2] に直す。
  // view は描く元の箱（切り取りがあれば切った範囲）、rotation はページの見た目の回転（0・90・180・270。時計回り）。
  function regionBox(view, rotation, part) {
    const [x1, y1, x2, y2] = view;
    const W = x2 - x1;
    const H = y2 - y1;
    const { x, y, width, height } = part;
    switch (((rotation % 360) + 360) % 360) {
      case 90:
        return [x1 + y * W, y1 + x * H, x1 + (y + height) * W, y1 + (x + width) * H];
      case 180:
        return [x2 - (x + width) * W, y1 + y * H, x2 - x * W, y1 + (y + height) * H];
      case 270:
        return [x2 - (y + height) * W, y2 - (x + width) * H, x2 - y * W, y2 - x * H];
      default:
        return [x1 + x * W, y2 - (y + height) * H, x1 + (x + width) * W, y2 - y * H];
    }
  }

  // 割合の範囲の中の、さらに割合の範囲（現在の表示範囲の中のタイルの部分など）。
  function within(outer, inner) {
    return {
      x: outer.x + inner.x * outer.width,
      y: outer.y + inner.y * outer.height,
      width: inner.width * outer.width,
      height: inner.height * outer.height,
    };
  }

  // シートの枠 1 つについて、用紙に入る部分（dest。シートの µm）と、それがページのどの範囲か（part）を求める。
  // 枠の rotation が 90 の時、ページは時計回りに 90 度回して置いてある。用紙に入る部分が無ければ null。
  function visiblePart(item, sheet) {
    const rect = { x: item.x, y: item.y, width: item.width, height: item.height };
    const bounds = item.clip ?? { x: 0, y: 0, width: sheet.width, height: sheet.height };
    const dest = intersect(rect, bounds);
    if (dest === null)
      return null;
    const local = {
      x: (dest.x - rect.x) / rect.width,
      y: (dest.y - rect.y) / rect.height,
      width: dest.width / rect.width,
      height: dest.height / rect.height,
    };
    // 時計回りに 90 度回した枠の割合から、回す前のページの割合へ。ページの x は枠の y、ページの y は枠の右からの距離。
    const part = item.rotation === 90
      ? { x: local.y, y: 1 - local.x - local.width, width: local.height, height: local.width }
      : local;
    return { dest, part };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.printPageRegion = { FULL, intersect, regionBox, within, visiblePart };
})(typeof window !== 'undefined' ? window : globalThis);
