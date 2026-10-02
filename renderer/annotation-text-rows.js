(function (root) {
  'use strict';

  // 右パネルのテキストの行（spec-4-2 確定事項2・34、spec-4b-4a 確定事項G1〜G3・G5。モック screenshots/phase4b-4-props.png）。
  //
  // 「文字の大きさ」の行は、数値の欄（8〜200、0.5 刻み）と、右の ▼ で開くよく使う大きさの一覧。数値の欄は Enter と欄を離れたときに
  // 当て、範囲の外と半端は近い値に丸める。どちらも annotate.setFontSize へ流す（複数選択ならテキストにだけ当たる）。
  // 「書式」の行は B（太字）と I（斜体）の切り替えで、押すと annotate.setTextFlag へ流す。そろっていない（混在の）ときは押していない
  // 形に出し、押すと全部に付ける。出し入れと値は annotation-style-rows.js が annotation-style-patch.js の viewOf から渡す。
  // 複数選択でそろわなければ数値の欄を空にして「–」を出す。数値の欄に打ちかけの値は、打ち始めたときの相手（選んでいる書き込みと
  // 道具）にだけ当てる。相手が替われば欄をその相手の値に替え、打ちかけの値は捨てる。

  let el = null;
  // いま出している { value, mixed, label }。行を出していなければ null。
  let current = null;
  // いま出している書式 { bold, italic, label }（bold・italic は { value, mixed }）。行を出していなければ null。
  let format = null;
  // 数値の欄にフォーカスが入ったときの相手（targetKey）。フォーカスが無ければ null。
  let typingFor = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function presets() {
    return root.SigK.annotationPresets;
  }

  // 欄の値を当てる相手（選んでいる書き込みの鍵の並びと、持っている道具）。
  function targetKey() {
    return JSON.stringify([annotate().getSelection(), annotate().getTool()]);
  }

  // 打っている途中か（欄にフォーカスがあり、相手が打ち始めたときのまま）。
  function isTyping() {
    return el.doc.activeElement === el.size && typingFor === targetKey();
  }

  // view は null（行を隠す）か { value, mixed, label }。数だけでもよい（1 件のとき）。打っている途中の数値の欄は上書きしない。
  function render(view) {
    if (el === null)
      return false;
    current = typeof view === 'number' ? { value: view, mixed: false } : (view ?? null);
    el.sizeRow.hidden = current === null;
    if (current === null)
      return true;
    el.label.textContent = current.label ?? '文字の大きさ';
    el.size.placeholder = current.mixed ? '–' : '';
    if (!isTyping()) {
      el.size.value = current.mixed ? '' : String(current.value);
      if (el.doc.activeElement === el.size)
        typingFor = targetKey();
    }
    return true;
  }

  // 押している形か（そろって付いているときだけ）。
  function isOn(value) {
    return value?.value === true && value.mixed !== true;
  }

  // 書式の行。view は null（行を隠す）か { bold, italic, label }。
  function renderFormat(view) {
    if (el === null || el.formatRow === null)
      return false;
    format = view ?? null;
    el.formatRow.hidden = format === null;
    if (format === null)
      return true;
    el.formatLabel.textContent = format.label ?? '書式';
    for (const button of el.formatButtons) {
      const value = format[button.dataset.format];
      button.classList.toggle('on', isOn(value));
      button.setAttribute('aria-pressed', value?.mixed === true ? 'mixed' : String(isOn(value)));
    }
    return true;
  }

  // 数値の欄を今の相手の値に戻す。
  function restoreNumber() {
    el.size.value = current === null || current.mixed ? '' : String(current.value);
    return false;
  }

  // 数値の欄を当てる。数でないか、打ち始めたときと相手が替わっていれば当てずに今の値に戻す。当てたあとは、写しに替わって鍵が
  // 変わっても続けて打てるよう、今の相手を覚え直す。
  function commitNumber() {
    const value = presets().fontSizeOf(el.size.value === '' ? Number.NaN : Number(el.size.value));
    if (value === null || (typingFor !== null && typingFor !== targetKey()))
      return restoreNumber();
    el.size.value = String(value);
    const done = annotate().setFontSize(value);
    if (el.doc.activeElement === el.size)
      typingFor = targetKey();
    return done;
  }

  // よく使う大きさの一覧。先頭の見えない空の選択肢に毎回戻し、同じ大きさを選んでも当たるようにする。
  function fillSizes(doc, select) {
    const blank = doc.createElement('option');
    blank.value = '';
    blank.hidden = true;
    select.replaceChildren(blank, ...presets().FONT_SIZES.map((value) => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = `${value} pt`;
      return option;
    }));
    select.value = '';
    select.addEventListener('change', () => {
      const value = Number(select.value);
      select.value = '';
      if (presets().isFontSize(value))
        annotate().setFontSize(value);
    });
  }

  // B・I を押す。付いていれば外し、付いていない・混在なら付ける。
  function bindFormat(buttons) {
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const field = button.dataset.format;
        annotate().setTextFlag(field, !isOn(format?.[field]));
      });
    }
  }

  function init(doc, win) {
    if (win.__sigkTextRowsReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-size-row') === null || byId('props-size') === null || byId('props-size-list') === null)
      return false;
    win.__sigkTextRowsReady = true;
    el = {
      doc, sizeRow: byId('props-size-row'), label: byId('props-size-label'), size: byId('props-size'), list: byId('props-size-list'),
      formatRow: byId('props-format-row'), formatLabel: byId('props-format-label'),
      formatButtons: [...(byId('props-format')?.querySelectorAll('button[data-format]') ?? [])],
    };
    fillSizes(doc, el.list);
    bindFormat(el.formatButtons);
    el.size.addEventListener('focus', () => { typingFor = targetKey(); });
    el.size.addEventListener('blur', () => { typingFor = null; });
    el.size.addEventListener('change', commitNumber);
    el.size.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commitNumber();
    });
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationTextRows = { init, render, renderFormat };
})(typeof window !== 'undefined' ? window : globalThis);
