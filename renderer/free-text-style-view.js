(function (root) {
  'use strict';

  // 右パネルのテキストの行（文字の大きさ・書式・枠線）と、太さの行に出す形（spec-4b-4a 確定事項G1・G3〜G5）。DOM に触れない。
  // annotation-style-patch.js の viewOf が呼ぶ。targets は annotation-style-patch.js の targetOf の形（道具の次に付ける値も同じ形）。
  //
  // テキストにだけある行は、テキスト以外も混ざっていれば名に「（テキスト）」を付ける。太さの行は図形・ペンの線とテキストの枠線
  // （枠線のあるもの）の両方に当たり、名は「線の太さ」（図形だけ）・「枠線の太さ」（テキストだけ）・「線と枠線の太さ」（両方）。

  // 欄の値。主（最後）の値と、ほかとそろっていないか。
  function valueOf(list, field) {
    const value = list.at(-1)[field];
    return { value, mixed: list.some((target) => target[field] !== value) };
  }

  function textsOf(live) {
    return live.filter((target) => target.kind === 'text');
  }

  function labelOf(texts, live, label) {
    return texts.length < live.length ? `${label}（テキスト）` : label;
  }

  // 文字の大きさ・書式・枠線の行。テキストが無ければどれも null。
  function textViewsOf(live) {
    const texts = textsOf(live);
    if (texts.length === 0)
      return { fontSize: null, format: null, border: null };
    return {
      fontSize: { ...valueOf(texts, 'fontSize'), label: labelOf(texts, live, '文字の大きさ') },
      format: { bold: valueOf(texts, 'bold'), italic: valueOf(texts, 'italic'), label: labelOf(texts, live, '書式') },
      border: { ...valueOf(texts, 'border'), label: labelOf(texts, live, '枠線') },
    };
  }

  // 太さの行。当たるものが無ければ null。
  function widthViewOf(live) {
    const drawn = live.filter((target) => root.SigK.annotationEntry?.isDrawnKind(target.kind) === true);
    const bordered = textsOf(live).filter((target) => (target.border ?? null) !== null);
    const list = live.filter((target) => drawn.includes(target) || bordered.includes(target));
    if (list.length === 0)
      return null;
    const label = bordered.length === 0 ? '線の太さ' : (drawn.length === 0 ? '枠線の太さ' : '線と枠線の太さ');
    return { ...valueOf(list, 'lineWidth'), label };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextStyleView = { textViewsOf, widthViewOf };
})(typeof window !== 'undefined' ? window : globalThis);
