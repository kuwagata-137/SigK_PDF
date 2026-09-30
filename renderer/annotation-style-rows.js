(function (root) {
  'use strict';

  // 右パネルの見た目の行（spec-4b-1b 確定事項1〜9。モック screenshots/phase4b-style*.png）。
  //
  // 色・塗り・線種・線の太さ・不透明度の行を、annotation-props.js が渡す対象（選んでいる書き込みか、次に付ける値）に合わせて
  // 出し入れする。色と塗りはチップ（色見本と ▼）で、押すとパレットの窓（color-popover.js）が開く。「塗り」は四角・丸だけ、
  // 「線種」は四角・丸（実線・破線・雲形）と直線・矢印（実線・破線）だけ。太さ（1〜40pt）と不透明度（10〜100%）はスライダーと
  // 数値欄の組（props-range.js）で、動かしている間は下見（annotate-preview.js）、離したときと数値欄の確定で 1 世代積む。
  // 表示のみの書き込みには出さない。

  const LINE_STYLE_LABELS = Object.freeze({ solid: '実線', dashed: '破線', cloudy: '雲形' });
  // 線種のボタンの絵（assets/icons.js。22px）。
  const LINE_STYLE_ICONS = Object.freeze({ solid: 'lineSolid', dashed: 'lineDashed', cloudy: 'lineCloudy' });

  let el = null;
  // いま行に出している対象 { kind, color, fill, lineStyle, lineWidth, opacity }。行を出していなければ null。
  let target = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function style() {
    return root.SigK.shapeStyle;
  }

  function preview() {
    return root.SigK.annotatePreview;
  }

  function popover() {
    return root.SigK.colorPopover;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  function range() {
    return root.SigK.propsRange;
  }

  function isDrawnKind(kind) {
    return root.SigK.annotationEntry?.isDrawnKind(kind) === true;
  }

  // 色の行の見出し。図形・ペンは「線の色」、テキストは「文字の色」、それ以外は「色」（確定事項1）。
  function colorLabelOf(kind) {
    if (isDrawnKind(kind))
      return '線の色';
    return kind === 'text' ? '文字の色' : '色';
  }

  function renderChip(chip, name, color, label) {
    const swatch = chip.querySelector('.sw');
    swatch.classList.toggle('none', color === null);
    swatch.style.background = color ?? '';
    name.textContent = color === null ? 'なし' : root.SigK.annotationPalette.labelOf(color);
    chip.setAttribute('aria-label', `${label} ${name.textContent}`);
  }

  function renderStyleButtons(kind, lineStyle) {
    const styles = kind === null ? [] : style().lineStylesOf(kind);
    el.styleRow.hidden = styles.length < 2;
    const current = styles.includes(lineStyle) ? lineStyle : 'solid';
    for (const button of el.styleButtons) {
      const on = button.dataset.style === current;
      button.hidden = !styles.includes(button.dataset.style);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  // 行を対象に合わせる。null（道具も選択も無い）か表示のみなら、どの行も出さない。
  function render(next) {
    if (el === null)
      return false;
    target = next === null || next === undefined || next.readonly === true ? null : next;
    const kind = target?.kind ?? null;
    el.colorRow.hidden = target === null;
    if (target !== null) {
      el.colorLabel.textContent = colorLabelOf(kind);
      renderChip(el.colorChip, el.colorName, target.color, el.colorLabel.textContent);
    }
    const boxed = target !== null && style().isBoxedKind(kind);
    el.fillRow.hidden = !boxed;
    if (boxed)
      renderChip(el.fillChip, el.fillName, target.fill ?? null, '塗り');
    renderStyleButtons(kind, target?.lineStyle ?? 'solid');
    const drawn = target !== null && isDrawnKind(kind);
    el.widthRow.hidden = !drawn;
    if (drawn)
      range().show(el.widthRange, el.width, target.lineWidth);
    const faded = target !== null && presets().isOpacityKind(kind);
    el.opacityRow.hidden = !faded;
    if (faded)
      range().show(el.opacityRange, el.opacity, Math.round(target.opacity * 100));
    // 開いているパレットの行が消えたら閉じる。
    if (popover()?.isOpen() && popover().anchor()?.closest('.prop')?.hidden === true)
      popover().close();
    return true;
  }

  function openColor() {
    preview()?.cancel();
    if (target === null)
      return;
    const boxed = style().isBoxedKind(target.kind);
    popover().toggle(el.colorChip, {
      title: el.colorLabel.textContent,
      current: target.color,
      // 線なしは四角・丸で、塗りがあるときだけ選べる（確定事項4）。
      none: boxed ? { label: '線なし', enabled: (target.fill ?? null) !== null } : null,
      onPick: (color) => (color === null ? annotate().setStrokeNone() : annotate().setColor(color)),
    });
  }

  function openFill() {
    preview()?.cancel();
    if (target === null)
      return;
    popover().toggle(el.fillChip, {
      title: '塗り',
      current: target.fill ?? null,
      none: { label: '塗りなし', enabled: target.color !== null },
      onPick: (color) => annotate().setFill(color),
    });
  }

  function init(doc, win) {
    if (win.__sigkStyleRowsReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-color') === null)
      return false;
    win.__sigkStyleRowsReady = true;
    el = {
      doc,
      body: byId('props-color-row').parentElement,
      colorRow: byId('props-color-row'), colorLabel: byId('props-color-label'), colorChip: byId('props-color'), colorName: byId('props-color-name'),
      fillRow: byId('props-fill-row'), fillChip: byId('props-fill'), fillName: byId('props-fill-name'),
      styleRow: byId('props-style-row'), style: byId('props-style'),
      widthRow: byId('props-width-row'), widthRange: byId('props-width-range'), width: byId('props-width'),
      opacityRow: byId('props-opacity-row'), opacityRange: byId('props-opacity-range'), opacity: byId('props-opacity'),
    };
    el.styleButtons = style().LINE_STYLES.map((lineStyle) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.style = lineStyle;
      button.title = LINE_STYLE_LABELS[lineStyle];
      button.setAttribute('aria-label', LINE_STYLE_LABELS[lineStyle]);
      if (root.SigK.icons?.has(LINE_STYLE_ICONS[lineStyle]))
        button.append(root.SigK.icons.create(doc, LINE_STYLE_ICONS[lineStyle], { size: 22 }));
      button.addEventListener('click', () => {
        preview()?.cancel();
        annotate().setLineStyle(lineStyle);
      });
      return button;
    });
    el.style.replaceChildren(...el.styleButtons);
    el.colorChip.addEventListener('click', openColor);
    el.fillChip.addEventListener('click', openFill);
    const { LINE_WIDTH_MIN, LINE_WIDTH_MAX, OPACITY_MIN } = presets();
    range().bind(el.widthRange, el.width, {
      min: LINE_WIDTH_MIN, max: LINE_WIDTH_MAX,
      onPreview: (value) => preview().update('lineWidth', value),
      onCommit: (value) => preview().commit('lineWidth', value),
    });
    range().bind(el.opacityRange, el.opacity, {
      min: Math.round(OPACITY_MIN * 100), max: 100,
      onPreview: (percent) => preview().update('opacity', percent / 100),
      onCommit: (percent) => preview().commit('opacity', percent / 100),
    });
    // 別の欄の操作で下見を捨てる（確定事項8）。スライダー自身は除く。
    el.body.addEventListener('focusin', (event) => {
      if (event.target !== el.widthRange && event.target !== el.opacityRange)
        preview()?.cancel();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationStyleRows = { LINE_STYLE_LABELS, init, render, colorLabelOf };
})(typeof window !== 'undefined' ? window : globalThis);
