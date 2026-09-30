(function (root) {
  'use strict';

  // 書き込みの色のパレット（spec-4b-1b 確定事項10〜13。docs/07 決定47 ②）。DOM に触れない。
  //
  // 値と濃淡の作り方は CheckListMaker の画像エディタ（MIT。index.html、eef4a35）と同じで、出所は THIRD-PARTY-NOTICES.md と
  // docs/06 2-1 に書いた。テーマの色 10 の下に濃淡 5 段、その下に標準の色 10 を並べ、7 段 × 10 列になる。
  // 色は小文字の #rrggbb で持ち、画面では大文字で見せる（確定事項13）。

  const THEME_COLORS = Object.freeze(['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47']);
  const STANDARD_COLORS = Object.freeze(['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0']);

  // 濃淡の割合（上の段から）。白の列は暗く、黒の列は明るく、薄い灰の列は大きく暗く、ほかの列は明るい 3 段と暗い 2 段（確定事項11）。
  const COLUMN_TINTS = Object.freeze([
    Object.freeze([-0.05, -0.15, -0.25, -0.35, -0.5]),
    Object.freeze([0.5, 0.35, 0.25, 0.15, 0.05]),
    Object.freeze([-0.1, -0.25, -0.5, -0.75, -0.9]),
  ]);
  const OTHER_TINTS = Object.freeze([0.8, 0.6, 0.4, -0.25, -0.5]);
  const TINT_ROWS = 5;

  const HEX = /^#[0-9a-f]{6}$/i;

  function isHexColor(value) {
    return typeof value === 'string' && HEX.test(value);
  }

  // 小文字の #rrggbb にする。色でなければ null。
  function normalizeHex(value) {
    return isHexColor(value) ? value.toLowerCase() : null;
  }

  function channelsOf(hex) {
    return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  }

  function hexOf(channels) {
    return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  // t ≥ 0 は白へ v + (255 − v)t、t < 0 は黒へ v(1 + t) 寄せ、四捨五入して 0〜255 に収める。
  function tint(hex, t) {
    return hexOf(channelsOf(hex).map((value) => {
      const moved = t >= 0 ? value + (255 - value) * t : value * (1 + t);
      return Math.max(0, Math.min(255, Math.round(moved)));
    }));
  }

  // テーマの色の column 列の濃淡 5 段（上から）。
  function tintsOf(column) {
    const ratios = COLUMN_TINTS[column] ?? OTHER_TINTS;
    return ratios.map((t) => tint(THEME_COLORS[column], t));
  }

  const TINT_COLUMNS = THEME_COLORS.map((_, column) => tintsOf(column));
  const PALETTE_ROWS = Object.freeze([
    THEME_COLORS,
    ...Array.from({ length: TINT_ROWS }, (_, row) => Object.freeze(TINT_COLUMNS.map((column) => column[row]))),
    STANDARD_COLORS,
  ]);
  const PALETTE_COLORS = new Set(PALETTE_ROWS.flat());

  function isPaletteColor(value) {
    const hex = normalizeHex(value);
    return hex !== null && PALETTE_COLORS.has(hex);
  }

  // 画面に見せる色の名前（大文字の #RRGGBB）。パレットの色の読み上げ名にも使う。
  function labelOf(value) {
    const hex = normalizeHex(value);
    return hex === null ? '' : hex.toUpperCase();
  }

  root.SigK = root.SigK || {};
  root.SigK.annotationPalette = {
    THEME_COLORS,
    STANDARD_COLORS,
    PALETTE_ROWS,
    isHexColor,
    normalizeHex,
    tint,
    tintsOf,
    isPaletteColor,
    labelOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
