(function (root) {
  'use strict';

  // 「色の設定」の画面（spec-7-2 確定事項C。見本 screenshots/office-color-mock-06.png・07.png）。色の一覧の［その他の色…］で開く。
  //
  // タブは「標準」（六角形に並べた色）と「ユーザー設定」（色合いと鮮やかさの面・明るさの帯・RGB か HSL の数値・16 進）。右に［OK］［キャンセル］と
  // 「新規」「現在」の色見本を置く。［OK］・Enter で選んだ色を渡し、［キャンセル］・✕・Esc で何もせずに閉じる。最初は「標準」で開き、アプリを
  // 閉じるまでは最後に開いていたタブで開く。透過性は入れない（決定87 ③）。計算は color-model.js。
  //
  // 意匠と逃げ道（jsdom に showModal が無い）は confirm-flatten.js と揃える。

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MODEL_LABELS = Object.freeze({ RGB: ['赤', '緑', '青'], HSL: ['色合い', '鮮やかさ', '明るさ'] });

  let el = null;
  // 開いている間の状態。rgb は 0〜255、hsl は 0〜360・0〜1・0〜1。灰色では色合いと鮮やかさを持ち越す（面の印が飛ばないように）。
  const state = { open: false, tab: 'standard', model: 'RGB', rgb: [255, 255, 255], hsl: [0, 0, 1], current: '#ffffff', onPick: null, drag: null };

  function model() {
    return root.SigK.colorModel;
  }

  function hexNow() {
    return model().hexOf(state.rgb);
  }

  function setRgb(rgb) {
    state.rgb = rgb.map(model().clampByte);
    const [h, s, l] = model().rgbToHsl(...state.rgb);
    state.hsl = [s > 0 ? h : state.hsl[0], l > 0 && l < 1 ? s : state.hsl[1], l];
  }

  function setHsl(h, s, l) {
    state.hsl = [Math.max(0, Math.min(360, h)), Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))];
    state.rgb = model().hslToRgb(...state.hsl);
  }

  // ---- 標準のタブ ----

  function buildStandard() {
    const { STANDARD_RADIUS: radius, hexagonPath, standardCells } = model();
    const svg = el.hex;
    svg.replaceChildren();
    for (const cell of standardCells()) {
      const path = el.doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', hexagonPath(cell.x, cell.y, radius));
      path.setAttribute('fill', cell.color);
      path.setAttribute('class', 'hx');
      path.dataset.color = cell.color;
      path.addEventListener('click', () => {
        setRgb(model().rgbOf(cell.color));
        sync();
      });
      path.addEventListener('dblclick', () => {
        setRgb(model().rgbOf(cell.color));
        ok();
      });
      svg.append(path);
    }
    const mark = el.doc.createElementNS(SVG_NS, 'path');
    mark.setAttribute('class', 'hx-on');
    svg.append(mark);
    el.hexMark = mark;
  }

  function syncStandard() {
    const hex = hexNow();
    const cell = [...el.hex.querySelectorAll('.hx')].find((path) => path.dataset.color === hex);
    el.hexMark.setAttribute('d', cell?.getAttribute('d') ?? '');
  }

  // ---- ユーザー設定のタブ ----

  function numbersOf() {
    if (state.model === 'RGB')
      return state.rgb;
    const [h, s, l] = state.hsl;
    return [Math.round(h / 360 * 255), Math.round(s * 255), Math.round(l * 255)];
  }

  function syncCustom(skip = null) {
    const [h, s, l] = state.hsl;
    el.cross.style.left = `${h / 360 * 100}%`;
    el.cross.style.top = `${(1 - s) * 100}%`;
    el.lumArrow.style.top = `${(1 - l) * 100}%`;
    el.lum.style.background = `linear-gradient(to bottom, #ffffff, ${model().hexOf(model().hslToRgb(h, s, 0.5))}, #000000)`;
    const values = numbersOf();
    MODEL_LABELS[state.model].forEach((label, i) => {
      el.numberLabels[i].textContent = `${label}:`;
      el.numbers[i].setAttribute('aria-label', label);
      if (el.numbers[i] !== skip)
        el.numbers[i].value = String(values[i]);
    });
    if (el.hexInput !== skip)
      el.hexInput.value = hexNow().toUpperCase();
  }

  function onNumber(input) {
    const values = el.numbers.map((each) => model().clampByte(each.value));
    if (state.model === 'RGB')
      setRgb(values);
    else
      setHsl(values[0] / 255 * 360, values[1] / 255, values[2] / 255);
    sync(input);
  }

  function onHex() {
    const hex = model().parseHex(el.hexInput.value);
    if (hex === null)
      return;
    setRgb(model().rgbOf(hex));
    sync(el.hexInput);
  }

  // 面と帯は押して引いて決める。
  function startDrag(event, target) {
    if (event.button !== 0)
      return;
    event.preventDefault();
    state.drag = target;
    moveDrag(event);
    el.doc.addEventListener('mousemove', moveDrag);
    el.doc.addEventListener('mouseup', endDrag);
  }

  function moveDrag(event) {
    const box = (state.drag === 'field' ? el.field : el.lum).getBoundingClientRect();
    const x = box.width > 0 ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : 0;
    const y = box.height > 0 ? Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) : 0;
    const [h, s, l] = state.hsl;
    if (state.drag === 'field')
      setHsl(x * 360, 1 - y, l <= 0 || l >= 1 ? 0.5 : l);
    else
      setHsl(h, s, 1 - y);
    sync();
  }

  function endDrag() {
    state.drag = null;
    el.doc.removeEventListener('mousemove', moveDrag);
    el.doc.removeEventListener('mouseup', endDrag);
  }

  // ---- 共通 ----

  function sync(skip = null) {
    el.newSwatch.style.background = hexNow();
    syncStandard();
    syncCustom(skip);
  }

  function showTab(tab) {
    state.tab = tab;
    for (const button of el.tabs) {
      const on = button.dataset.tab === tab;
      button.classList.toggle('on', on);
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
    }
    el.standard.hidden = tab !== 'standard';
    el.custom.hidden = tab !== 'custom';
  }

  function close() {
    if (!state.open)
      return false;
    state.open = false;
    state.onPick = null;
    endDrag();
    if (typeof el.dialog.close === 'function' && el.dialog.open === true)
      el.dialog.close();
    else
      el.dialog.removeAttribute('open');
    return true;
  }

  function ok() {
    if (!state.open)
      return false;
    const onPick = state.onPick;
    const hex = hexNow();
    close();
    root.SigK.colorMemory?.pushRecent(hex);
    onPick?.(hex);
    return true;
  }

  // 開く。current は今の色（null・色でなければ白）、onPick は［OK］で選んだ '#rrggbb' を受ける。
  function open({ current = null, onPick }) {
    if (el === null)
      return false;
    close();
    const hex = model().parseHex(current ?? '') ?? '#ffffff';
    state.current = hex;
    state.onPick = onPick;
    state.hsl = [0, 0, 1];
    setRgb(model().rgbOf(hex));
    el.currentSwatch.style.background = hex;
    el.model.value = state.model;
    showTab(state.tab);
    sync();
    state.open = true;
    if (typeof el.dialog.showModal === 'function')
      el.dialog.showModal();
    else
      el.dialog.setAttribute('open', '');
    el.okButton.focus?.();
    return true;
  }

  function isOpen() {
    return state.open;
  }

  function init(doc, win) {
    if (win.__sigkColorDialogReady === true)
      return false;
    const dialog = doc.getElementById('color-dialog');
    if (dialog === null)
      return false;
    win.__sigkColorDialogReady = true;
    const byId = (id) => doc.getElementById(id);
    el = {
      doc,
      dialog,
      tabs: [...dialog.querySelectorAll('.cdlg-tabs [data-tab]')],
      standard: byId('color-dialog-standard'),
      custom: byId('color-dialog-custom'),
      hex: byId('color-dialog-hex'),
      field: byId('color-dialog-field'),
      cross: byId('color-dialog-cross'),
      lum: byId('color-dialog-lum'),
      lumArrow: byId('color-dialog-lum-arrow'),
      model: byId('color-dialog-model'),
      numbers: [0, 1, 2].map((i) => byId(`color-dialog-n${i}`)),
      numberLabels: [0, 1, 2].map((i) => byId(`color-dialog-l${i}`)),
      hexInput: byId('color-dialog-hexcode'),
      newSwatch: byId('color-dialog-new'),
      currentSwatch: byId('color-dialog-current'),
      okButton: byId('color-dialog-ok'),
    };
    buildStandard();
    for (const button of el.tabs)
      button.addEventListener('click', () => showTab(button.dataset.tab));
    // タブは ← → で移る。
    dialog.querySelector('.cdlg-tabs').addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        return;
      event.preventDefault();
      showTab(state.tab === 'standard' ? 'custom' : 'standard');
      el.tabs.find((button) => button.dataset.tab === state.tab)?.focus();
    });
    el.field.addEventListener('mousedown', (event) => startDrag(event, 'field'));
    el.lum.addEventListener('mousedown', (event) => startDrag(event, 'lum'));
    el.model.addEventListener('change', () => {
      state.model = el.model.value === 'HSL' ? 'HSL' : 'RGB';
      sync();
    });
    for (const input of el.numbers)
      input.addEventListener('input', () => onNumber(input));
    el.hexInput.addEventListener('input', onHex);
    // 欄の中の Enter は［OK］（ボタンの上の Enter はそのボタン）。
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target?.tagName !== 'BUTTON' && event.target?.tagName !== 'SELECT') {
        event.preventDefault();
        ok();
      }
    });
    el.okButton.addEventListener('click', ok);
    byId('color-dialog-cancel').addEventListener('click', close);
    byId('color-dialog-close').addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('close', () => {
      state.open = false;
      state.onPick = null;
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.colorDialog = { init, open, close, ok, isOpen, tab: () => state.tab, color: () => hexNow() };
})(typeof window !== 'undefined' ? window : globalThis);
