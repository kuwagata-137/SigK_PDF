(function (root) {
  'use strict';

  // 消しゴムでなぞっている途中の状態と下見（spec-4b-5b 確定事項19〜22）。履歴も選択も知らない（離したときに当てるのは annotate-erase.js）。
  //
  // 押したページの書き込みだけを見る。なぞった跡は動かすたびに 1 本ずつ伸ばし、伸ばした線分だけでペン・マーカーを切り直す（切るのは
  // 重ねてもよい。ink-cut.js）。図形は一度触れたら丸ごと消す印を付ける（eraser-reach.js）。消しゴムの半径は画面の RADIUS_PX を、
  // 押したときのページの倍率で紙の pt に直したもの（決定62 ③）。下見は shownOf がページの書き込みの並びを差し替えて描く（切った
  // ペン・マーカーは切った形、線が残らないものは描かず、丸ごと消える図形は薄く）。

  // 消しゴムの半径（画面の px。直径 16px）。
  const RADIUS_PX = 8;
  // なぞっている間の、丸ごと消える図形の不透明度に掛ける値。
  const FADE = 0.3;

  // { index, src, viewport, radius, last, cuts: Map(鍵 → paths), touched: Set(鍵) }。なぞっていなければ null。
  let draft = null;

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  function reach() {
    return root.SigK.eraserReach;
  }

  function isInk(entry) {
    return entry.kind === 'ink' && entry.readonly !== true;
  }

  // 書き込みの箱が、跡の線分の外接（margin だけ広げたもの）に重なるか。
  function nearBox(rect, [a, b], margin) {
    return Math.max(a[0], b[0]) + margin >= rect[0] && Math.min(a[0], b[0]) - margin <= rect[2]
      && Math.max(a[1], b[1]) + margin >= rect[1] && Math.min(a[1], b[1]) - margin <= rect[3];
  }

  // 跡の線分 1 本ぶんを当てる。entries はそのページの書き込み（下から上）。
  function apply(entries, segment) {
    for (const entry of entries) {
      const key = keyOf(entry);
      if (isInk(entry)) {
        const width = entry.lineWidth / 2;
        if (!nearBox(entry.rect, segment, draft.radius + width))
          continue;
        const current = draft.cuts.get(key) ?? entry.paths;
        const cut = root.SigK.inkCut.cutPaths(current, segment, draft.radius + width);
        if (cut.changed)
          draft.cuts.set(key, cut.paths);
      } else if (!draft.touched.has(key) && nearBox(root.SigK.shapeRotation.isRotated(entry) ? boundsOf(entry) : entry.rect, segment, draft.radius + (entry.lineWidth ?? 0))
        && reach().touches(entry, segment, draft.radius)) {
        draft.touched.add(key);
      }
    }
  }

  // 回した図形の外接（回す前の箱を回した 4 隅）。
  function boundsOf(entry) {
    return root.SigK.shapeRotation.boundsOf(entry.rect, root.SigK.shapeRotation.angleOf(entry));
  }

  function toPdf(point) {
    return draft.viewport.convertToPdfPoint(point[0], point[1]);
  }

  // 押した。point は .pdf-page 基準の CSS px。押した点の輪の中も消す。
  function begin({ index, src, viewport, point, entries }) {
    const scale = viewport.scale > 0 ? viewport.scale : 1;
    draft = { index, src, viewport, radius: RADIUS_PX / scale, last: null, cuts: new Map(), touched: new Set() };
    draft.last = toPdf(point);
    apply(entries, [draft.last, draft.last]);
    return true;
  }

  // 動かした。直前の点からの線分を当てる。
  function extend(point, entries) {
    if (draft === null)
      return false;
    const next = toPdf(point);
    apply(entries, [draft.last, next]);
    draft.last = next;
    return true;
  }

  // 離した。{ remove: 消す鍵の並び, update: Map(鍵 → 切った paths) } を返して終える。なぞっていなければ null。
  function finish() {
    if (draft === null)
      return null;
    const remove = [...draft.touched];
    const update = new Map();
    for (const [key, paths] of draft.cuts) {
      if (paths.length === 0)
        remove.push(key);
      else
        update.set(key, paths);
    }
    draft = null;
    return { remove, update };
  }

  function cancel() {
    if (draft === null)
      return false;
    draft = null;
    return true;
  }

  // 下見で描く並び（index のページのぶんだけ差し替える）。
  function shownOf(index, entries) {
    if (draft === null || draft.index !== index)
      return entries;
    const shown = [];
    for (const entry of entries) {
      const key = keyOf(entry);
      const paths = draft.cuts.get(key);
      if (paths !== undefined) {
        if (paths.length > 0)
          shown.push({ ...entry, paths, ...root.SigK.shapeGeometry.rectOfEntry(entry, { paths }) });
        continue;
      }
      shown.push(draft.touched.has(key) ? { ...entry, opacity: (entry.opacity ?? 1) * FADE } : entry);
    }
    return shown;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.eraserDraft = {
    RADIUS_PX,
    FADE,
    begin,
    extend,
    finish,
    cancel,
    shownOf,
    isErasing: () => draft !== null,
    pageIndex: () => (draft === null ? null : draft.index),
  };
})(typeof window !== 'undefined' ? window : globalThis);
