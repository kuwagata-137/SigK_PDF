(function (root) {
  'use strict';

  // 透かしの画面の欄の描画と結線（spec-4-5 確定事項2〜6）。
  //
  // 状態は tools-watermark.js が持つ。ここは読んで DOM に写し、操作をあちらの関数へ返すだけである。
  // 色の丸・不透明度・位置の格子はプリセット（watermark-plan.js・watermark-geometry.js）から組み、
  // 並びを 1 か所に持つ。入力欄はフォーカスのある間は値を書き戻さない（分割と同じ理由）。

  let el = null;

  const tool = () => root.SigK.toolsWatermark;
  const planner = () => root.SigK.watermarkPlan;
  const geometry = () => root.SigK.watermarkGeometry;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function onChecked(inputs, handler) {
    for (const input of inputs)
      input.addEventListener('change', () => { if (input.checked) handler(input.value); });
  }

  // ---- 組み立て（プリセットから） ----

  function buildColors() {
    for (const color of planner().COLORS) {
      const button = el.doc.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.color = color;
      button.style.background = color;
      button.title = planner().COLOR_NAMES[color];
      button.setAttribute('aria-label', `色 ${planner().COLOR_NAMES[color]}`);
      button.addEventListener('click', () => tool().setColor(color));
      el.colors.append(button);
    }
  }

  function buildOpacities() {
    for (const value of planner().OPACITIES) {
      const label = el.doc.createElement('label');
      label.className = 'pick';
      const input = el.doc.createElement('input');
      input.type = 'radio';
      input.name = 'wm-opacity';
      input.value = String(value);
      const text = el.doc.createElement('span');
      text.className = 'lbl';
      text.textContent = `${Math.round(value * 100)}%`;
      label.append(input, text);
      el.opacities.append(label);
    }
    onChecked(el.opacities.querySelectorAll('input'), (value) => tool().setOpacity(Number(value)));
  }

  function buildPositions() {
    for (const position of geometry().POSITIONS) {
      const cell = el.doc.createElement('button');
      cell.type = 'button';
      cell.className = 'wm-cell';
      cell.dataset.position = position;
      cell.setAttribute('aria-label', planner().POSITION_LABELS[position]);
      cell.addEventListener('click', () => tool().setPosition(position));
      el.grid.append(cell);
    }
  }

  // ---- 描画 ----

  function renderImage(running) {
    const image = tool().image();
    el.imageName.textContent = image?.name ?? '';
    el.imageMeta.textContent = image === null || image.error !== null ? '' : (image.pending ? '…' : `${image.width} × ${image.height} px`);
    const note = image === null ? 'PNG か JPEG の画像を選んでください。ここへドロップしてもかまいません。' : (image.error ?? '');
    el.imageNote.textContent = note;
    el.imageNote.hidden = note === '';
    el.imageNote.classList.toggle('error', image?.error !== null && image?.error !== undefined);
    setDisabled(el.imagePick, running);
  }

  function syncRadios(inputs, value) {
    for (const input of inputs)
      input.checked = input.value === String(value);
  }

  // 設定と計画に関わるものを合わせる。対象の行は render が描く。
  function sync() {
    if (el === null)
      return false;
    const settings = tool().settings();
    const plan = tool().currentPlan();
    const running = tool().isRunning();
    const isText = settings.type === 'text';

    syncRadios(el.types, settings.type);
    for (const node of [el.textKey, el.textRow, el.colorKey, el.colors])
      node.hidden = !isText;
    for (const node of [el.imageKey, el.imageRow])
      node.hidden = isText;
    if (el.doc.activeElement !== el.text && el.text.value !== settings.text)
      el.text.value = settings.text;
    syncRadios(el.sizes, settings.size);
    for (const swatch of el.colors.children)
      swatch.classList.toggle('on', swatch.dataset.color === settings.color);
    syncRadios(el.opacities.querySelectorAll('input'), settings.opacity);
    syncRadios(el.angles, settings.angle);
    for (const cell of el.grid.children) {
      const on = cell.dataset.position === settings.position;
      cell.classList.toggle('on', on);
      cell.setAttribute('aria-pressed', String(on));
    }
    el.positionLabel.textContent = planner().POSITION_LABELS[settings.position];

    syncRadios(el.pageModes, settings.pageMode);
    el.pageRow.classList.toggle('on', settings.pageMode === 'range');
    if (el.doc.activeElement !== el.range && el.range.value !== settings.range)
      el.range.value = settings.range;
    const rangeInvalid = plan.errorKind === 'range';
    el.range.classList.toggle('invalid', rangeInvalid);
    el.rangeErr.textContent = rangeInvalid ? plan.error : '';
    el.rangeErr.hidden = !rangeInvalid;

    renderImage(running);
    el.summary.textContent = plan.ready ? plan.summary : (rangeInvalid ? '' : plan.error ?? '');
    setDisabled(el.run, !tool().canRun());
    for (const control of [el.useOpen, el.pick])
      setDisabled(control, running);
    for (const input of [el.text, el.range, ...el.types, ...el.sizes, ...el.angles, ...el.pageModes, ...el.opacities.querySelectorAll('input')])
      input.disabled = running;
    return true;
  }

  function render() {
    if (el === null)
      return false;
    root.SigK.sourcePicker.render(el, tool().source());
    return sync();
  }

  function init(doc, win) {
    if (win.__sigkToolsWatermarkViewReady === true)
      return false;
    const run = doc.getElementById('wm-run');
    if (run === null)
      return false;
    win.__sigkToolsWatermarkViewReady = true;

    const byId = (id) => doc.getElementById(id);
    const inputsOf = (name) => [...doc.querySelectorAll(`input[name="${name}"]`)];
    el = {
      doc, win, run,
      file: byId('wm-file'), name: byId('wm-name'), pages: byId('wm-pages'), note: byId('wm-note'), empty: byId('wm-empty'),
      useOpen: byId('wm-use-open'), pick: byId('wm-pick'),
      types: inputsOf('wm-type'), textKey: byId('wm-text-key'), textRow: byId('wm-text-row'), text: byId('wm-text'),
      imageKey: byId('wm-image-key'), imageRow: byId('wm-image-row'), imageName: byId('wm-image-name'),
      imageMeta: byId('wm-image-meta'), imagePick: byId('wm-image-pick'), imageNote: byId('wm-image-note'),
      sizes: inputsOf('wm-size'), colorKey: byId('wm-color-key'), colors: byId('wm-colors'), opacities: byId('wm-opacities'),
      angles: inputsOf('wm-angle'), grid: byId('wm-grid'), positionLabel: byId('wm-position-label'),
      pageModes: inputsOf('wm-page-mode'), pageRow: byId('wm-page-modes'), range: byId('wm-range'), rangeErr: byId('wm-range-err'),
      summary: byId('wm-summary'),
    };
    buildColors();
    buildOpacities();
    buildPositions();

    onChecked(el.types, (value) => tool().setType(value));
    onChecked(el.sizes, (value) => tool().setSize(value));
    onChecked(el.angles, (value) => tool().setAngle(Number(value)));
    onChecked(el.pageModes, (value) => tool().setPageMode(value));
    el.text.addEventListener('input', () => tool().setText(el.text.value));
    el.range.addEventListener('input', () => tool().setRange(el.range.value));
    // 範囲の欄に触れたら「範囲」を選ぶ。ラジオまで戻らせない（PDF→画像と同じ）。
    el.range.addEventListener('focus', () => tool().setPageMode('range'));
    onClick(el.useOpen, () => tool().useOpenTab());
    onClick(el.pick, () => tool().pickFile());
    onClick(el.imagePick, () => tool().pickImage());
    onClick(el.run, () => tool().run());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsWatermarkView = { init, render, sync };
})(typeof window !== 'undefined' ? window : globalThis);
