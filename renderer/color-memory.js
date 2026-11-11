(function (root) {
  'use strict';

  // 色の一覧の「最近使用した色」と、分割ボタンの左側で塗る「直前の色」（spec-7-2 確定事項A4・B2・D5）。
  //
  // どちらも settings.json に書き（annotRecentColors・annotLastColors）、PDF には書かない。PDF に書くと、色を選んだだけで「変更あり」に
  // なるためである。最近使用した色は「色の設定」の画面で選んだ色だけで、色の一覧に並ぶ色は足さない（一覧に出ているため。Office と同じ）。
  // 直前の色の役割は 線（線の色・枠線）・塗り・文字（文字の色・透かし）・色（ハイライトなどの色の行）の 4 つと、一括の組の番号。

  const ROLES = Object.freeze(['line', 'fill', 'font', 'mark']);
  const DEFAULT_LAST = Object.freeze({ line: '#ed7d31', fill: '#5b9bd5', font: '#ff0000', mark: '#ffff00', style: 8 });

  const state = { recent: [], last: { ...DEFAULT_LAST } };

  function palette() {
    return root.SigK.annotationPalette;
  }

  function persist(patch) {
    root.SigK.shell?.persist?.(patch);
  }

  function recent() {
    return [...state.recent];
  }

  function lastOf(role) {
    return state.last[role] ?? null;
  }

  function lastStyle() {
    return state.last.style;
  }

  function isStyleIndex(value) {
    return Number.isInteger(value) && value >= 0 && value < palette().STYLE_SETS.length;
  }

  // 起動時に settings.json から戻す。形の合わない値は捨てる。
  function apply({ recentColors, lastColors } = {}) {
    if (Array.isArray(recentColors))
      state.recent = [...new Set(recentColors.map((color) => palette().normalizeHex(color)).filter((color) => color !== null))].slice(0, palette().RECENT_MAX);
    for (const role of ROLES) {
      const value = palette().normalizeHex(lastColors?.[role]);
      if (value !== null)
        state.last[role] = value;
    }
    if (isStyleIndex(lastColors?.style))
      state.last.style = lastColors.style;
    root.SigK.annotationProps?.refresh();
    return { recent: recent(), last: { ...state.last } };
  }

  // 「色の設定」の画面で選んだ色を、最近使用した色の先頭に足す。一覧の色は足さない。足したら true。
  function pushRecent(color) {
    const value = palette().normalizeHex(color);
    if (value === null || palette().isPaletteColor(value))
      return false;
    const next = [value, ...state.recent.filter((each) => each !== value)].slice(0, palette().RECENT_MAX);
    if (next.join() === state.recent.join())
      return false;
    state.recent = next;
    persist({ annotRecentColors: recent() });
    return true;
  }

  // 一覧か色の設定の画面で選んだ色を、その役割の直前の色にする。［なし］（null）は直前の色にしない。
  function setLast(role, color) {
    const value = palette().normalizeHex(color);
    if (!ROLES.includes(role) || value === null || state.last[role] === value)
      return false;
    state.last[role] = value;
    persist({ annotLastColors: { [role]: value } });
    return true;
  }

  function setLastStyle(index) {
    if (!isStyleIndex(index) || state.last.style === index)
      return false;
    state.last.style = index;
    persist({ annotLastColors: { style: index } });
    return true;
  }

  function reset() {
    state.recent = [];
    state.last = { ...DEFAULT_LAST };
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.colorMemory = { ROLES, DEFAULT_LAST, recent, lastOf, lastStyle, apply, pushRecent, setLast, setLastStyle, reset };
})(typeof window !== 'undefined' ? window : globalThis);
