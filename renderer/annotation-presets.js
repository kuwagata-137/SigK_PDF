(function (root) {
  'use strict';

  // 注釈のプリセット（spec-4-1 確定事項33、spec-4-2 確定事項34・35）。DOM に触れない。
  //
  // settings.js の ANNOT_COLORS・ANNOT_FONT_SIZES と同じ並びであること（プロセスが違うので
  // import はできない。test/settings.test.js が一致を見張る）。色と大きさの並びは自前で
  // 決めたもので、他社製品の意匠を写していない（docs/06）。

  const MARKUP_TOOLS = Object.freeze(['highlight', 'underline', 'strikeout']);
  const TOOLS = Object.freeze([...MARKUP_TOOLS, 'text']);
  const TOOL_LABELS = Object.freeze({ highlight: 'ハイライト', underline: '下線', strikeout: '取り消し線', text: 'テキスト' });

  const COLORS = Object.freeze({
    highlight: Object.freeze(['#ffe45a', '#8ce99a', '#8fbfff', '#ffa8c8']),
    underline: Object.freeze(['#d92c2c', '#2c5cd9', '#1c2430']),
    strikeout: Object.freeze(['#d92c2c', '#2c5cd9', '#1c2430']),
    text: Object.freeze(['#1c2430', '#d92c2c', '#2c5cd9']),
  });
  const COLOR_NAMES = Object.freeze({
    '#ffe45a': '黄', '#8ce99a': '緑', '#8fbfff': '青', '#ffa8c8': '桃', '#d92c2c': '赤', '#2c5cd9': '青', '#1c2430': '黒',
  });
  // 既定は各プリセットの先頭。
  const DEFAULT_COLORS = Object.freeze(Object.fromEntries(TOOLS.map((kind) => [kind, COLORS[kind][0]])));

  // テキストの文字の大きさ（pt）。
  const FONT_SIZES = Object.freeze([8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48]);
  const DEFAULT_FONT_SIZE = 12;

  function isPresetColor(kind, color) {
    return COLORS[kind]?.includes(color) === true;
  }

  function isFontSize(size) {
    return FONT_SIZES.includes(size);
  }

  root.SigK = root.SigK || {};
  root.SigK.annotationPresets = {
    TOOLS,
    MARKUP_TOOLS,
    TOOL_LABELS,
    COLORS,
    COLOR_NAMES,
    DEFAULT_COLORS,
    FONT_SIZES,
    DEFAULT_FONT_SIZE,
    isPresetColor,
    isFontSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
