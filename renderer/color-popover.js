(function (root) {
  'use strict';

  // 色のパレットの窓（spec-4b-1b 確定事項6・10〜13。モック screenshots/phase4b-style-palette.png）。
  //
  // 右パネルの色・塗りのチップを押すと、右パネルの左、紙の上に重ねて開く。中身は 見出し → テーマの色 10 → 濃淡 5 段 → 標準の色 10 →
  // 下の段［なし］［その他の色…］で、色の値は annotation-palette.js。今の色に印を付ける。外を押す・Esc・色を選ぶ、のどれでも閉じる。
  // ［なし］は塗りと、四角・丸の線の色だけに出し、押せないときは薄くする。［その他の色…］は OS の色の選択（隠した
  // <input type="color">）を開き、選んだ色を当てて閉じる。窓の中のキーは viewer-controls.js が素通しする（.color-pop）。

  const WIDTH = 268;
  // 右パネルの左端との間（左端は右パネルの左端から 276px 左）。
  const GAP = 8;
  // 上端は行の上端の 40px 上。90px より上には出さない。窓の下にはみ出すなら上へずらす。
  const ABOVE = 40;
  const TOP_MIN = 90;
  const MARGIN = 8;

  const state = { doc: null, el: null, parts: null, anchor: null, onPick: null, onClose: null };

  function palette() {
    return root.SigK.annotationPalette;
  }

  function node(tag, className, text) {
    const element = state.doc.createElement(tag);
    if (className)
      element.className = className;
    if (text !== undefined)
      element.textContent = text;
    return element;
  }

  function cellOf(color) {
    const cell = node('button', 'cell');
    cell.type = 'button';
    cell.dataset.color = color;
    cell.style.background = color;
    cell.title = palette().labelOf(color);
    cell.setAttribute('aria-label', cell.title);
    cell.addEventListener('click', () => pick(color));
    return cell;
  }

  function gridOf(colors, className = 'grid') {
    const grid = node('div', className);
    grid.append(...colors.map(cellOf));
    return grid;
  }

  // 中身は 1 度だけ組む（パレットは固定の 70 色）。
  function build() {
    const rows = palette().PALETTE_ROWS;
    const title = node('p', 'ttl');
    const none = node('button', 'none');
    none.type = 'button';
    const noneLabel = node('span', 'label');
    none.append(node('span', 'mini none'), noneLabel);
    none.addEventListener('click', () => {
      if (none.getAttribute('aria-disabled') !== 'true')
        pick(null);
    });
    const other = node('button', 'other');
    other.type = 'button';
    other.append(node('span', 'mini other'), state.doc.createTextNode('その他の色…'));
    const input = node('input', 'other-input');
    input.type = 'color';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    other.addEventListener('click', () => input.click());
    input.addEventListener('change', () => pick(input.value));
    const foot = node('div', 'foot');
    foot.append(none, other, input);
    state.el.replaceChildren(title, node('p', 'sub', 'テーマの色'), gridOf(rows[0]), gridOf(rows.slice(1, -1).flat(), 'grid shades'),
      node('p', 'sub', '標準の色'), gridOf(rows.at(-1)), foot);
    state.parts = { title, none, noneLabel, input };
  }

  function place(row) {
    const win = state.doc.defaultView;
    const panel = state.doc.getElementById('props')?.getBoundingClientRect();
    const top = Math.max(TOP_MIN, row.getBoundingClientRect().top - ABOVE);
    const height = state.el.offsetHeight;
    const bottom = win.innerHeight - MARGIN;
    state.el.style.left = `${Math.max(MARGIN, (panel?.left ?? win.innerWidth) - WIDTH - GAP)}px`;
    state.el.style.top = `${top + height > bottom ? Math.max(MARGIN, bottom - height) : top}px`;
  }

  function onOutside(event) {
    if (!state.el.contains(event.target) && state.anchor?.contains(event.target) !== true)
      close();
  }

  function onKey(event) {
    if (event.key !== 'Escape')
      return;
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  }

  // 開く。anchor は押したチップ、current は今の色（null は「なし」）、none は［なし］の { label, enabled }（出さないなら null）、
  // onPick は選んだ色（［なし］は null）を受ける。onClose は閉じたとき（チップの印を外す）。
  function open(anchor, { title, current = null, none = null, onPick, onClose = null }) {
    if (state.el === null)
      return false;
    close();
    state.anchor = anchor;
    state.onPick = onPick;
    state.onClose = onClose;
    state.parts.title.textContent = title;
    state.el.setAttribute('aria-label', title);
    const hex = palette().normalizeHex(current);
    for (const cell of state.el.querySelectorAll('.cell')) {
      cell.classList.toggle('on', cell.dataset.color === hex);
      cell.setAttribute('aria-pressed', String(cell.dataset.color === hex));
    }
    state.parts.none.hidden = none === null;
    state.parts.noneLabel.textContent = none?.label ?? '';
    if (none?.enabled === false)
      state.parts.none.setAttribute('aria-disabled', 'true');
    else
      state.parts.none.removeAttribute('aria-disabled');
    state.parts.input.value = hex ?? '#000000';
    state.el.hidden = false;
    place(anchor.closest('.prop') ?? anchor);
    anchor.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    state.doc.addEventListener('mousedown', onOutside, true);
    (state.el.querySelector('.cell.on') ?? state.el.querySelector('.cell'))?.focus();
    return true;
  }

  function close({ restoreFocus = false } = {}) {
    if (state.el === null || state.el.hidden)
      return false;
    state.el.hidden = true;
    state.doc.removeEventListener('mousedown', onOutside, true);
    const anchor = state.anchor;
    const onClose = state.onClose;
    state.anchor = null;
    state.onPick = null;
    state.onClose = null;
    anchor?.classList.remove('open');
    anchor?.setAttribute('aria-expanded', 'false');
    if (restoreFocus)
      anchor?.focus();
    onClose?.();
    return true;
  }

  function pick(color) {
    const onPick = state.onPick;
    close({ restoreFocus: true });
    onPick?.(color);
  }

  // 同じチップをもう 1 度押したら閉じる。
  function toggle(anchor, options) {
    if (isOpen() && state.anchor === anchor)
      return !close({ restoreFocus: true });
    return open(anchor, options);
  }

  function isOpen() {
    return state.el !== null && !state.el.hidden;
  }

  function init(doc, win) {
    if (win.__sigkColorPopoverReady === true)
      return false;
    const el = doc.getElementById('color-pop');
    if (el === null)
      return false;
    win.__sigkColorPopoverReady = true;
    state.doc = doc;
    state.el = el;
    build();
    el.addEventListener('keydown', onKey);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.colorPopover = { WIDTH, GAP, init, open, close, toggle, isOpen, anchor: () => state.anchor };
})(typeof window !== 'undefined' ? window : globalThis);
