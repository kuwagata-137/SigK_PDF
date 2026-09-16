(function (root) {
  'use strict';

  // 画面のテキスト注釈（spec-4-2 確定事項10・14・29・33）。
  //
  // 同梱フォント（shell.css の @font-face 'SigK Noto Sans JP'）の先読み、幅の計測
  // （canvas の measureText。保存側の widthOfTextAtSize と日本語で一致する。事前調査 D）、
  // SVG の <text>、印刷用の canvas 2D の描き手を持つ。座標の計算は free-text-geometry.js。
  // SVG と canvas で同じ位置・角度・ベースラインにするのは、画面と紙で見た目を
  // ずらさないためである（annotation-layer.js と同じ考え）。

  const FAMILY = 'SigK Noto Sans JP';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const state = { loaded: false, loading: null, contexts: new WeakMap() };

  function geometry() {
    return root.SigK.freeTextGeometry;
  }

  function fmt(value) {
    return String(Math.round(value * 100) / 100);
  }

  function fontOf(px) {
    return `${px}px "${FAMILY}"`;
  }

  // フォントを先読みする。注釈モードに入ったとき・自前のテキストを読み込んだとき・
  // 印刷の前に呼ぶ（39ms。事前調査 D）。document.fonts が無い（jsdom）なら false。
  async function ensureLoaded(doc) {
    if (state.loaded)
      return true;
    if (typeof doc?.fonts?.load !== 'function')
      return false;
    if (state.loading === null) {
      state.loading = doc.fonts.load(fontOf(12)).then(() => {
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
    if (typeof doc.defaultView?.CanvasRenderingContext2D === 'undefined')
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
    return ctx.measureText(text).width;
  }

  // 画面に描くための位置。origin は表示の左上（CSS px）、angle は画面での回転（時計回り）。
  function layoutOf(entry, viewport) {
    const [x, y] = geometry().frameOrigin(entry.rect, entry.rotation);
    return {
      origin: viewport.convertToViewportPoint(x, y),
      angle: geometry().screenAngle(viewport.rotation ?? 0, entry.rotation),
      scale: viewport.scale ?? 1,
      lines: geometry().linesOf(entry.text),
    };
  }

  // 行ごとの x・y（箱の左上からの CSS px）。
  function linePositions(lines, fontSize, scale) {
    const { PADDING, BASELINE, LINE_HEIGHT } = geometry();
    return lines.map((line, index) => ({
      line,
      x: PADDING * scale,
      y: (PADDING + BASELINE * fontSize + LINE_HEIGHT * fontSize * index) * scale,
    }));
  }

  // SVG の <g>。行ごとに <text> を置き、箱の左上へ移して回す。
  function svgOf(doc, entry, viewport) {
    const { origin, angle, scale, lines } = layoutOf(entry, viewport);
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'free-text');
    group.setAttribute('fill', entry.color);
    group.setAttribute('transform', `translate(${fmt(origin[0])} ${fmt(origin[1])}) rotate(${angle})`);
    for (const { line, x, y } of linePositions(lines, entry.fontSize, scale)) {
      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', fmt(x));
      text.setAttribute('y', fmt(y));
      text.setAttribute('font-size', fmt(entry.fontSize * scale));
      text.setAttribute('xml:space', 'preserve');
      text.textContent = line;
      group.append(text);
    }
    return group;
  }

  // 同じ絵を canvas 2D に描く（印刷。確定事項29）。戻り値は描いた行数。
  function paint(ctx, entry, viewport) {
    const { origin, angle, scale, lines } = layoutOf(entry, viewport);
    ctx.save();
    ctx.globalAlpha = entry.opacity !== undefined && entry.opacity < 1 ? entry.opacity : 1;
    ctx.translate(origin[0], origin[1]);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.font = fontOf(entry.fontSize * scale);
    ctx.fillStyle = entry.color;
    ctx.textBaseline = 'alphabetic';
    for (const { line, x, y } of linePositions(lines, entry.fontSize, scale))
      ctx.fillText(line, x, y);
    ctx.restore();
    return lines.length;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextShape = { FAMILY, fontOf, ensureLoaded, isLoaded, measure, layoutOf, svgOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
