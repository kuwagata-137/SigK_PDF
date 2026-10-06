'use strict';

// ページの箱（MediaBox・CropBox）と、ページ木から受け継ぐ欄の決まり（spec-4b-6a 確定事項9・21〜23。事前調査 C）。
//
// pdf-lib を require しない。PDFName は呼ぶ側が渡す（保存はワーカーの vendor の pdf-lib、テストは node_modules の pdf-lib で、
// クラスが別物になるため。op-pages.js と同じ考え方）。箱は [x1, y1, x2, y2]（PDF の座標・回す前・pt）で、レンダラーの
// renderer/page-crop.js と同じ決まり（各辺 0.01pt まで同じと見なす）をここにも写してある。

// ページ木の親から受け継げる欄（PDF の決まり）。保存の組み直しで親が根に付け替わると、中間の /Pages から受け継いでいた値が消える。
const INHERITED = Object.freeze(['MediaBox', 'CropBox', 'Resources', 'Rotate']);
const EPSILON = 0.01;
// 書いてよい CropBox の幅と高さの下限（pt。確定事項22）。
const MIN_SIDE = 1;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function normalizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite))
    return null;
  const [ax, ay, bx, by] = box;
  const normalized = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map(round2);
  return normalized[2] > normalized[0] && normalized[3] > normalized[1] ? normalized : null;
}

function sameBox(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.every((value, index) => Math.abs(value - b[index]) <= EPSILON);
}

function intersect(a, b) {
  const box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return box[2] - box[0] >= MIN_SIDE && box[3] - box[1] >= MIN_SIDE ? normalizeBox(box) : null;
}

// 受け継いでいる欄をページに直に写す（確定事項21）。ページ自身が持っている欄には触れない。
function pushDownInherited(page, { PDFName }) {
  for (const key of INHERITED) {
    const name = PDFName.of(key);
    if (page.node.get(name) !== undefined)
      continue;
    const value = page.node.getInheritableAttribute(name);
    if (value !== undefined)
      page.node.set(name, value);
  }
}

// ページの紙全体（MediaBox）。受け継いだ値も読む。無い・読めなければ null。
function mediaBoxOf(page) {
  try {
    const { x, y, width, height } = page.getMediaBox();
    return normalizeBox([x, y, x + width, y + height]);
  } catch {
    return null;
  }
}

// plan の crop を /CropBox に当てる（確定事項22）。MediaBox との重なりに収め、MediaBox と同じなら /CropBox を消す
// （消すと親の CropBox を受け継いでしまうときは、MediaBox と同じ値を直に書く）。重ならない・細すぎる値は断る。
function applyCrop(page, crop, { PDFName }) {
  const media = mediaBoxOf(page);
  const wanted = normalizeBox(crop);
  const box = media === null || wanted === null ? null : intersect(wanted, media);
  if (box === null)
    return { error: 'ページの切り方が正しくありません。' };
  const name = PDFName.of('CropBox');
  if (sameBox(box, media)) {
    page.node.delete(name);
    if (page.node.getInheritableAttribute(name) === undefined)
      return { ok: true, box: null };
  }
  page.setCropBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  return { ok: true, box };
}

// ページ順の MediaBox（確定事項9。ワーカーの page-boxes が返す）。読めないページは null。
function mediaBoxesOf(doc) {
  return doc.getPages().map(mediaBoxOf);
}

module.exports = { INHERITED, normalizeBox, sameBox, pushDownInherited, mediaBoxOf, applyCrop, mediaBoxesOf };
