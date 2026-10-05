(function (root) {
  'use strict';

  // テキストの書き込みの書式の欄の純粋層（spec-4b-4a 確定事項A1・A2・A4・I1）。検証・写し・比較・ワーカーへ渡す形を持ち、
  // annotation-entry.js・annotation-entry-rules.js がテキストについてここを呼ぶ。DOM に触れない。
  //
  //   width        … 折り返しの幅。無い＝今までの形（折り返さない）、'auto'＝自動（全角 12 字）、正の数＝固定（中身の幅 pt）
  //   bold・italic … true のときだけ持つ
  //   fill         … 塗り（'#rrggbb'）。無ければ持たない
  //   borderColor・borderWidth … 枠線の色（'#rrggbb'）と太さ（pt）。枠線があるときだけ、2 つそろえて持つ
  //   callout      … 吹き出し（spec-4b-4b 確定事項A2）。{ tip: [x, y] }（しっぽの先の紙の上の実際の点）。吹き出しのときだけ持つ
  // 今までの形は、太字・斜体・塗り・枠線を持てず、吹き出しにもならない（付けるときは新しい形へ移す。確定事項A2）。

  const WIDTH_AUTO = 'auto';
  const FLAGS = Object.freeze(['bold', 'italic']);
  const DECOR = Object.freeze(['fill', 'borderColor', 'borderWidth']);
  const FIELDS = Object.freeze(['width', ...FLAGS, ...DECOR, 'callout']);
  const HEX = /^#[0-9a-f]{6}$/i;

  function isNewForm(entry) {
    return entry?.width !== undefined;
  }

  function validWidth(value) {
    return value === WIDTH_AUTO || (Number.isFinite(value) && value > 0);
  }

  function isHex(value) {
    return typeof value === 'string' && HEX.test(value);
  }

  // 吹き出しの欄（{ tip: [x, y] } だけ）。
  function validCallout(value) {
    const tip = value?.tip;
    return typeof value === 'object' && value !== null && Object.keys(value).length === 1
      && Array.isArray(tip) && tip.length === 2 && tip.every(Number.isFinite);
  }

  function isCallout(entry) {
    return entry?.callout !== undefined;
  }

  function validDecor(entry) {
    if (entry.fill !== undefined && !isHex(entry.fill))
      return false;
    if (entry.borderColor === undefined)
      return entry.borderWidth === undefined;
    return isHex(entry.borderColor) && Number.isFinite(entry.borderWidth) && entry.borderWidth > 0;
  }

  // 書式の欄の形。
  function validFields(entry) {
    if (entry.width !== undefined && !validWidth(entry.width))
      return false;
    if (!FLAGS.every((flag) => entry[flag] === undefined || entry[flag] === true) || !validDecor(entry))
      return false;
    if (entry.callout !== undefined && !validCallout(entry.callout))
      return false;
    return isNewForm(entry) || [...FLAGS, ...DECOR, 'callout'].every((field) => entry[field] === undefined);
  }

  // patch の値。太字・斜体は true か false（false は外す）、塗り・枠線の色は '#rrggbb' か null（null は外す）。
  function validPatchValue(field, value) {
    if (field === 'width')
      return validWidth(value);
    if (FLAGS.includes(field))
      return typeof value === 'boolean';
    if (field === 'fill' || field === 'borderColor')
      return value === null || isHex(value);
    if (field === 'callout')
      return validCallout(value);
    return field === 'borderWidth' && Number.isFinite(value) && value > 0;
  }

  // 当てた後の形を整える（false の太字・斜体、null の塗り、枠線が無いときの太さは持たない）。entry は当てた後の新しい写しで、ここで直す。
  function tidy(entry) {
    for (const flag of FLAGS) {
      if (entry[flag] === false)
        delete entry[flag];
    }
    if (entry.fill === null)
      delete entry.fill;
    if ((entry.borderColor ?? null) === null) {
      delete entry.borderColor;
      delete entry.borderWidth;
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
    if (isHex(entry.fill))
      copy.fill = entry.fill;
    if (isHex(entry.borderColor)) {
      copy.borderColor = entry.borderColor;
      copy.borderWidth = entry.borderWidth;
    }
    if (validCallout(entry.callout))
      copy.callout = { tip: [...entry.callout.tip] };
    return copy;
  }

  function sameTip(a, b) {
    if (a === undefined || b === undefined)
      return a === b;
    return a.tip[0] === b.tip[0] && a.tip[1] === b.tip[1];
  }

  function sameFields(a, b) {
    const border = a.borderColor ?? null;
    return a.width === b.width && FLAGS.every((flag) => (a[flag] === true) === (b[flag] === true))
      && (a.fill ?? null) === (b.fill ?? null) && border === (b.borderColor ?? null) && (border === null || a.borderWidth === b.borderWidth)
      && sameTip(a.callout, b.callout);
  }

  // ワーカーへ渡す欄（確定事項I1）。新しい形は、書式の欄と、画面で決めた行 lines と、箱の左上から中身の左上までの inset [左, 上]
  // （余白と斜体の分）を添える（layout は free-text-layout.js の layoutOf の答え）。今までの形は何も足さない。新しい形で layout が
  // 無ければ lines を付けず、ワーカーが断る（黙って折り返さずに保存しない）。
  function saveFields(entry, layout) {
    if (!isNewForm(entry))
      return {};
    const saved = copyFields(entry, {});
    if (Array.isArray(layout?.lines) && Number.isFinite(layout.inset?.left) && Number.isFinite(layout.inset?.top)) {
      saved.lines = [...layout.lines];
      saved.inset = [layout.inset.left, layout.inset.top];
    }
    return saved;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.freeTextEntry = {
    WIDTH_AUTO, FLAGS, DECOR, FIELDS, isNewForm, isCallout, validWidth, validCallout, validFields, validPatchValue, tidy, copyFields, sameFields, saveFields,
  };
})(typeof window !== 'undefined' ? window : globalThis);
