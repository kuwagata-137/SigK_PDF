(function (root) {
  'use strict';

  // 右パネルのテキストの行（spec-4-2 確定事項2・34、spec-4b-4a 確定事項G1・G2・G5。モック screenshots/phase4b-4-props.png）。
  //
  // 「文字の大きさ」の行は、数値の欄（8〜200、0.5 刻み）と、右の ▼ で開くよく使う大きさの一覧。数値の欄は Enter と欄を離れたときに
  // 当て、範囲の外と半端は近い値に丸める。どちらも annotate.setFontSize へ流す（複数選択ならテキストにだけ当たる）。出し入れと値は
  // annotation-style-rows.js が annotation-style-patch.js の viewOf から渡す。複数選択でそろわなければ数値の欄を空にして「–」を出す。

  let el = null;
  // いま出している { value, mixed, label }。行を出していなければ null。
  let current = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function presets() {
    return root.SigK.annotationPresets;
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
    if (el.doc.activeElement !== el.size)
      el.size.value = current.mixed ? '' : String(current.value);
    return true;
  }

  // 数値の欄を当てる。数でなければ今の値に戻す。
  function commitNumber() {
    const value = presets().fontSizeOf(el.size.value === '' ? Number.NaN : Number(el.size.value));
    if (value === null) {
      el.size.value = current === null || current.mixed ? '' : String(current.value);
      return false;
    }
    el.size.value = String(value);
    return annotate().setFontSize(value);
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

  function init(doc, win) {
    if (win.__sigkTextRowsReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-size-row') === null || byId('props-size') === null || byId('props-size-list') === null)
      return false;
    win.__sigkTextRowsReady = true;
    el = { doc, sizeRow: byId('props-size-row'), label: byId('props-size-label'), size: byId('props-size'), list: byId('props-size-list') };
    fillSizes(doc, el.list);
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
  SigK.annotationTextRows = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
