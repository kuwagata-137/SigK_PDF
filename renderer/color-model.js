(function (root) {
  'use strict';

  // 「色の設定」の画面の色の計算（spec-7-2 確定事項C2）。DOM に触れない。
  //
  // RGB は 0〜255 の整数、HSL は色合い 0〜360・鮮やかさ 0〜1・明るさ 0〜1 で持つ。「標準」のタブの六角形の色は、中心を白にして外へ向かって
  // 鮮やかに、上を明るく下を暗く並べ、各色を 51 刻み（00・33・66・99・CC・FF）にそろえる。作り方は MultipurposeDiagramMaker v8.34 と同じ考えで、
  // Office の色と 1 つずつは一致しない。

  const HEX = /^#[0-9a-f]{6}$/i;

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  function hexOf([r, g, b]) {
    return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
  }

  // '#rrggbb' → [r, g, b]。色でなければ null。
  function rgbOf(hex) {
    if (typeof hex !== 'string' || !HEX.test(hex))
      return null;
    return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  }

  // 「#」を省いた 6 桁も受け、小文字の '#rrggbb' にする。受けられなければ null。
  function parseHex(text) {
    if (typeof text !== 'string')
      return null;
    const trimmed = text.trim();
    const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    return HEX.test(hex) ? hex.toLowerCase() : null;
  }

  function rgbToHsl(r, g, b) {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const l = (max + min) / 2;
    if (max === min)
      return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rr)
      h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (max === gg)
      h = (bb - rr) / d + 2;
    else
      h = (rr - gg) / d + 4;
    return [h * 60, s, l];
  }

  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  }

  // 六角形の頂点を結ぶ SVG の道筋（上が尖る向き）。
  function hexagonPath(cx, cy, radius) {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 90);
      points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`);
    }
    return `M${points.join('L')}Z`;
  }

  const STANDARD_RADIUS = 9.2;
  const STANDARD_RINGS = 6;
  const GRAY_COUNT = 15;

  // 「標準」のタブの色。戻り値は [{ x, y, color }] で、六角形の 127 色のあとに灰色 15 色が続く（白から黒へ）。座標は SVG の座標。
  function standardCells() {
    const width = STANDARD_RADIUS * Math.sqrt(3);
    const snap = (value) => Math.round(value / 51) * 51;
    const cells = [];
    for (let r = -STANDARD_RINGS; r <= STANDARD_RINGS; r++) {
      for (let q = -STANDARD_RINGS; q <= STANDARD_RINGS; q++) {
        const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
        if (dist > STANDARD_RINGS)
          continue;
        const x = width * (q + r / 2);
        const y = 1.5 * STANDARD_RADIUS * r;
        const t = dist / STANDARD_RINGS;
        const hue = (Math.atan2(y, x) * 180 / Math.PI + 360 + 150) % 360;
        const light = Math.max(0.2, Math.min(0.95, (1 - 0.5 * t) - (y / (1.5 * STANDARD_RADIUS * STANDARD_RINGS)) * 0.14 * t));
        cells.push({ x, y, color: dist === 0 ? '#ffffff' : hexOf(hslToRgb(hue, 1, light).map(snap)) });
      }
    }
    for (let i = 0; i < GRAY_COUNT; i++) {
      const value = Math.round(255 - 255 * i / (GRAY_COUNT - 1));
      cells.push({ x: (i - 7) * width * 0.5, y: 122 + (i % 2 ? 1.5 * STANDARD_RADIUS : 0), color: hexOf([value, value, value]) });
    }
    return cells;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.colorModel = { STANDARD_RADIUS, clampByte, hexOf, rgbOf, parseHex, rgbToHsl, hslToRgb, hexagonPath, standardCells };
})(typeof window !== 'undefined' ? window : globalThis);
