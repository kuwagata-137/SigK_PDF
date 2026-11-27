(function (root) {
  'use strict';

  // テキスト注釈の書体と字の幅（spec-4-2 確定事項33、spec-4b-4a 確定事項B6・D4）。free-text-shape.js から移した（spec-4b-4b。
  // 200 行の目安。中身は変えていない）。free-text-shape.js は今までの呼び名（freeTextShape.measure など）のままここへ渡す。
  //
  // 同梱フォント（shell.css の @font-face 'SigK Noto Sans JP'）の先読みと、幅の計測（canvas の measureText。保存側の
  // widthOfTextAtSize と日本語で一致する。事前調査 D）を持つ。詰め（kerning）は切って測る（保存の字の並びとそろえる。事前調査 E）。

  // 描く時の font-family は、フォントの一覧（text-fonts.js。版 1.5.0 の③）から取る。fontId は書き込みの font の欄（無い・このパソコンで
  // 使えない時は既定の Noto Sans JP）。
  function family(fontId) {
    return root.SigK.textFonts.usableFont(fontId).family;
  }

  // 太字の書体で描くか。太字の書体が無いフォント（MS ゴシック・MS 明朝）の太字は、標準の書体で描き、文字の線を太くする（擬似太字）。
  function boldOf(bold, fontId) {
    return bold === true && root.SigK.textFonts.hasBold(fontId);
  }

  // 擬似太字の線の太さ（字の大きさに掛ける。保存の側 worker/text-fonts.js の SYNTHETIC_BOLD_RATIO と同じ）。質問 FT3「案B 擬似太字」。
  const SYNTHETIC_BOLD_RATIO = 1 / 30;

  // 擬似太字で描くか（太字で、太字の書体が無いフォント）。字の送り幅は標準の書体のまま（線は幅を変えない。PDF の 2 Tr と同じ）。
  function syntheticBoldOf(bold, fontId) {
    return bold === true && !root.SigK.textFonts.hasBold(fontId);
  }
  // 字の送り幅を測る大きさ（px）。小さいと canvas の丸めが効く（事前調査 E。7〜4000px で比例）。
  const ADVANCE_PX = 1000;

  // advances は字ごとの送り幅（em）の覚え。フォントと、標準と太字で分ける（鍵は「font-family|bold か regular」）。同梱のフォントは
  // 読めてから覚える（読む前は代わりの書体で測るため）。Windows のフォントは初めから使えるので、いつも覚える。
  const state = { loaded: false, loading: null, contexts: new WeakMap(), advances: new Map() };

  function fontOf(px, bold = false, italic = false, fontId = undefined) {
    return `${italic ? 'italic ' : ''}${boldOf(bold, fontId) ? '700 ' : ''}${px}px "${family(fontId)}"`;
  }

  function advanceCache(fontId, bold) {
    const key = `${family(fontId)}|${boldOf(bold, fontId) ? 'bold' : 'regular'}`;
    if (!state.advances.has(key))
      state.advances.set(key, new Map());
    return state.advances.get(key);
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

  // 1 行の幅（px。倍率 1 なら pt）。canvas が無ければ全角 1em・半角 0.5em の見積もり。fontId は書き込みの font の欄。
  function measure(doc, text, px, fontId = undefined) {
    const ctx = contextOf(doc);
    if (ctx === null)
      return [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? 0.5 : 1), 0) * px;
    ctx.font = fontOf(px, false, false, fontId);
    ctx.fontKerning = 'none';
    const width = ctx.measureText(text).width;
    ctx.fontKerning = 'auto';
    return width;
  }

  // 字（書記素）の送り幅（em）。新しい形の折り返しと箱に使う（spec-4b-4a 確定事項B6）。kerning を切った canvas で ADVANCE_PX で測り、
  // 字ごとに覚える（保存側の hmtx と一致する。事前調査 E）。canvas が無ければ全角 1em・半角 0.5em の見積もり。
  function advanceOf(doc, unit, bold = false, fontId = undefined) {
    const ctx = contextOf(doc);
    if (ctx === null)
      return unit.charCodeAt(0) < 128 ? 0.5 : 1;
    const cache = advanceCache(fontId, bold);
    const known = cache.get(unit);
    if (known !== undefined)
      return known;
    ctx.font = fontOf(ADVANCE_PX, bold, false, fontId);
    ctx.fontKerning = 'none';
    const em = ctx.measureText(unit).width / ADVANCE_PX;
    ctx.fontKerning = 'auto';
    if (state.loaded || !root.SigK.textFonts.usableFont(fontId).bundled)
      cache.set(unit, em);
    return em;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextFont = { get FAMILY() { return family(); }, ADVANCE_PX, SYNTHETIC_BOLD_RATIO, family, boldOf, syntheticBoldOf, fontOf, ensureLoaded, isLoaded, measure, advanceOf };
})(typeof window !== 'undefined' ? window : globalThis);
