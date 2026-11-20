(function (root) {
  'use strict';

  // プロパティパネルのマーキングの行（spec-7-9 確定事項F2・F4）。行「形」（アイコンのボタン 5 つ。ツールチップで名前）と、大きさの
  // 数値欄 2 行（1 行目は外の円の直径〔注意マークは三角形の幅〕、2 行目は中の円の直径・十字線の長さ・文字サイズ）と、番号付き丸の「番号」。
  //
  // マーキングを 1 件選択している時はその値を、マーキングの書き込みツールを選択している時は次に配置する値（番号の行は無し）を表示する。
  // 複数選択・トリミング・モザイク・ほかの書き込みでは隠す（annotation-props.js・annotation-bulk-props.js・trim-props.js・
  // mosaic-props.js が render を呼ぶ）。数値欄は Enter・フォーカスを外す（change）で確定し、範囲の外と数でない値は当てずに今の値へ
  // 戻す。Esc は打ちかけを捨てて今の値へ戻す（field-escape.js）。打ちかけの値は、打ち始めた時の相手にだけ当てる（annotation-size-row.js と同じ）。

  // 形のボタンの絵（assets/icons.js）。
  const ICONS = Object.freeze({ target: 'marking', double: 'markingDouble', crosshair: 'markingCrosshair', number: 'markingNumber', caution: 'markingCaution' });

  let el = null;
  // いま表示している値（marking の形。行を隠していれば null）と、選択中の書き込みか（番号の行を出し入れする）。
  let shown = null;
  let typingFor = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function rules() {
    return root.SigK.markingRules;
  }

  function marking() {
    return root.SigK.annotateMarking;
  }

  function targetKey() {
    return JSON.stringify([annotate().getSelection(), annotate().getTool()]);
  }

  function shownText(input) {
    const field = input.dataset.field;
    if (shown === null || field === undefined)
      return '';
    const value = field === 'number' ? shown.number : shown[field];
    return value === undefined ? '' : String(Math.round(value * 10) / 10);
  }

  // 打っている途中の欄は上書きしない。
  function fillField(input) {
    if (el.doc.activeElement === input && typingFor === targetKey())
      return;
    input.value = shownText(input);
  }

  function renderShape(shape) {
    for (const button of el.shapeButtons) {
      const on = button.dataset.shape === shape;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function renderSizes(shape, withNumber) {
    const rows = rules().sizeRowsOf(shape);
    [[el.outerRow, el.outerLabel, el.outer], [el.innerRow, el.innerLabel, el.inner]].forEach(([row, label, input], index) => {
      row.hidden = rows[index] === undefined;
      if (row.hidden)
        return;
      label.textContent = rows[index].label;
      input.dataset.field = rows[index].field;
      input.setAttribute('aria-label', `${rows[index].label}（pt）`);
      fillField(input);
    });
    el.numberRow.hidden = !withNumber;
    if (withNumber)
      fillField(el.number);
  }

  // entry は選択中の 1 件（無ければ null）、toolKind は選択中の書き込みツールが描く種類（無ければ null）。
  function render(entry, toolKind = null) {
    if (el === null)
      return false;
    const editable = entry?.kind === 'marking' && entry.readonly !== true;
    shown = editable ? entry.marking : (entry === null && toolKind === 'marking' ? marking().getNext() : null);
    const rows = [el.shapeRow, el.outerRow, el.innerRow, el.numberRow];
    if (shown === null) {
      rows.forEach((row) => { row.hidden = true; });
      return false;
    }
    el.shapeRow.hidden = false;
    renderShape(shown.shape);
    renderSizes(shown.shape, editable && shown.shape === 'number');
    return true;
  }

  function restore(input) {
    input.value = shownText(input);
    return false;
  }

  function commit(input) {
    const text = String(input.value).trim();
    const field = input.dataset.field;
    if (text === '' || field === undefined || (typingFor !== null && typingFor !== targetKey()))
      return restore(input);
    root.SigK.annotatePreview?.cancel();
    const done = field === 'number' ? marking().setNumber(Number(text)) : marking().setSize(field, Number(text));
    if (el.doc.activeElement === input)
      typingFor = targetKey();
    restore(input);
    return done;
  }

  function bindNumber(input) {
    input.addEventListener('focus', () => { typingFor = targetKey(); });
    input.addEventListener('blur', () => { typingFor = null; });
    input.addEventListener('change', () => commit(input));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commit(input);
    });
    root.SigK.fieldEscape?.bind(input, { shown: () => shownText(input) });
  }

  function shapeButton(doc, shape) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.dataset.shape = shape;
    button.dataset.tip = `marking.${shape}`;
    button.setAttribute('aria-label', rules().SHAPE_LABELS[shape]);
    button.setAttribute('aria-pressed', 'false');
    if (root.SigK.icons?.has(ICONS[shape]))
      button.append(root.SigK.icons.create(doc, ICONS[shape], { size: 22 }));
    button.addEventListener('click', () => {
      root.SigK.annotatePreview?.cancel();
      marking().setShape(shape);
    });
    return button;
  }

  function init(doc, win) {
    if (win.__sigkMarkingPropsReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-marking-shape-row') === null)
      return false;
    win.__sigkMarkingPropsReady = true;
    el = {
      doc, shapeRow: byId('props-marking-shape-row'), shapes: byId('props-marking-shape'),
      outerRow: byId('props-marking-outer-row'), outerLabel: byId('props-marking-outer-label'), outer: byId('props-marking-outer'),
      innerRow: byId('props-marking-inner-row'), innerLabel: byId('props-marking-inner-label'), inner: byId('props-marking-inner'),
      numberRow: byId('props-marking-number-row'), number: byId('props-marking-number'),
    };
    el.number.dataset.field = 'number';
    el.shapeButtons = rules().SHAPES.map((shape) => shapeButton(doc, shape));
    el.shapes.replaceChildren(...el.shapeButtons);
    [el.outer, el.inner, el.number].forEach(bindNumber);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.markingProps = { ICONS, init, render };
})(typeof window !== 'undefined' ? window : globalThis);
