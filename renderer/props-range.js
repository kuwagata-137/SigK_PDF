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

  // 数値欄ごとの覚え（bind で作る）。text はいま見せている文字、typingFor はフォーカスが入ったときの相手（無ければ null）。
  const states = new WeakMap();

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
  function bind(range, number, { min, max, onPreview, onCommit, clamp = (text) => clampOf(text, min, max), targetOf = null }) {
    const state = { text: null, targetOf, typingFor: null };
    states.set(number, state);
    range.addEventListener('input', () => {
      number.value = range.value;
      onPreview(Number(range.value));
    });
    range.addEventListener('change', () => onCommit(Number(range.value)));
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
  SigK.propsRange = { clampOf, bind, show };
})(typeof window !== 'undefined' ? window : globalThis);
