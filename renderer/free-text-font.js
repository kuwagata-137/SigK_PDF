(function (root) {
  'use strict';

  // テキスト注釈の書体と字の幅（spec-4-2 確定事項33、spec-4b-4a 確定事項B6・D4）。free-text-shape.js から移した（spec-4b-4b。
  // 200 行の目安。中身は変えていない）。free-text-shape.js は今までの呼び名（freeTextShape.measure など）のままここへ渡す。
  //
  // 同梱フォント（shell.css の @font-face 'SigK Noto Sans JP'）の先読みと、幅の計測（canvas の measureText。保存側の
  // widthOfTextAtSize と日本語で一致する。事前調査 D）を持つ。詰め（kerning）は切って測る（保存の字の並びとそろえる。事前調査 E）。

  const FAMILY = 'SigK Noto Sans JP';
  // 字の送り幅を測る大きさ（px）。小さいと canvas の丸めが効く（事前調査 E。7〜4000px で比例）。
  const ADVANCE_PX = 1000;

  // advances は字ごとの送り幅（em）の覚え。標準と太字で分ける。フォントが読めてから覚える（読む前は代わりの書体で測るため）。
  const state = { loaded: false, loading: null, contexts: new WeakMap(), advances: { regular: new Map(), bold: new Map() } };

  function fontOf(px, bold = false, italic = false) {
    return `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${px}px "${FAMILY}"`;
  }

  // フォントを先読みする。注釈モードに入ったとき・自前のテキストを読み込んだとき・
  // 印刷の前に呼ぶ（39ms。事前調査 D）。標準と太字の両方を待つ（spec-4b-4a 確定事項D4）。document.fonts が無い（jsdom）なら false。
  async function ensureLoaded(doc) {
    if (state.loaded)
      return true;
    if (typeof doc?.fonts?.load !== 'function')
      return false;
    if (state.loading === null) {
      state.loading = Promise.all([doc.fonts.load(fontOf(12)), doc.fonts.load(fontOf(12, true))]).then(() => {
        state.loaded = true;
        return true;
      }, () => false);
    }
    return state.loading;
  }

  function isLoaded() {
    return state.loaded;
  }

  // 測るための canvas。jsdom には 2D コンテキストが無く、getContext を呼ぶと「Not implemented」が
  // コンソールに出るので、呼ぶ前に確かめる（page-render.js と同じ）。
  function contextOf(doc) {
    if (typeof doc?.defaultView?.CanvasRenderingContext2D === 'undefined')
      return null;
    if (!state.contexts.has(doc))
      state.contexts.set(doc, doc.createElement('canvas').getContext('2d'));
    return state.contexts.get(doc);
  }

  // 1 行の幅（px。倍率 1 なら pt）。canvas が無ければ全角 1em・半角 0.5em の見積もり。
  function measure(doc, text, px) {
    const ctx = contextOf(doc);
    if (ctx === null)
      return [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0) * px;
    ctx.font = fontOf(px);
    ctx.fontKerning = 'none';
    const width = ctx.measureText(text).width;
    ctx.fontKerning = 'auto';
    return width;
  }

  // 字（書記素）の送り幅（em）。新しい形の折り返しと箱に使う（spec-4b-4a 確定事項B6）。kerning を切った canvas で ADVANCE_PX で測り、
  // 字ごとに覚える（保存側の hmtx と一致する。事前調査 E）。canvas が無ければ全角 1em・半角 0.5em の見積もり。
  function advanceOf(doc, unit, bold = false) {
    const ctx = contextOf(doc);
    if (ctx === null)
      return unit.charCodeAt(0) < 128 ? 0.5 : 1;
    const cache = bold ? state.advances.bold : state.advances.regular;
    const known = cache.get(unit);
    if (known !== undefined)
      return known;
    ctx.font = fontOf(ADVANCE_PX, bold);
    ctx.fontKerning = 'none';
    const em = ctx.measureText(unit).width / ADVANCE_PX;
    ctx.fontKerning = 'auto';
    if (state.loaded)
      cache.set(unit, em);
    return em;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextFont = { FAMILY, ADVANCE_PX, fontOf, ensureLoaded, isLoaded, measure, advanceOf };
})(typeof window !== 'undefined' ? window : globalThis);
