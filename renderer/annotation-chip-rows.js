(function (root) {
  'use strict';

  // 右パネルの色の行（線の色・文字の色・色・塗り・枠線）と一括の行の分割ボタン（spec-4b-1b 確定事項2〜6、spec-4b-3a 確定事項I1、
  // spec-7-2 確定事項A・D。見本 screenshots/office-color-mock-01.png）。
  //
  // 左側は直前に選んだ色（color-memory.js）で塗るボタンで、絵の下の帯にその色を出す。右側の ▼ で色の一覧（color-popover.js）を開く。
  // 今の色はボタンの右に「今の色」と色見本・名前で出し、複数を選んでいて色がそろっていなければ斜線で「混在」にする（一覧はどの色にも印を
  // 付けずに開く）。選んだ色は annotate.setColor などへ渡す（複数なら全部に当たる）。

  // 色の行の名前 → 直前の色の役割と、ボタンの絵（spec-7-2 確定事項A2・A4）。
  const ROLE_OF_LABEL = Object.freeze({ 線の色: 'line', 文字の色: 'font', 色: 'mark' });
  const ICON_OF_ROLE = Object.freeze({ line: 'colorLine', fill: 'colorFill', font: 'colorFont', mark: 'colorMark' });

  function annotate() {
    return root.SigK.annotate;
  }

  function popover() {
    return root.SigK.colorPopover;
  }

  function memory() {
    return root.SigK.colorMemory;
  }

  function palette() {
    return root.SigK.annotationPalette;
  }

  function roleOfLabel(label) {
    return ROLE_OF_LABEL[label] ?? 'line';
  }

  // value は { value, mixed }（annotation-style-patch.js の viewOf の欄）。chip は ▼、name は名前の欄。
  function renderChip(chip, name, value, label) {
    const row = chip.closest('.chip-row') ?? chip;
    const swatch = row.querySelector('.sw');
    const mixed = value.mixed === true;
    const color = mixed ? null : value.value ?? null;
    swatch.classList.toggle('mixed', mixed);
    swatch.classList.toggle('none', !mixed && color === null);
    swatch.style.background = color ?? '';
    if (mixed)
      name.textContent = '混在';
    else
      name.textContent = color === null ? 'なし' : palette().labelOf(color);
    chip.setAttribute('aria-label', `${label} ${name.textContent} の一覧`);
  }

  // 左側のボタン。絵を役割に合わせ、帯を直前の色にする。
  function renderMain(main, role, label) {
    const color = memory()?.lastOf(role) ?? null;
    if (main.dataset.icon !== ICON_OF_ROLE[role]) {
      main.dataset.icon = ICON_OF_ROLE[role];
      const holder = main.querySelector('.ico');
      holder.replaceChildren();
      if (root.SigK.icons?.has(ICON_OF_ROLE[role]))
        holder.append(root.SigK.icons.create(main.ownerDocument, ICON_OF_ROLE[role], { size: 17, strokeWidth: 1.6 }));
    }
    main.dataset.role = role;
    main.querySelector('.bar').style.background = color ?? '';
    const text = `${label}を ${palette().labelOf(color)} にする`;
    root.SigK.tipContent.text(main, text);
    main.setAttribute('aria-label', text);
  }

  // 一括の左側。帯の代わりに直前の組の見本を出す。
  function renderSetMain(main) {
    const set = palette().STYLE_SETS[memory()?.lastStyle() ?? 0];
    const sample = main.querySelector('.set-sample');
    sample.style.background = set.fill;
    sample.style.borderColor = set.stroke;
    sample.style.color = set.text ?? '#222a35';
    const text = `一括 ${palette().STYLE_SET_ROWS[Math.floor((memory()?.lastStyle() ?? 0) / 7)]} ${palette().labelOf(set.stroke)} を当てる`;
    root.SigK.tipContent.text(main, text);
    main.setAttribute('aria-label', text);
  }

  function cancelPreview() {
    root.SigK.annotatePreview?.cancel();
  }

  function setColorOf(color) {
    return color === null ? annotate().setStrokeNone() : annotate().setColor(color);
  }

  // 線の色の一覧の［太さ ▶］［線種 ▶］（spec-7-2 確定事項B3）。線の色（図形・ペン）だけに出す。
  function lineExtras(label, view) {
    if (label !== '線の色')
      return { widths: null, lineStyles: null };
    const width = view.lineWidth;
    const lineStyle = view.lineStyle;
    return {
      widths: width ? { current: width.mixed ? null : width.value, onPick: (value) => annotate().setLineWidth(value) } : null,
      lineStyles: lineStyle && lineStyle.styles.length > 1
        ? { styles: lineStyle.styles, current: lineStyle.mixed ? null : lineStyle.value, onPick: (value) => annotate().setLineStyle(value) }
        : null,
    };
  }

  // 色の行の ▼ を押した。線なしは、塗りのある四角・丸があるときだけ選べる（spec-4b-1b 確定事項4）。
  function openColor(chip, title, view) {
    cancelPreview();
    if (view === null)
      return false;
    return popover().toggle(chip, {
      title,
      current: view.color.mixed ? null : view.color.value,
      role: roleOfLabel(title),
      none: view.boxed ? { label: '線なし', enabled: view.strokeNoneEnabled } : null,
      onPick: setColorOf,
      ...lineExtras(title, view),
    });
  }

  // 塗りの ▼ を押した。塗りなしは、線のある四角・丸か、テキストがあるときだけ選べる。
  function openFill(chip, view) {
    cancelPreview();
    if (view === null || view.fill === null)
      return false;
    return popover().toggle(chip, {
      title: '塗り',
      current: view.fill.mixed ? null : view.fill.value,
      role: 'fill',
      none: { label: '塗りなし', enabled: view.fillNoneEnabled },
      onPick: (color) => annotate().setFill(color),
    });
  }

  // テキストの枠線の ▼ を押した（spec-4b-4a 確定事項G4）。［枠線なし］はいつでも選べる。太さも選べる（spec-7-2 確定事項B3）。
  function openBorder(chip, view) {
    cancelPreview();
    if (view === null || (view.border ?? null) === null)
      return false;
    const width = view.lineWidth;
    return popover().toggle(chip, {
      title: view.border.label,
      current: view.border.mixed ? null : view.border.value,
      role: 'line',
      none: { label: '枠線なし', enabled: true },
      onPick: (color) => annotate().setBorder(color),
      widths: width ? { current: width.mixed ? null : width.value, onPick: (value) => annotate().setLineWidth(value) } : null,
    });
  }

  // 一括の ▼ を押した（spec-7-2 確定事項D）。targets は右パネルに出している対象（annotation-style-patch.js の targetOf の形）。
  function openSet(chip, targets) {
    cancelPreview();
    return popover().toggle(chip, {
      title: '一括',
      sets: {
        current: root.SigK.annotateStyleSet.currentIndexOf(targets),
        onPick: (index) => root.SigK.annotateStyleSet.applySet(index),
        onReset: () => root.SigK.annotateStyleSet.resetSet(),
      },
    });
  }

  // 左側のボタンを押した。直前の色を、一覧で同じ色を選んだときと同じように当てる（spec-7-2 確定事項A5）。
  function applyLast(role, field) {
    cancelPreview();
    popover()?.close();
    const color = memory()?.lastOf(role) ?? null;
    if (color === null)
      return false;
    if (field === 'fill')
      return annotate().setFill(color);
    if (field === 'border')
      return annotate().setBorder(color);
    return annotate().setColor(color);
  }

  function applyLastSet() {
    cancelPreview();
    popover()?.close();
    return root.SigK.annotateStyleSet.applySet(memory()?.lastStyle() ?? 0);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationChipRows = { ROLE_OF_LABEL, roleOfLabel, renderChip, renderMain, renderSetMain, openColor, openFill, openBorder, openSet, applyLast, applyLastSet };
})(typeof window !== 'undefined' ? window : globalThis);
