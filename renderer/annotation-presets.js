(function (root) {
  'use strict';

  // 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜30）。DOM に触れない。
  //
  // settings.js の ANNOT_COLORS・ANNOT_FONT_SIZES・ANNOT_LINE_WIDTHS・ANNOT_SHAPE_KINDS と同じ並びで
  // あること（プロセスが違うので import はできない。test/settings.test.js が一致を見張る）。
  // 色と大きさの並びは自前で決めたもので、他社製品の意匠を写していない（docs/06）。

  const MARKUP_TOOLS = Object.freeze(['highlight', 'underline', 'strikeout']);
  const TOOLS = Object.freeze([...MARKUP_TOOLS, 'text', 'shape', 'pen']);
  // 道具と、注釈の種類（kind）の表示名。図形の道具（shape）は 4 種の kind を描き分ける。
  const TOOL_LABELS = Object.freeze({
    highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト', shape: '図形', pen: 'ペン',
    square: '矩形', circle: '楕円', line: '直線', arrow: '矢印', ink: 'ペン',
  });

  // 「図形」の道具で描ける種類（spec-4-3 確定事項27）。
  const SHAPE_KINDS = Object.freeze(['square', 'circle', 'line', 'arrow']);
  const DEFAULT_SHAPE_KIND = 'square';

  const SHAPE_COLORS = Object.freeze(['#d92c2c', '#2c5cd9', '#2f9e5a', '#1c2430']);
  const COLORS = Object.freeze({
    highlight: Object.freeze(['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8']),
    underline: Object.freeze(['#d92c2c', '#2c5cd9', '#1c2430']),
    strikeout: Object.freeze(['#d92c2c', '#2c5cd9', '#1c2430']),
    text: Object.freeze(['#1c2430', '#d92c2c', '#2c5cd9']),
    shape: SHAPE_COLORS,
    pen: SHAPE_COLORS,
  });
  const COLOR_NAMES = Object.freeze({
    '#ffe45a': '黄', '#8ce99a': '緑', '#8fbfff': '青', '#ffa8c8': '桃', '#d92c2c': '赤', '#2c5cd9': '青', '#2f9e5a': '緑', '#1c2430': '黒',
  });
  // 既定は各プリセットの先頭。
  const DEFAULT_COLORS = Object.freeze(Object.fromEntries(TOOLS.map((kind) => [kind, COLORS[kind][0]])));

  // テキストの文字の大きさ（pt）。
  const FONT_SIZES = Object.freeze([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]);
  const DEFAULT_FONT_SIZE = 12;

  // 図形・ペンの線の太さ（pt。spec-4-3 確定事項29）。
  const LINE_WIDTHS = Object.freeze([1, 2, 3, 5, 8]);
  const DEFAULT_LINE_WIDTH = 2;

  // 色のプリセットを引く鍵。図形 4 種は 'shape' の色を共有し、ペン（ink）は 'pen'（確定事項28）。
  function paletteOf(kind) {
    if (SHAPE_KINDS.includes(kind))
      return 'shape';
    return kind === 'ink' ? 'pen' : kind;
  }

  function isPresetColor(kind, color) {
    return COLORS[paletteOf(kind)]?.includes(color) === true;
  }

  function isFontSize(size) {
    return FONT_SIZES.includes(size);
  }

  function isLineWidth(width) {
    return LINE_WIDTHS.includes(width);
  }

  function isShapeKind(kind) {
    return SHAPE_KINDS.includes(kind);
  }

  root.SigK = root.SigK || {};
  root.SigK.annotationPresets = {
    TOOLS,
    MARKUP_TOOLS,
    TOOL_LABELS,
    SHAPE_KINDS,
    DEFAULT_SHAPE_KIND,
    COLORS,
    COLOR_NAMES,
    DEFAULT_COLORS,
    FONT_SIZES,
    DEFAULT_FONT_SIZE,
    LINE_WIDTHS,
    DEFAULT_LINE_WIDTH,
    paletteOf,
    isPresetColor,
    isFontSize,
    isLineWidth,
    isShapeKind,
  };
})(typeof window !== 'undefined' ? window : globalThis);
