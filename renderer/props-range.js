(function (root) {
  'use strict';

  // 右パネルのスライダーと数値欄の組（spec-4b-1b 確定事項7・8）。線の太さ（1〜40pt）と不透明度（10〜100%）が使う。
  //
  // スライダーを動かしている間（input）は数値欄を追わせて onPreview、離したとき（change）と数値欄の確定（Enter か欄の外）で
  // onCommit を呼ぶ。数値欄は範囲の外を端へ、小数を四捨五入する（0 → 1、41 → 40、35.4 → 35）。読めなければ元の値へ戻す。
  // 窓が非活性だと blur が飛ばないので、Enter の側でも確定する。
  //
  // bind に targetOf（値を当てる相手を表す文字列を返す関数）を渡すと、数値欄に打ちかけの値は打ち始めたときの相手にだけ当てる。
  // 欄にフォーカスを置いたまま紙の上の別の書き込みを選ぶと、show が欄をその相手の値に替え、打ちかけの値は捨てる。この部品は
  // 相手が何か（選んでいる書き込みや道具）を知らず、targetOf の返す文字列を比べるだけ。
  //
  // スライダーを押して引いている途中の Esc（cancelDrag。spec-4b-7a 確定事項E3）は、下見を捨て（onCancel）、スライダーと数値欄を
  // 引く前の値に戻す。ボタンを離すまでは、引き続けても値を動かさず、離しても当てない。数値欄とスライダーの Esc（打ちかけを捨てて
  // 戻す・抜ける）は field-escape.js に登録する（確定事項E1・E2）。

  // 数値欄ごとの覚え（bind で作る）。text はいま見せている文字、typingFor はフォーカスが入ったときの相手（無ければ null）。
  const states = new WeakMap();

  // 押して引いている途中のスライダー。{ range, number, state, start, canceled, onCancel }。押していなければ null。
  let held = null;

  // 数値欄の値を範囲へ丸める。読めなければ null。
  function clampOf(text, min, max) {
    const trimmed = String(text).trim();
    const value = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(value))
      return null;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  function isFocused(number) {
    return number.ownerDocument.activeElement === number;
  }

  // 打っている途中か（欄にフォーカスがあり、targetOf を渡していれば相手が打ち始めたときのまま）。
  function isTyping(number) {
    if (!isFocused(number))
      return false;
    const state = states.get(number);
    return state === undefined || state.targetOf === null || state.typingFor === state.targetOf();
  }

  // 欄にフォーカスがあれば今の相手を覚える。
  function rememberTarget(number, state) {
    state.typingFor = state.targetOf !== null && isFocused(number) ? state.targetOf() : null;
  }

  // clamp は数値欄の丸め方（既定は範囲の端へ寄せる clampOf。回転の行は 360 の余り。spec-4b-2 確定事項26）。
  // 押したとき。離したあとの change を見終えてから外す（Chromium は mouseup の中で change を出す）。
  function hold(range, number, state, onCancel) {
    held = { range, number, state, start: range.value, canceled: false, onCancel };
    const mine = held;
    range.ownerDocument.addEventListener('mouseup', () => {
      setTimeout(() => {
        if (held === mine)
          held = null;
      }, 0);
    }, { once: true });
  }

  // 取りやめたあとの引き続け・離しは、値を引く前に戻して何もしない。
  function swallowCanceled(range) {
    if (held?.range !== range || !held.canceled)
      return false;
    range.value = held.start;
    return true;
  }

  function cancelDrag() {
    if (held === null || held.canceled)
      return false;
    held.canceled = true;
    held.range.value = held.start;
    held.number.value = held.state.text ?? held.start;
    held.onCancel?.();
    return true;
  }

  function bind(range, number, { min, max, onPreview, onCommit, onCancel = null, clamp = (text) => clampOf(text, min, max), targetOf = null }) {
    const state = { text: null, targetOf, typingFor: null };
    states.set(number, state);
    range.addEventListener('pointerdown', () => hold(range, number, state, onCancel));
    range.addEventListener('input', () => {
      if (swallowCanceled(range))
        return;
      number.value = range.value;
      onPreview(Number(range.value));
    });
    range.addEventListener('change', () => {
      if (!swallowCanceled(range))
        onCommit(Number(range.value));
    });
    // 数でないか、打ち始めたときと相手が替わっていれば、当てずにいま見せている値へ戻す。当てたあとは、写しに替わって鍵が
    // 変わっても続けて打てるよう、今の相手を覚え直す。
    const commitNumber = () => {
      const value = clamp(number.value);
      if (value === null || (targetOf !== null && state.typingFor !== null && state.typingFor !== targetOf())) {
        number.value = state.text ?? range.value;
        return;
      }
      number.value = String(value);
      range.value = String(value);
      state.text = String(value);
      onCommit(value);
      rememberTarget(number, state);
    };
    number.addEventListener('focus', () => rememberTarget(number, state));
    number.addEventListener('blur', () => { state.typingFor = null; });
    number.addEventListener('change', commitNumber);
    number.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commitNumber();
    });
    root.SigK.fieldEscape?.bind(number, { shown: () => state.text ?? range.value });
    root.SigK.fieldEscape?.bind(range);
  }

  // 値を見せる。text は数値欄に出す文字（既定は値。そろっていない値なら空）。数値欄に打っている途中なら数値欄は上書きしない
  // （読み込んだ小数の太さは数値欄にそのまま出る）。打ちかけのまま相手が替わっていれば、欄をこの値に替えて相手を覚え直す。
  function show(range, number, value, text = String(value)) {
    range.value = String(value);
    const state = states.get(number);
    if (state !== undefined)
      state.text = text;
    if (isTyping(number))
      return;
    number.value = text;
    if (state !== undefined)
      rememberTarget(number, state);
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.propsRange = { clampOf, bind, show, cancelDrag, isHeld: () => held !== null && !held.canceled };
})(typeof window !== 'undefined' ? window : globalThis);
