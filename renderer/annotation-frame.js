(function (root) {
  'use strict';

  // 選んでいる書き込みの枠とつまみの層（spec-4-1 確定事項6、spec-4-4 確定事項11・32、spec-4b-2 確定事項9〜14・23）。
  //
  // 枠とつまみは、紙の器（.pdf-page。overflow:hidden）の外の #view-pages に置く 1 枚の <svg class="annot-frame-layer"> に描く。
  // 選んでいる書き込みのページの位置に重ね、紙の外の灰色の上にもはみ出す（紙の上端の近くの図形でも回転のつまみが見えて押せる）。
  // 四角・丸は回した枠と 8 点のつまみと回転のつまみ、直線・矢印は線に沿った破線と両端のつまみ（位置は shape-handles.js）、
  // ほかの種類は今までの四角の枠（箱に余白を足した破線）。掴んで動かしている間は、書き込みと同じだけ translate する。
  // page-render.js が層を描き直すたびに sync を呼ぶ。

  // 層の要素と、いま枠を出しているもの { index, key, keys, entry, viewport, shape }。複数選択なら key・entry・shape は null。
  let layer = null;
  let shown = null;

  function handles() {
    return root.SigK.shapeHandles;
  }

  function keyOf(entry) {
    return entry.ref ?? entry.id;
  }

  // 枠とつまみの部品（形を組む関数）は frame-graphics.js（spec-4b-3a で分けた）。
  function graphics() {
    return root.SigK.frameGraphics;
  }

  function ensureLayer(doc, pagesEl) {
    if (layer !== null && layer.parentNode === pagesEl)
      return layer;
    layer = graphics().element(doc, 'svg', { class: 'annot-frame-layer', 'aria-hidden': 'true' });
    pagesEl.append(layer);
    return layer;
  }

  function clear() {
    layer?.replaceChildren();
    shown = null;
  }

  // つまみが見える範囲（そのページの表示の座標）。#view には内側の余白が無いので、縦は #view-pages の箱（上下の余白 18px を含み、
  // 中身が表示域より低ければ表示域の下まで）、横は #view-pages の箱に、表示域が中身より広いときの左右の灰色を足したもの。
  // 位置が読めなければ null（どこでも見えるとみなす）。
  function roomOf(pagesEl, pageNode) {
    const left = parseFloat(pageNode.style.left);
    const top = parseFloat(pageNode.style.top);
    const width = parseFloat(pagesEl.style.width);
    const height = parseFloat(pagesEl.style.height);
    if (![left, top, width, height].every(Number.isFinite))
      return null;
    const view = pagesEl.parentNode;
    const side = Math.max(0, ((view?.clientWidth ?? 0) - width) / 2);
    return { left: -left - side, top: -top, right: width - left + side, bottom: Math.max(height, view?.clientHeight ?? 0) - top };
  }

  // selected は鍵の並び（今までの 1 件の鍵や null も受ける）。
  function keysOfSelected(selected) {
    if (Array.isArray(selected))
      return selected;
    return selected === null || selected === undefined ? [] : [selected];
  }

  // 層をそのページの位置と大きさに合わせる。
  function placeLayer(doc, pagesEl, pageNode, viewport) {
    const svg = ensureLayer(doc, pagesEl);
    svg.style.left = pageNode.style.left;
    svg.style.top = pageNode.style.top;
    svg.setAttribute('width', String(Math.round(viewport.width)));
    svg.setAttribute('height', String(Math.round(viewport.height)));
    return svg;
  }

  // 1 件ぶんの枠の組。複数選択の組は、1 件の枠と同じ形からつまみと回転の印だけを外す（spec-4b-3a 確定事項E2）。
  function groupFor(doc, entry, viewport, shape) {
    const group = graphics().groupOf(doc, entry, viewport, shape);
    group.setAttribute('data-frame-key', keyOf(entry));
    return group;
  }

  // 1 ページの層を描き直したときに呼ぶ。選んでいる書き込みがこのページにあれば枠を描き、無くてこのページに出して
  // いたなら消す。1 件なら枠とつまみ、2 件以上なら 1 件ごとの枠だけ（spec-4b-3a 確定事項E）。entries は描いた書き込み
  // （下見を当てたもの）、editing は入力欄を開いているテキスト（枠を出さない）。
  function sync({ doc, pagesEl, pageNode, index, entries, viewport, selected = null, editing = null }) {
    const keys = keysOfSelected(selected).filter((key) => key !== editing);
    const targets = keys.map((key) => entries.find((entry) => keyOf(entry) === key) ?? null).filter((entry) => entry !== null);
    if (targets.length === 0 || pagesEl === null || pagesEl === undefined || pageNode === null || pageNode === undefined) {
      if (shown?.index === index)
        clear();
      return false;
    }
    const svg = placeLayer(doc, pagesEl, pageNode, viewport);
    const room = roomOf(pagesEl, pageNode);
    if (keys.length === 1) {
      const shape = handles()?.handlesOf(targets[0], viewport, room) ?? null;
      svg.replaceChildren(groupFor(doc, targets[0], viewport, shape));
      shown = { index, key: keys[0], keys: [keys[0]], entry: targets[0], viewport, shape };
      return true;
    }
    svg.replaceChildren(...targets.map((target) => {
      const shape = handles()?.handlesOf(target, viewport, room) ?? null;
      return groupFor(doc, target, viewport, shape === null ? null : { ...shape, stem: null, handles: [] });
    }));
    shown = { index, key: null, keys: targets.map(keyOf), entry: null, viewport, shape: null };
    return true;
  }

  // ページを捨てたとき（page-render.js の releasePage）。そのページに出していれば消す。
  function releasePage(index) {
    if (shown?.index === index)
      clear();
  }

  // 掴んで動かしている間、枠とつまみを書き込みと同じだけずらす（確定事項23）。0, 0 で戻す。keys を渡せば、その鍵の組だけを
  // ずらす（まとめて動かすとき、動かせない書き込みの枠は残す。spec-4b-3a 確定事項E3・F1）。
  function translate(dx, dy, keys = null) {
    for (const group of [...(layer?.children ?? [])]) {
      if (keys !== null && !keys.includes(group.getAttribute('data-frame-key')))
        continue;
      group.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px)`;
    }
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationFrame = {
    FRAME_PADDING: root.SigK.frameGraphics.FRAME_PADDING,
    boundsOf: (entry, viewport) => graphics().boundsOf(entry, viewport),
    frameOf: (doc, entry, viewport) => graphics().frameOf(doc, entry, viewport),
    roomOf,
    sync,
    releasePage,
    clear,
    translate,
    // 出している枠（annotate-transform.js がつまみの当たりに使う）。無ければ null。
    shown: () => shown,
    element: () => layer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
