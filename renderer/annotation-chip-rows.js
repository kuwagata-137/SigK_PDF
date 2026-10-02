(function (root) {
  'use strict';

  // 右パネルの色・塗りのチップと、押したときに開くパレットの窓（spec-4b-1b 確定事項2〜6、spec-4b-3a 確定事項I1）。
  //
  // 200 行に近づいた annotation-style-rows.js から移した（spec-4b-3a）。複数を選んでいて色がそろっていなければ、チップは斜線で
  // 名前を「混在」にし、パレットはどの色にも印を付けずに開く。選んだ色は annotate.setColor などへ渡す（複数なら全部に当たる）。

  function annotate() {
    return root.SigK.annotate;
  }

  function popover() {
    return root.SigK.colorPopover;
  }

  // value は { value, mixed }（annotation-style-patch.js の viewOf の欄）。
  function renderChip(chip, name, value, label) {
    const swatch = chip.querySelector('.sw');
    const mixed = value.mixed === true;
    const color = mixed ? null : value.value ?? null;
    swatch.classList.toggle('mixed', mixed);
    swatch.classList.toggle('none', !mixed && color === null);
    swatch.style.background = color ?? '';
    if (mixed)
      name.textContent = '混在';
    else
      name.textContent = color === null ? 'なし' : root.SigK.annotationPalette.labelOf(color);
    chip.setAttribute('aria-label', `${label} ${name.textContent}`);
  }

  // 色のチップを押した。線なしは、塗りのある四角・丸があるときだけ選べる（spec-4b-1b 確定事項4）。
  function openColor(chip, title, view) {
    root.SigK.annotatePreview?.cancel();
    if (view === null)
      return false;
    return popover().toggle(chip, {
      title,
      current: view.color.mixed ? null : view.color.value,
      none: view.boxed ? { label: '線なし', enabled: view.strokeNoneEnabled } : null,
      onPick: (color) => (color === null ? annotate().setStrokeNone() : annotate().setColor(color)),
    });
  }

  // 塗りのチップを押した。塗りなしは、線のある四角・丸か、テキストがあるときだけ選べる。
  function openFill(chip, view) {
    root.SigK.annotatePreview?.cancel();
    if (view === null || view.fill === null)
      return false;
    return popover().toggle(chip, {
      title: '塗り',
      current: view.fill.mixed ? null : view.fill.value,
      none: { label: '塗りなし', enabled: view.fillNoneEnabled },
      onPick: (color) => annotate().setFill(color),
    });
  }

  // テキストの枠線のチップを押した（spec-4b-4a 確定事項G4）。［枠線なし］はいつでも選べる。
  function openBorder(chip, view) {
    root.SigK.annotatePreview?.cancel();
    if (view === null || (view.border ?? null) === null)
      return false;
    return popover().toggle(chip, {
      title: view.border.label,
      current: view.border.mixed ? null : view.border.value,
      none: { label: '枠線なし', enabled: true },
      onPick: (color) => annotate().setBorder(color),
    });
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationChipRows = { renderChip, openColor, openFill, openBorder };
})(typeof window !== 'undefined' ? window : globalThis);
