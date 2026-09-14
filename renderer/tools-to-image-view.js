(function (root) {
  'use strict';

  // PDF→画像の画面の描画（spec-3-3 確定事項27〜30）。
  //
  // 状態は tools-to-image.js が持つ。ここは source() と currentPlan() を読んで DOM に
  // 写し、操作をあちらの関数へ返すだけである。範囲の欄は打つたびに描き直さず、
  // フォーカスの無いときだけ値を合わせる（分割の sync と同じ理由）。

  let el = null;

  const tool = () => root.SigK.toolsToImage;

  function setDisabled(node, disabled) {
    if (disabled)
      node.setAttribute('aria-disabled', 'true');
    else
      node.removeAttribute('aria-disabled');
  }

  function code(text) {
    const node = el.doc.createElement('code');
    node.textContent = text;
    return node;
  }

  // ---- 対象 ----

  function renderTarget() {
    const src = tool().source();
    el.file.hidden = src === null;
    el.empty.hidden = src !== null;
    if (src === null)
      return;
    el.name.textContent = src.name;
    el.file.title = src.path;
    el.pages.textContent = src.pending ? '…' : (src.pageCount === null ? '' : `${src.pageCount} ページ`);
    el.file.classList.toggle('blocked', src.blocked !== null);
    const note = src.blocked ?? src.note;
    el.note.textContent = note ?? '';
    el.note.hidden = note === null || note === undefined;
    el.note.classList.toggle('error', src.blocked !== null);
  }

  // ---- 出力の例と要約（確定事項30） ----

  function renderExample(plan) {
    el.example.replaceChildren();
    if (!plan.ready) {
      if (plan.error !== null) {
        const err = el.doc.createElement('span');
        err.className = 'err';
        err.textContent = plan.error;
        el.example.append(err);
      }
      return;
    }
    const { names, pixel } = plan;
    const count = el.doc.createElement('span');
    count.className = 'n';
    const size = pixel === null ? '' : `・${pixel.width}×${pixel.height} px`;
    count.textContent = `（${names.length} ファイル${size}）`;
    if (names.length === 1)
      el.example.append(code(names[0]), count);
    else
      el.example.append(code(names[0]), ' … ', code(names[names.length - 1]), count);
  }

  function summaryFor(plan) {
    if (!plan.ready)
      return '';
    return `${plan.pages.length} ページを ${plan.format.label}（${plan.dpi} dpi）で ${plan.names.length} ファイルへ`;
  }

  // 計画に関わるものだけを合わせる。対象の行は触らない。
  function sync() {
    if (el === null)
      return false;
    const settings = tool().settings();
    const plan = tool().currentPlan();
    const running = tool().isRunning();

    for (const [mode, radio] of Object.entries(el.pageModes)) {
      radio.checked = settings.mode === mode;
      radio.disabled = running;
    }
    const rangeOn = settings.mode === 'range';
    if (el.doc.activeElement !== el.range && el.range.value !== settings.range)
      el.range.value = settings.range;
    el.range.disabled = running;
    // 範囲の記法の誤りは欄の下にも出す（上限・画素の上限は出力の例だけ）。
    el.rangeRow.classList.toggle('on', rangeOn);
    const rangeInvalid = rangeOn && plan.ready !== true && plan.errorKind === 'range';
    el.range.classList.toggle('invalid', rangeInvalid);
    el.rangeErr.textContent = rangeInvalid ? plan.error : '';
    el.rangeErr.hidden = !rangeInvalid;

    for (const [format, radio] of Object.entries(el.formats)) {
      radio.checked = settings.format === format;
      radio.disabled = running;
    }
    for (const [dpi, radio] of Object.entries(el.dpis)) {
      radio.checked = settings.dpi === Number(dpi);
      radio.disabled = running;
    }

    el.folder.textContent = settings.folder ?? '';
    el.folder.title = settings.folder ?? '';
    renderExample(plan);
    el.summary.textContent = summaryFor(plan);

    setDisabled(el.run, !tool().canRun());
    for (const control of [el.useOpen, el.pick, el.folderPick])
      setDisabled(control, running);
    return true;
  }

  function render() {
    if (el === null)
      return false;
    renderTarget();
    return sync();
  }

  function onClick(node, handler) {
    node.addEventListener('click', () => {
      if (node.getAttribute('aria-disabled') !== 'true')
        handler();
    });
  }

  function init(doc, win) {
    if (win.__sigkToolsToImageViewReady === true)
      return false;
    const run = doc.getElementById('toimage-run');
    if (run === null)
      return false;
    win.__sigkToolsToImageViewReady = true;

    const byId = (id) => doc.getElementById(id);
    const radios = (name) => Object.fromEntries([...doc.querySelectorAll(`input[name="${name}"]`)].map((input) => [input.value, input]));
    el = {
      doc, win, run,
      file: byId('toimage-file'), name: byId('toimage-name'), pages: byId('toimage-pages'), note: byId('toimage-note'),
      empty: byId('toimage-empty'), useOpen: byId('toimage-use-open'), pick: byId('toimage-pick'),
      pageModes: radios('toimage-page-mode'), rangeRow: byId('toimage-page-modes'),
      range: byId('toimage-range'), rangeErr: byId('toimage-range-err'),
      formats: radios('toimage-format'), dpis: radios('toimage-dpi'),
      folder: byId('toimage-folder'), folderPick: byId('toimage-folder-pick'),
      example: byId('toimage-example'), summary: byId('toimage-summary'),
    };

    for (const [mode, radio] of Object.entries(el.pageModes))
      radio.addEventListener('change', () => { if (radio.checked) tool().setPageMode(mode); });
    el.range.addEventListener('input', () => tool().setRange(el.range.value));
    // 欄に触れたら「範囲」を選ぶ。ラジオまで戻らせない（分割と同じ）。
    el.range.addEventListener('focus', () => tool().setPageMode('range'));
    for (const [format, radio] of Object.entries(el.formats))
      radio.addEventListener('change', () => { if (radio.checked) tool().setFormat(format); });
    for (const [dpi, radio] of Object.entries(el.dpis))
      radio.addEventListener('change', () => { if (radio.checked) tool().setDpi(Number(dpi)); });

    onClick(el.useOpen, () => tool().useOpenTab());
    onClick(el.pick, () => tool().pickFile());
    onClick(el.folderPick, () => tool().pickFolder());
    onClick(el.run, () => tool().run());

    render();
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.toolsToImageView = { init, render, sync };
})(typeof window !== 'undefined' ? window : globalThis);
