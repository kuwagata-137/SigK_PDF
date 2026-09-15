(function (root) {
  'use strict';

  // 文字の選択範囲を、ページごとの四角（pt）に切る層（spec-4-1 確定事項11〜14）。
  //
  // テキストレイヤーの span ごとに部分 Range を作り、その矩形（CSS px）を
  // .pdf-page 基準にして pt へ戻す。縦の範囲は span と並ぶ item のフォントから
  // 決める（markup-quads.js の quadFromItem）。ページをまたぐ選択はページごとに
  // 分ける（PDF の注釈は 1 ページに属する）。
  //
  // 矩形を測る口（rectsOf）は差し替えられる。jsdom は Range.getClientRects() が
  // 空を返すので、テストは span の位置から矩形を作る口を渡す。

  const MIN_SIZE = 0.5;
  const TEXT_LIMIT = 200;

  function quads() {
    return root.SigK.markupQuads;
  }

  function textNodeOf(div) {
    return div.firstChild ?? div;
  }

  // range と div の重なりを部分 Range にする。div の外側は div の端で切る。
  function clipRange(doc, range, div) {
    const sub = doc.createRange();
    const node = textNodeOf(div);
    if (div.contains(range.startContainer))
      sub.setStart(range.startContainer, range.startOffset);
    else
      sub.setStart(node, 0);
    if (div.contains(range.endContainer))
      sub.setEnd(range.endContainer, range.endOffset);
    else
      sub.setEnd(node, node.textContent?.length ?? 0);
    return sub;
  }

  // 矩形の並びを 1 つの外接にする（1 つの span は 1 行なので 1 つでよい）。
  function boundsOf(rects, base) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const rect of rects) {
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE)
        continue;
      left = Math.min(left, rect.left - base.left);
      top = Math.min(top, rect.top - base.top);
      right = Math.max(right, rect.right - base.left);
      bottom = Math.max(bottom, rect.bottom - base.top);
    }
    return left === Infinity ? null : { left, top, right, bottom };
  }

  // 1 ページぶん。handle は text-layer.js の render() が返したもの。
  function collectPage({ doc, range, node, handle, rectsOf }) {
    const divs = handle.textDivs();
    const items = handle.items();
    const styles = handle.styles();
    const base = node.getBoundingClientRect();
    const found = [];
    const texts = [];
    divs.forEach((div, index) => {
      if (!div.isConnected || !range.intersectsNode(div))
        return;
      const sub = clipRange(doc, range, div);
      if (sub.collapsed)
        return;
      const bounds = boundsOf(rectsOf(sub, div), base);
      if (bounds === null)
        return;
      const quad = quads().cssRectToQuad(bounds, handle.viewport);
      const item = items[index];
      found.push(quads().quadFromItem(quad, item, styles[item?.fontName]));
      texts.push(sub.toString());
    });
    if (found.length === 0)
      return null;
    return { quads: found, rect: quads().unionRect(found), text: texts.join('').slice(0, TEXT_LIMIT) };
  }

  // 選択範囲をページごとに切る。pages は [{ index, src, node, handle }]（描いてあるページ）。
  // 戻り値は [{ index, src, quads, rect, text }]。何も無ければ空。
  function collect({ doc, selection, pages, rectsOf = (range) => range.getClientRects() }) {
    if (selection === null || selection === undefined || selection.rangeCount === 0 || selection.isCollapsed)
      return [];
    const result = [];
    for (let number = 0; number < selection.rangeCount; number += 1) {
      const range = selection.getRangeAt(number);
      for (const page of pages) {
        if (page.handle === null || page.handle === undefined || !range.intersectsNode(page.node))
          continue;
        const found = collectPage({ doc, range, node: page.node, handle: page.handle, rectsOf });
        if (found !== null)
          result.push({ index: page.index, src: page.src, ...found });
      }
    }
    return result;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markupSelection = { TEXT_LIMIT, collect, collectPage, clipRange };
})(typeof window !== 'undefined' ? window : globalThis);
