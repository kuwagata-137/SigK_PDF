(function (root) {
  'use strict';

  // 右パネルのテキストの行（spec-4-2 確定事項2・34）。annotation-props.js から「文字の大きさ」の行を移した（spec-4b-4a。中身は
  // 変えていない）。テキストの道具を持っているか、テキストを選んでいるときだけ出す。

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  // size は出す大きさか null（行を隠す）。
  function render(size) {
    if (el === null)
      return false;
    el.sizeRow.hidden = size === null;
    if (size !== null)
      el.size.value = String(size);
    return true;
  }

  // 文字の大きさの選択肢はプリセットから 1 度だけ組む（spec-4-2 確定事項34）。
  function fillSizes(doc, select) {
    select.replaceChildren(...root.SigK.annotationPresets.FONT_SIZES.map((value) => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = `${value} pt`;
      return option;
    }));
    select.addEventListener('change', () => annotate().setFontSize(Number(select.value)));
  }

  function init(doc, win) {
    if (win.__sigkTextRowsReady === true)
      return false;
    const sizeRow = doc.getElementById('props-size-row');
    const size = doc.getElementById('props-size');
    if (sizeRow === null || size === null)
      return false;
    win.__sigkTextRowsReady = true;
    el = { doc, sizeRow, size };
    fillSizes(doc, size);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationTextRows = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
