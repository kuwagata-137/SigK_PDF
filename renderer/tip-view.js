(function (root) {
  'use strict';

  // 説明の吹き出しの DOM（spec-2-5 J1・J9・J13）。出す・消すの判定は tip.js、位置の計算は tip-place.js、文は tip-content.js。
  //
  //   div#tip.tip[role=tooltip][popover=manual](hidden)[data-side=below|above]（body の最後）
  //     b.tip-name   … 名前（太字）
  //     span.tip-desc … 何ができるか（空なら作らない。改行は CSS の white-space: pre-line で出す）
  //     div.tip-keys  … 「キー: 」と kbd を「／」でつなぎ、keysNote があれば「（…）」（キーが無ければ作らない）
  //
  // 文はどれも textContent で入れる（ファイル名が入るので、innerHTML を使わない）。
  // 最前面（popover）に出すのは、窓（dialog）の中のボタンの説明の吹き出しを窓の後ろに隠さないため（J13）。

  function create(doc) {
    const el = doc.createElement('div');
    el.id = 'tip';
    el.className = 'tip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    if ('popover' in el)
      el.popover = 'manual';
    doc.body.append(el);
    return el;
  }

  function part(doc, tag, className, text) {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function keysLine(doc, entry) {
    const line = doc.createElement('div');
    line.className = 'tip-keys';
    line.append('キー: ');
    entry.keys.forEach((key, index) => {
      if (index > 0)
        line.append('／');
      const kbd = doc.createElement('kbd');
      kbd.textContent = key;
      line.append(kbd);
    });
    if (entry.keysNote)
      line.append(`（${entry.keysNote}）`);
    return line;
  }

  // entry は tipContent.resolve の Entry（{ name, desc?, keys?, keysNote? }）。中身をそっくり入れ替える。
  function render(tipEl, entry) {
    const doc = tipEl.ownerDocument;
    const parts = [part(doc, 'b', 'tip-name', entry.name)];
    if (entry.desc)
      parts.push(part(doc, 'span', 'tip-desc', entry.desc));
    if (Array.isArray(entry.keys) && entry.keys.length > 0)
      parts.push(keysLine(doc, entry));
    tipEl.replaceChildren(...parts);
  }

  // 位置の基準にする要素。中に data-tip-anchor の要素があればそれ（✂ の盤の ✂ の丸など）、無ければ要素そのもの。
  function anchorOf(node) {
    return node.querySelector('[data-tip-anchor]') ?? node;
  }

  // 位置を付けて、出す側（'below'｜'above'）を返す。anchorRect は対象の矩形、viewport は画面の { width, height }。
  // 測る前に左上へ寄せる（前の位置が右端だと、幅が縮んだまま測ってしまうため）。拡大表示では矩形が小数になるので、
  // left・top・矢印は丸めて付ける（文字がにじまないように）。
  function placeAt(tipEl, anchorRect, viewport) {
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    const box = tipEl.getBoundingClientRect();
    const spot = root.SigK.tipPlace.place({ anchor: anchorRect, size: { width: box.width, height: box.height }, viewport });
    tipEl.style.left = `${Math.round(spot.left)}px`;
    tipEl.style.top = `${Math.round(spot.top)}px`;
    tipEl.style.setProperty('--arrow', `${Math.round(spot.arrowX)}px`);
    tipEl.dataset.side = spot.side;
    return spot.side;
  }

  // 対象 node の説明として tipEl をつなぐ（aria-describedby）。元の値を控えた { node, prev } を返す（unlink に渡すと元に戻す）。
  function link(node, tipEl) {
    const prev = node.getAttribute('aria-describedby');
    node.setAttribute('aria-describedby', tipEl.id);
    return { node, prev };
  }

  function unlink(linked) {
    if (linked.prev === null)
      linked.node.removeAttribute('aria-describedby');
    else
      linked.node.setAttribute('aria-describedby', linked.prev);
  }

  // 出す。popover が使えるときは、いったん外してから出し直す（あとから開いた窓より前に出すため）。
  function open(tipEl) {
    tipEl.hidden = false;
    if (typeof tipEl.showPopover !== 'function')
      return;
    if (typeof tipEl.hidePopover === 'function')
      tipEl.hidePopover();
    tipEl.showPopover();
  }

  function close(tipEl) {
    if (typeof tipEl.hidePopover === 'function')
      tipEl.hidePopover();
    tipEl.hidden = true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.tipView = { create, render, anchorOf, placeAt, link, unlink, open, close };
})(typeof window !== 'undefined' ? window : globalThis);
