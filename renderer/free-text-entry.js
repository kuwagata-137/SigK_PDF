(function (root) {
  'use strict';

  // テキストの書き込みの書式の欄の純粋層（spec-4b-4a 確定事項A1・A2・A4・I1）。検証・写し・比較・ワーカーへ渡す形を持ち、
  // annotation-entry.js・annotation-entry-rules.js がテキストについてここを呼ぶ。DOM に触れない。
  //
  //   width        … 折り返しの幅。無い＝今までの形（折り返さない）、'auto'＝自動（全角 12 字）、正の数＝固定（中身の幅 pt）
  //   bold・italic … true のときだけ持つ。今までの形は持てない（付けるときは新しい形へ移す。確定事項A2）

  const WIDTH_AUTO = 'auto';
  const FLAGS = Object.freeze(['bold', 'italic']);
  const FIELDS = Object.freeze(['width', ...FLAGS]);

  function isNewForm(entry) {
    return entry?.width !== undefined;
  }

  function validWidth(value) {
    return value === WIDTH_AUTO || (Number.isFinite(value) && value > 0);
  }

  // 書式の欄の形。
  function validFields(entry) {
    if (entry.width !== undefined && !validWidth(entry.width))
      return false;
    if (!FLAGS.every((flag) => entry[flag] === undefined || entry[flag] === true))
      return false;
    return isNewForm(entry) || FLAGS.every((flag) => entry[flag] === undefined);
  }

  // patch の値。太字・斜体は true か false（false は外す）。
  function validPatchValue(field, value) {
    if (field === 'width')
      return validWidth(value);
    return FLAGS.includes(field) && typeof value === 'boolean';
  }

  // 当てた後の形を整える（false の太字・斜体は持たない）。entry は当てた後の新しい写しで、ここで直す。
  function tidy(entry) {
    for (const flag of FLAGS) {
      if (entry[flag] === false)
        delete entry[flag];
    }
    return entry;
  }

  function copyFields(entry, copy) {
    if (entry.width !== undefined)
      copy.width = entry.width;
    for (const flag of FLAGS) {
      if (entry[flag] === true)
        copy[flag] = true;
    }
    return copy;
  }

  function sameFields(a, b) {
    return a.width === b.width && FLAGS.every((flag) => (a[flag] === true) === (b[flag] === true));
  }

  // ワーカーへ渡す欄（確定事項I1）。新しい形は、画面で決めた行 lines と余白 padding を添える（layout は free-text-layout.js の
  // layoutOf の答え）。今までの形は何も足さない。新しい形で layout が無ければ lines を付けず、ワーカーが断る（黙って折り返さずに
  // 保存しない）。
  function saveFields(entry, layout) {
    if (!isNewForm(entry))
      return {};
    const saved = { width: entry.width };
    for (const flag of FLAGS) {
      if (entry[flag] === true)
        saved[flag] = true;
    }
    if (Array.isArray(layout?.lines) && Number.isFinite(layout.padding)) {
      saved.lines = [...layout.lines];
      saved.padding = layout.padding;
    }
    return saved;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextEntry = { WIDTH_AUTO, FLAGS, FIELDS, isNewForm, validWidth, validFields, validPatchValue, tidy, copyFields, sameFields, saveFields };
})(typeof window !== 'undefined' ? window : globalThis);
