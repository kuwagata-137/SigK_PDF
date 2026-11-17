'use strict';

// 起動確認で、ウインドウに描画したフレームのうち、ある範囲が白いだけのフレームを数える（2026-11-17 の不具合「モザイクを配置するたびに
// 画面がホワイトアウトする」の確認に作った。smoke-image-mosaic.js が使う）。
// ウインドウを表示しない起動確認（SIGK_SMOKE_HIDDEN）は offscreen 描画なので、メインで paint イベントを受けると、描画したフレームの画像を
// 受け取れる。

// 白と見なす画素の下限（R・G・B のすべて）と、白いフレームと見なす割合。
const WHITE_LEVEL = 245;
const WHITE_FRAME = 0.9;

// area（CSS px の { left, top, right, bottom }）の中の白い画素の割合。inner は画面の幅と高さ（CSS px）。4 画素おきに数える。
function whiteRatio(image, area, inner) {
  const { width, height } = image.getSize();
  const scale = width / inner[0];
  const bitmap = image.toBitmap();
  const [x1, y1] = [Math.max(0, Math.ceil(area.left * scale)), Math.max(0, Math.ceil(area.top * scale))];
  const [x2, y2] = [Math.min(width, Math.floor(area.right * scale)), Math.min(height, Math.floor(area.bottom * scale))];
  let white = 0;
  let total = 0;
  for (let y = y1; y < y2; y += 4) {
    for (let x = x1; x < x2; x += 4) {
      const at = (y * width + x) * 4;
      total += 1;
      if (bitmap[at] >= WHITE_LEVEL && bitmap[at + 1] >= WHITE_LEVEL && bitmap[at + 2] >= WHITE_LEVEL)
        white += 1;
    }
  }
  return total === 0 ? null : Math.round((white / total) * 1000) / 1000;
}

// paint イベントを受けて、フレームごとの白い画素の割合を記録する。返す関数で記録をやめ、記録（frames）と、いちばん白いフレーム
// （白いフレームがあったときだけ）と最終フレームの PNG を返す。
function watchPaint(win, area, inner) {
  const frames = [];
  let whitest = null;
  let last = null;
  const started = Date.now();
  const onPaint = (_event, _dirty, image) => {
    const white = whiteRatio(image, area, inner);
    frames.push({ ms: Date.now() - started, white });
    last = image.toPNG();
    if (white !== null && white >= WHITE_FRAME && (whitest === null || white > whitest.white))
      whitest = { white, png: last };
  };
  win.webContents.on('paint', onPaint);
  return () => {
    win.webContents.off('paint', onPaint);
    return { frames, whitest, last };
  };
}

// 記録の要約。recoveredMs は、白いフレームのあと、最初に白くないフレームを描いた時刻（白い背景が見えていた終わり）。
function summarize({ frames }) {
  const isWhite = (frame) => frame.white !== null && frame.white >= WHITE_FRAME;
  const whites = frames.filter(isWhite);
  const lastWhite = frames.findLastIndex(isWhite);
  const recovered = lastWhite === -1 ? null : frames.slice(lastWhite + 1).find((frame) => frame.white !== null && !isWhite(frame));
  return {
    frames: frames.length, whiteFrames: whites.length, maxWhite: Math.max(0, ...frames.map((frame) => frame.white ?? 0)),
    whiteFromMs: whites[0]?.ms ?? null, recoveredMs: recovered?.ms ?? null,
  };
}

module.exports = { WHITE_LEVEL, WHITE_FRAME, whiteRatio, watchPaint, summarize };
