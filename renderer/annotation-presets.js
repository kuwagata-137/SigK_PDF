(function (root) {
  'use strict';

  // 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35、spec-4-3 確定事項27〜30、spec-4-4 確定事項36〜38）。DOM に触れない。
  //
  // settings.js の ANNOT_COLORS・ANNOT_FONT_SIZES・ANNOT_LINE_WIDTHS・ANNOT_SHAPE_KINDS・ANNOT_OPACITIES と同じ並びで
  // あること（プロセスが違うので import はできない。test/settings.test.js が一致を見張る）。
  // 色と大きさの並びは自前で決めたもので、他社製品の意匠を写していない（docs/06）。

  const MARKUP_TOOLS = Object.freeze(['highlight', 'underline', 'strikeout']);
  const TOOLS = Object.freeze([...MARKUP_TOOLS, 'text', 'shape', 'pen', 'note']);
  // 道具と、注釈の種類（kind）の表示名。図形の道具（shape）は 4 種の kind を描き分ける。
  const TOOL_LABELS = Object.freeze({
    highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト', shape: '図形', pen: 'ペン', note: 'ノート',
    square: '矩形', circle: '楕円', line: '直線', arrow: '矢印', ink: 'ペン',
  });
  // 「表示のみ」の注釈（他のツールが付け、読み込んで直せないもの）の種類名。pdf.js の subtype で引く
  // （spec-4-4 確定事項36）。無ければ subtype をそのまま見せる。
  const READONLY_LABELS = Object.freeze({
    Text: 'ノート', FreeText: 'テキスト', Line: '直線', Square: '矩形', Circle: '楕円', Polygon: '多角形', PolyLine: '折れ線',
    Highlight: 'ハイライト', Underline: '下線', Squiggly: '波線', StrikeOut: '取り消し線', Stamp: 'スタンプ', Caret: '挿入記号',
    Ink: 'ペン', FileAttachment: '添付ファイル', Sound: '音声', Redact: '墨消し',
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
    // 付箋の塗り。ハイライトと同じ淡い 4 色（spec-4-4 確定事項37）。
    note: Object.freeze(['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8']),
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

  // 不透明度（spec-4-4 確定事項38）。対象はテキスト・図形・ペン・ノートで、道具ごとに最後の値を覚える。
  // ハイライトは multiply で既に文字が透けるので対象にしない。
  const OPACITIES = Object.freeze([1, 0.75, 0.5, 0.25]);
  const DEFAULT_OPACITY = 1;
  const OPACITY_TOOLS = Object.freeze(['text', 'shape', 'pen', 'note']);
  const DEFAULT_OPACITIES = Object.freeze(Object.fromEntries(OPACITY_TOOLS.map((tool) => [tool, DEFAULT_OPACITY])));

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

  function isOpacity(value) {
    return OPACITIES.includes(value);
  }

  // 不透明度を持てる種類か（引き出しが OPACITY_TOOLS のどれかになるもの）。
  function isOpacityKind(kind) {
    return OPACITY_TOOLS.includes(paletteOf(kind));
  }

  function readonlyLabelOf(subtype) {
    if (typeof subtype !== 'string' || subtype === '')
      return '注釈';
    return READONLY_LABELS[subtype] ?? subtype;
  }

  root.SigK = root.SigK || {};
  root.SigK.annotationPresets = {
    TOOLS,
    MARKUP_TOOLS,
    TOOL_LABELS,
    READONLY_LABELS,
    SHAPE_KINDS,
    DEFAULT_SHAPE_KIND,
    COLORS,
    COLOR_NAMES,
    DEFAULT_COLORS,
    FONT_SIZES,
    DEFAULT_FONT_SIZE,
    LINE_WIDTHS,
    DEFAULT_LINE_WIDTH,
    OPACITIES,
    DEFAULT_OPACITY,
    OPACITY_TOOLS,
    DEFAULT_OPACITIES,
    paletteOf,
    isPresetColor,
    isFontSize,
    isLineWidth,
    isShapeKind,
    isOpacity,
    isOpacityKind,
    readonlyLabelOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
