(function (root) {
  'use strict';

  // 色の一覧の窓（spec-4b-1b 確定事項6・10〜13、spec-7-2 確定事項B・D。見本 screenshots/office-color-mock-02.png〜05.png）。
  //
  // 右パネルの色の行の ▼ を押すと、右パネルの左、紙の上に重ねて開く（透かしの色はツールの欄の左）。中身は上から 見出し → テーマの色 10 →
  // 濃淡 5 段 → 標準の色 10 → 最近使用した色 → 項目の並び（［なし］［その他の色…］［太さ ▶］［線種 ▶］）。一括の組は色の代わりに 21 個の組と
  // ［標準の色に戻す］を並べる。色の値は annotation-palette.js、最近使用した色と直前の色は color-memory.js。今の色に印を付ける。外を押す・Esc・
  // 選ぶ、のどれでも閉じる。［その他の色…］は「色の設定」の画面（color-dialog.js）を開く。窓の中のキーは viewer-controls.js が素通しする（.color-pop）。
  //
  // 下の一覧（太さ・線種）は、項目にマウスを載せるか押すと、項目の左に開く。キーボードでは Enter か ← で開き、→ か Esc で項目へ戻る。

  const WIDTH = 268;
  // 右パネルの左端との間（左端は右パネルの左端から 276px 左）。
  const GAP = 8;
  // 上端は行の上端の 40px 上。90px より上には出さない。窓の下にはみ出すなら上へずらす。
  const ABOVE = 40;
  const TOP_MIN = 90;
  const MARGIN = 8;

  const LINE_STYLE_LABELS = Object.freeze({ solid: '実線', dashed: '破線', cloudy: '雲形' });

  const state = { doc: null, el: null, parts: null, anchor: null, options: null };

  function palette() {
    return root.SigK.annotationPalette;
  }

  function memory() {
    return root.SigK.colorMemory;
  }

  function node(tag, className, text) {
    const element = state.doc.createElement(tag);
    if (className)
      element.className = className;
    if (text !== undefined)
      element.textContent = text;
    return element;
  }

  function icon(name, size = 16) {
    const holder = node('span', 'ico');
    holder.setAttribute('aria-hidden', 'true');
    if (root.SigK.icons?.has(name))
      holder.append(root.SigK.icons.create(state.doc, name, { size, strokeWidth: 1.6 }));
    return holder;
  }

  function cellOf(color) {
    const cell = node('button', 'cell');
    cell.type = 'button';
    cell.dataset.color = color;
    cell.style.background = color;
    // 説明の吹き出しは色の名前だけ（spec-2-5 J5）。読み上げの名前も同じ。
    const label = palette().labelOf(color);
    root.SigK.tipContent.text(cell, label);
    cell.setAttribute('aria-label', label);
    cell.addEventListener('click', () => pick(color));
    return cell;
  }

  function gridOf(colors, className = 'grid') {
    const grid = node('div', className);
    grid.append(...colors.map(cellOf));
    return grid;
  }

  // 色の並び（テーマの色・濃淡・標準の色）は固定なので 1 度だけ組む。最近使用した色・一括の組・項目は開くたびに組む。
  function build() {
    const rows = palette().PALETTE_ROWS;
    const title = node('p', 'ttl');
    const colors = node('div', 'colors');
    colors.append(node('p', 'sub', 'テーマの色'), gridOf(rows[0]), gridOf(rows.slice(1, -1).flat(), 'grid shades'),
      node('p', 'sub', '標準の色'), gridOf(rows.at(-1)));
    const recentTitle = node('p', 'sub recent-ttl', '最近使用した色');
    const recent = node('div', 'grid recent');
    const sets = node('div', 'sets');
    const items = node('div', 'items');
    items.setAttribute('role', 'menu');
    state.el.replaceChildren(title, sets, colors, recentTitle, recent, items);
    state.parts = { title, colors, recentTitle, recent, sets, items };
  }

  // ---- 項目 ----

  function itemOf({ iconName, label, onPress = null, enabled = true, submenu = null, className = '' }) {
    const item = node('button', `item ${className}`.trim());
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.append(icon(iconName), node('span', 'label', label));
    if (!enabled)
      item.setAttribute('aria-disabled', 'true');
    if (submenu === null) {
      item.addEventListener('click', () => {
        if (item.getAttribute('aria-disabled') !== 'true')
          onPress();
      });
      return item;
    }
    item.append(node('span', 'arr', '▶'));
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
    const sub = node('div', 'color-sub');
    sub.setAttribute('role', 'menu');
    sub.hidden = true;
    submenu(sub);
    item.append(sub);
    const show = () => openSub(item, sub);
    item.addEventListener('mouseenter', show);
    item.addEventListener('mouseleave', () => closeSub(item, sub));
    item.addEventListener('click', (event) => {
      if (!sub.contains(event.target))
        show();
    });
    item.addEventListener('keydown', (event) => {
      if (event.target !== item)
        return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowLeft') {
        event.preventDefault();
        show();
        sub.querySelector('.row')?.focus();
      }
    });
    sub.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        closeSub(item, sub);
        item.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const rows = [...sub.querySelectorAll('.row')];
        const at = rows.indexOf(event.target);
        rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
      }
    });
    return item;
  }

  function openSub(item, sub) {
    for (const other of state.parts.items.querySelectorAll('.color-sub'))
      if (other !== sub)
        closeSub(other.parentElement, other);
    sub.hidden = false;
    item.setAttribute('aria-expanded', 'true');
    item.classList.add('on');
    // 窓の下にはみ出すなら上へずらす。
    sub.style.top = '-6px';
    const bottom = state.doc.defaultView.innerHeight - MARGIN;
    const box = sub.getBoundingClientRect();
    if (box.bottom > bottom)
      sub.style.top = `${-6 - (box.bottom - bottom)}px`;
  }

  function closeSub(item, sub) {
    sub.hidden = true;
    item.setAttribute('aria-expanded', 'false');
    item.classList.remove('on');
  }

  function rowOf({ label, on, draw, onPress }) {
    const row = node('button', 'row');
    row.type = 'button';
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', String(on));
    row.classList.toggle('on', on);
    row.append(node('span', 'v', label), draw);
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      const options = state.options;
      close({ restoreFocus: true });
      onPress(options);
    });
    return row;
  }

  function widthRows(sub, widths) {
    for (const width of palette().LINE_WIDTH_CHOICES) {
      const line = node('i', 'w');
      line.style.height = `${Math.min(width, 10)}px`;
      sub.append(rowOf({ label: `${width} pt`, on: widths.current === width, draw: line, onPress: () => widths.onPick(width) }));
    }
  }

  function lineStyleRows(sub, lineStyles) {
    for (const lineStyle of lineStyles.styles) {
      const draw = node('span', 'ls');
      if (root.SigK.icons?.has(`line${lineStyle[0].toUpperCase()}${lineStyle.slice(1)}`))
        draw.append(root.SigK.icons.create(state.doc, `line${lineStyle[0].toUpperCase()}${lineStyle.slice(1)}`, { size: 22 }));
      sub.append(rowOf({ label: LINE_STYLE_LABELS[lineStyle], on: lineStyles.current === lineStyle, draw, onPress: () => lineStyles.onPick(lineStyle) }));
    }
  }

  function buildItems(options) {
    const items = [];
    if (options.sets) {
      items.push(itemOf({ iconName: 'colorNone', label: '標準の色に戻す', className: 'reset', onPress: () => {
        close({ restoreFocus: true });
        options.sets.onReset();
      } }));
    }
    if (options.none) {
      items.push(itemOf({ iconName: 'colorNone', label: options.none.label, className: 'none', enabled: options.none.enabled !== false,
        onPress: () => pick(null) }));
    }
    if (!options.sets) {
      items.push(itemOf({ iconName: 'colorMore', label: 'その他の色…', className: 'other', onPress: () => more(options) }));
    }
    if (options.widths)
      items.push(itemOf({ iconName: 'colorWidth', label: '太さ', className: 'widths', submenu: (sub) => widthRows(sub, options.widths) }));
    if (options.lineStyles?.styles?.length > 1)
      items.push(itemOf({ iconName: 'colorDash', label: '線種', className: 'line-styles', submenu: (sub) => lineStyleRows(sub, options.lineStyles) }));
    state.parts.items.replaceChildren(...items);
  }

  // 一括の組（spec-7-2 確定事項D2）。21 個の「Ab」の見本。
  function buildSets(options) {
    const { sets } = state.parts;
    sets.hidden = !options.sets;
    if (!options.sets) {
      sets.replaceChildren();
      return;
    }
    const grid = node('div', 'set-grid');
    palette().STYLE_SETS.forEach((set, index) => {
      const button = node('button', 'set', 'Ab');
      button.type = 'button';
      button.dataset.index = String(index);
      button.style.background = set.fill;
      button.style.borderColor = set.stroke;
      button.style.color = set.text ?? '#222a35';
      const on = options.sets.current === index;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      const label = `${palette().STYLE_SET_ROWS[Math.floor(index / 7)]} ${palette().labelOf(set.stroke)}`;
      root.SigK.tipContent.text(button, label);
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        close({ restoreFocus: true });
        memory()?.setLastStyle(index);
        options.sets.onPick(index);
      });
      grid.append(button);
    });
    sets.replaceChildren(node('p', 'sub', '線・塗り・文字の色を一括設定'), grid);
  }

  function buildRecent(options) {
    const colors = options.sets ? [] : memory()?.recent() ?? [];
    state.parts.recentTitle.hidden = colors.length === 0;
    state.parts.recent.hidden = colors.length === 0;
    state.parts.recent.replaceChildren(...colors.map(cellOf));
  }

  function place(anchor) {
    const win = state.doc.defaultView;
    const side = (anchor.closest('#tool-pane') ?? state.doc.getElementById('props'))?.getBoundingClientRect();
    const row = anchor.closest('.prop, .wm-color') ?? anchor;
    const top = Math.max(TOP_MIN, row.getBoundingClientRect().top - ABOVE);
    const height = state.el.offsetHeight;
    const bottom = win.innerHeight - MARGIN;
    state.el.style.left = `${Math.max(MARGIN, (side?.left ?? win.innerWidth) - WIDTH - GAP)}px`;
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

  // 開く。anchor は押した ▼、options は
  //   title    見出し
  //   current  今の色（null は「なし」か混在で、どの色にも印を付けない）
  //   role     直前の色の役割（color-memory.js の ROLES。null なら覚えない）
  //   none     ［なし］の { label, enabled }（出さないなら null）
  //   onPick   選んだ色（［なし］は null）を受ける
  //   widths   ［太さ ▶］の { current, onPick }（出さないなら null）
  //   lineStyles ［線種 ▶］の { styles, current, onPick }（出さないなら null）
  //   sets     一括の { current（組の番号か null）, onPick(index), onReset() }。あれば色の並びの代わりに組を出す
  //   onClose  閉じたとき（▼の印を外す）
  function open(anchor, options) {
    if (state.el === null)
      return false;
    close();
    const opts = { current: null, role: null, none: null, widths: null, lineStyles: null, sets: null, onClose: null, ...options };
    state.anchor = anchor;
    state.options = opts;
    state.parts.title.textContent = opts.title;
    state.el.setAttribute('aria-label', opts.title);
    state.parts.colors.hidden = opts.sets !== null;
    buildSets(opts);
    buildRecent(opts);
    buildItems(opts);
    // 一覧には同じ値の色が 2 組ある（#808080 と #ffc000）。印は上にある方の 1 つだけに付ける（spec-7-2 確定事項B6）。
    const hex = palette().normalizeHex(opts.current);
    const cells = [...state.el.querySelectorAll('.cell')];
    const marked = cells.find((cell) => cell.dataset.color === hex) ?? null;
    for (const cell of cells) {
      cell.classList.toggle('on', cell === marked);
      cell.setAttribute('aria-pressed', String(cell === marked));
    }
    state.el.hidden = false;
    place(anchor);
    anchor.classList.add('open');
    anchor.closest('.split')?.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    state.doc.addEventListener('mousedown', onOutside, true);
    (state.el.querySelector('.cell.on, .set.on') ?? state.el.querySelector('.cell, .set'))?.focus();
    return true;
  }

  function close({ restoreFocus = false } = {}) {
    if (state.el === null || state.el.hidden)
      return false;
    state.el.hidden = true;
    state.doc.removeEventListener('mousedown', onOutside, true);
    const anchor = state.anchor;
    const onClose = state.options?.onClose;
    state.anchor = null;
    state.options = null;
    anchor?.classList.remove('open');
    anchor?.closest('.split')?.classList.remove('open');
    anchor?.setAttribute('aria-expanded', 'false');
    if (restoreFocus)
      anchor?.focus();
    onClose?.();
    return true;
  }

  // 色を選んだ。役割があれば直前の色にする（［なし］は直前の色にしない）。
  function pick(color) {
    const options = state.options;
    close({ restoreFocus: true });
    if (color !== null && options?.role)
      memory()?.setLast(options.role, color);
    options?.onPick?.(color);
  }

  // ［その他の色…］。一覧を閉じて「色の設定」の画面を開き、［OK］で選んだ色を当てる。
  function more(options) {
    const anchor = state.anchor;
    close();
    root.SigK.colorDialog?.open({
      current: options.current,
      onPick: (color) => {
        if (options.role)
          memory()?.setLast(options.role, color);
        options.onPick?.(color);
        anchor?.focus?.();
      },
    });
  }

  // 同じ ▼ をもう 1 度押したら閉じる。
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
