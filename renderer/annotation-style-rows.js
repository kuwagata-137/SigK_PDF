(function (root) {
  'use strict';

  // 右パネルの見た目の行（spec-4b-1b 確定事項1〜9、spec-4b-3a 確定事項I1。モック screenshots/phase4b-style*.png・phase4b-3-multi.png）。
  //
  // 色・塗り・線種・線の太さ・不透明度の行を、annotation-props.js が渡す対象（選んでいる書き込みか、次に付ける値）に合わせて
  // 出し入れする。色と塗りはチップ（色見本と ▼）で、押すとパレットの窓（color-popover.js）が開く。「塗り」は四角・丸だけ、
  // 「線種」は四角・丸（実線・破線・雲形）と直線・矢印（実線・破線）だけ。太さ（1〜40pt）と不透明度（10〜100%）はスライダーと
  // 数値欄の組（props-range.js）で、動かしている間は下見（annotate-preview.js）、離したときと数値欄の確定で 1 世代積む。
  // 表示のみの書き込みには出さない。複数を選んでいれば、1 件でも持てる欄を出し、そろっていない値は「混在」にする。チップと
  // パレットの窓は annotation-chip-rows.js、出す形は annotation-style-patch.js が持つ。

  const LINE_STYLE_LABELS = Object.freeze({ solid: '実線', dashed: '破線', cloudy: '雲形' });
  // 線種のボタンの絵（assets/icons.js。22px）。
  const LINE_STYLE_ICONS = Object.freeze({ solid: 'lineSolid', dashed: 'lineDashed', cloudy: 'lineCloudy' });

  let el = null;
  // いま行に出している形（annotation-style-patch.js の viewOf）。行を出していなければ null。
  let view = null;

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

  function patch() {
    return root.SigK.annotationStylePatch;
  }

  function chips() {
    return root.SigK.annotationChipRows;
  }

  // 線種のボタン。そろっていなければ、どれも押していない形にする（spec-4b-3a 確定事項I1）。
  function renderStyleButtons(lineStyle) {
    const styles = lineStyle?.styles ?? [];
    el.styleRow.hidden = styles.length < 2;
    const current = lineStyle === null || lineStyle.mixed ? null : (styles.includes(lineStyle.value) ? lineStyle.value : 'solid');
    for (const button of el.styleButtons) {
      const on = button.dataset.style === current;
      button.hidden = !styles.includes(button.dataset.style);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  // スライダーと数値欄。そろっていなければ、スライダーは主の値に置き、数値欄は空にして「–」を出す（確定事項I1）。
  // shown は値を欄に出す形にする（不透明度は百分率の整数。太さは読み込んだ小数のまま）。
  function renderRange(row, slider, number, value, shown) {
    row.hidden = value === null;
    if (value === null)
      return;
    range().show(slider, number, shown(value.value));
    number.placeholder = value.mixed ? '–' : '';
    if (value.mixed && number.ownerDocument.activeElement !== number)
      number.value = '';
  }

  // 行を対象に合わせる。next は 1 件の対象（選んでいる書き込みか次に付ける値。annotation-style-patch.js の targetOf の形）か、
  // その配列（複数選択）。null（道具も選択も無い）か表示のみだけなら、どの行も出さない。
  function render(next) {
    if (el === null)
      return false;
    view = patch().viewOf(Array.isArray(next) ? next : [next]);
    el.colorRow.hidden = view === null;
    if (view !== null) {
      el.colorLabel.textContent = view.colorLabel;
      chips().renderChip(el.colorChip, el.colorName, view.color, view.colorLabel);
    }
    el.fillRow.hidden = view?.fill === null || view === null;
    if (!el.fillRow.hidden)
      chips().renderChip(el.fillChip, el.fillName, view.fill, '塗り');
    renderStyleButtons(view?.lineStyle ?? null);
    renderRange(el.widthRow, el.widthRange, el.width, view?.lineWidth ?? null, (width) => width);
    renderRange(el.opacityRow, el.opacityRange, el.opacity, view?.opacity ?? null, (opacity) => Math.round(opacity * 100));
    // 開いているパレットの行が消えたら閉じる。
    if (popover()?.isOpen() && popover().anchor()?.closest('.prop')?.hidden === true)
      popover().close();
    return true;
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
    el.colorChip.addEventListener('click', () => chips().openColor(el.colorChip, el.colorLabel.textContent, view));
    el.fillChip.addEventListener('click', () => chips().openFill(el.fillChip, view));
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
  SigK.annotationStyleRows = { LINE_STYLE_LABELS, init, render, colorLabelOf: (kind) => patch().colorLabelOf(kind) };
})(typeof window !== 'undefined' ? window : globalThis);
