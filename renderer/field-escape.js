(function (root) {
  'use strict';

  // 欄で押した Esc（spec-4b-7a 確定事項E。決定68 ②）。欄の部品が bind で登録し、Esc の振り分け（escape-order.js）が leave を呼ぶ。
  // 欄が自分で Esc を受けないのは、欄にフォーカスがあるときでも、紙の上で引いている途中の操作と浮いている小窓を先に取りやめるため
  // （確定事項E4）。
  //   shown を渡した欄: 打ちかけを捨てて shown() の値（いま見せている値）に戻し、欄から抜ける。値は当てない
  //   commit を渡した欄: 打った文を確定して欄から抜ける（本文の欄）
  //   どちらも無い欄: 欄から抜けるだけ（スライダー・文字の大きさの一覧。矢印キーで変えた値はその場で当たっている）

  const fields = new WeakMap();

  function bind(field, { shown = null, commit = null } = {}) {
    if (field === null || field === undefined)
      return false;
    fields.set(field, { shown, commit });
    return true;
  }

  // 欄から抜ける。値を戻したあとで抜けると、Chromium は blur の中で change を出すことがある（打ち始めの値と違うとき）。
  // 戻した値をもう一度当てないよう、抜ける間だけ change を飲む。
  function blurQuietly(field) {
    const swallow = (event) => event.stopImmediatePropagation();
    field.addEventListener('change', swallow, true);
    try {
      field.blur();
    } finally {
      field.removeEventListener('change', swallow, true);
    }
  }

  // target が登録した欄なら、その欄の Esc をして true。
  function leave(target) {
    const entry = target === null || target === undefined ? undefined : fields.get(target);
    if (entry === undefined)
      return false;
    if (entry.commit !== null) {
      entry.commit();
      target.blur();
      return true;
    }
    if (entry.shown !== null)
      target.value = entry.shown();
    blurQuietly(target);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.fieldEscape = { bind, leave, isBound: (node) => fields.has(node) };
})(typeof window !== 'undefined' ? window : globalThis);
