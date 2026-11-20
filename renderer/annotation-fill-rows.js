(function (root) {
  'use strict';

  // プロパティパネルの見出し「枠線」「塗り」と、塗りの見出しの行（spec-7-9 確定事項B1〜B4・C1〜C3。質問 SH1・SH2・NM1）。
  //
  // 四角・丸・閉じた多角形（とその書き込みツール）の時は、線の色・線種・線の太さ・透明度の上に見出し「枠線」を、その下に見出し「塗り」を
  // 表示し、塗りつぶしの行を塗りの見出しのすぐ下へ移す。続けて塗りの透明度・ハッチング・ハッチング色・ハッチング間隔・ハッチング線幅の行を
  // 表示する（ハッチング色・間隔・線幅は、ハッチングがある時だけ）。それ以外の書き込みでは見出しを付けず、塗りつぶしの行を元の位置に戻す。
  // 出す形は annotation-style-patch.js の viewOf（split・fillOpacity・hatch）、当てるのは annotate-fill.js。annotation-style-rows.js の
  // render から呼ぶ。

  let el = null;
  // いま表示している形（ハッチング色の一覧を開く時に使う）。
  let view = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function rows() {
    return root.SigK.annotationStyleRows;
  }

  function chips() {
    return root.SigK.annotationChipRows;
  }

  function preview() {
    return root.SigK.annotatePreview;
  }

  function targetKey() {
    return JSON.stringify([annotate().getSelection(), annotate().getTool()]);
  }

  // 塗りつぶしの行を、分ける時は塗りの見出しのすぐ下へ、分けない時は元の位置（書式の行の次）へ置く。動かす必要が無ければ動かさない。
  function placeFillRow(split) {
    const anchor = split ? el.fillHead : el.formatRow;
    if (anchor.nextElementSibling !== el.fillRow)
      anchor.after(el.fillRow);
  }

  function renderNumber(row, number, value) {
    row.hidden = value === null;
    if (value === null || number.ownerDocument.activeElement === number)
      return;
    number.value = value.mixed ? '' : String(value.value);
    number.placeholder = value.mixed ? '–' : '';
  }

  function renderHatch(hatch) {
    el.hatchRow.hidden = hatch === null;
    if (hatch !== null)
      el.hatch.value = hatch.pattern.mixed ? '' : hatch.pattern.value;
    const detail = hatch !== null && hatch.color !== null;
    el.colorRow.hidden = !detail;
    if (detail) {
      chips().renderChip(el.colorChip, el.colorName, hatch.color, 'ハッチング色');
      chips().renderMain(el.colorMain, 'line', 'ハッチング色');
    }
    renderNumber(el.gapRow, el.gap, detail ? hatch.gap : null);
    renderNumber(el.widthRow, el.width, detail ? hatch.width : null);
  }

  // 行を形に合わせる。next は viewOf の形か null。
  function render(next) {
    if (el === null)
      return false;
    view = next;
    const split = next?.split === true;
    el.strokeHead.hidden = !split;
    el.fillHead.hidden = !split;
    placeFillRow(split);
    const opacity = split ? next.fillOpacity : null;
    el.opacityRow.hidden = opacity === null;
    if (opacity !== null) {
      const main = rows().transparencyOf(opacity.value);
      root.SigK.propsRange.show(el.opacityRange, el.opacity, main, opacity.mixed ? '' : String(main));
      el.opacity.placeholder = opacity.mixed ? '–' : '';
    }
    renderHatch(split ? next.hatch : null);
    return true;
  }

  // ハッチング色の ▼。［なし］は表示しない（ハッチングなしは種類の一覧で選ぶ）。
  function openColor() {
    preview()?.cancel();
    const color = view?.hatch?.color ?? null;
    if (color === null)
      return false;
    return root.SigK.colorPopover.toggle(el.colorChip, {
      title: 'ハッチング色',
      current: color.mixed ? null : color.value,
      role: 'line',
      none: null,
      onPick: (picked) => annotate().setHatch({ color: picked }),
    });
  }

  function applyLastColor() {
    preview()?.cancel();
    root.SigK.colorPopover?.close();
    const color = root.SigK.colorMemory?.lastOf('line') ?? null;
    return color === null ? false : annotate().setHatch({ color });
  }

  // 数値欄の確定（Enter か欄の外）。範囲の外と読めない値は当てずに、今の値へ戻す。
  function bindNumber(number, field, min, max) {
    number.addEventListener('change', () => {
      const value = Number(String(number.value).trim());
      const done = number.value.trim() !== '' && Number.isFinite(value) && value >= min && value <= max && annotate().setHatch({ [field]: value });
      if (!done)
        root.SigK.annotationProps?.refresh();
    });
  }

  function bind() {
    const fill = root.SigK.fillStyle;
    root.SigK.propsRange.bind(el.opacityRange, el.opacity, {
      min: 0, max: rows().transparencyOf(root.SigK.annotationPresets.OPACITY_MIN),
      onPreview: (percent) => preview().update('fillOpacity', rows().opacityOf(percent)),
      onCommit: (percent) => preview().commit('fillOpacity', rows().opacityOf(percent)),
      onCancel: () => preview().cancel(),
      targetOf: targetKey,
    });
    el.hatch.addEventListener('change', () => {
      preview()?.cancel();
      if (el.hatch.value !== '')
        annotate().setHatch({ pattern: el.hatch.value });
    });
    el.colorChip.addEventListener('click', openColor);
    el.colorMain.addEventListener('click', applyLastColor);
    bindNumber(el.gap, 'gap', fill.HATCH_GAP_MIN, fill.HATCH_GAP_MAX);
    bindNumber(el.width, 'width', fill.HATCH_WIDTH_MIN, fill.HATCH_WIDTH_MAX);
    // 別の欄の操作で下見を捨てるのは、annotation-style-rows.js の focusin（パネル全体）が担当する。
  }

  function init(doc, win) {
    if (win.__sigkFillRowsReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-fill-head') === null)
      return false;
    win.__sigkFillRowsReady = true;
    el = {
      strokeHead: byId('props-stroke-head'), fillHead: byId('props-fill-head'), fillRow: byId('props-fill-row'), formatRow: byId('props-format-row'),
      opacityRow: byId('props-fill-opacity-row'), opacityRange: byId('props-fill-opacity-range'), opacity: byId('props-fill-opacity'),
      hatchRow: byId('props-hatch-row'), hatch: byId('props-hatch'),
      colorRow: byId('props-hatch-color-row'), colorChip: byId('props-hatch-color'), colorName: byId('props-hatch-color-name'), colorMain: byId('props-hatch-color-apply'),
      gapRow: byId('props-hatch-gap-row'), gap: byId('props-hatch-gap'),
      widthRow: byId('props-hatch-width-row'), width: byId('props-hatch-width'),
    };
    bind();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationFillRows = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
