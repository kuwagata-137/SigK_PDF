(function (root) {
  'use strict';

  // 枠線のラジオボタン「あり」「なし」（docs/spec-7-10-shape-tools.md。決定102 ④・質問 SH5 案A・SH8 案B）。
  //
  // 図形: 見出し「枠線」の最初の行。四角・丸・閉じた多角形（とその書き込みツール）の時だけ表示する（見出し「枠線」「塗り」を表示する
  // 時と同じ。annotation-fill-rows.js）。「なし」は annotate.setStrokeNone（線の色を null にする。保存では /C を書かない。今までの［線なし］
  // と同じ）、「あり」は annotate.setStrokeOn（なしにする前の線の色を当てる。stroke-color-memo.js）。塗りつぶしがなしの時は「なし」を
  // クリックできない（線と塗りつぶしを両方なしにはできない。spec-4b-1b 確定事項4）。「なし」の時は、線の色・線種・線の太さ・透明度の
  // 行を非表示にする（質問 SH5 案A）。複数選択で枠線のある書き込みか、四角・丸・閉じた多角形以外の書き込みがある時は、4 行を表示する
  // （その書き込みの値を変えられるように）。
  // テキスト・吹き出し: 行「枠線」の名前の下。「なし」は annotateTextStyle.setBorderNone、「あり」は setBorderOn。「なし」の時は、行「枠線」の
  // 色のボタンを非表示にする（枠線の太さの行は、今までどおり枠線が無い時は表示しない）。
  // どちらも、複数選択で枠線のあるものとないものが混ざる時は、どちらも選択しない。

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function textStyle() {
    return root.SigK.annotateTextStyle;
  }

  function check(group, on) {
    group.on.checked = !on.mixed && on.value === true;
    group.off.checked = !on.mixed && on.value === false;
  }

  // 図形の見出し「枠線」の行。split は見出し「枠線」「塗り」を表示する時。
  function renderShape(view) {
    const stroke = view?.split === true ? view.stroke : null;
    el.shape.row.hidden = stroke === null || stroke === undefined;
    if (el.shape.row.hidden)
      return;
    check(el.shape, stroke);
    // 枠線があり塗りつぶしがない時は、「なし」をクリックできない（今の決まり）。
    el.shape.off.disabled = view.strokeNoneEnabled !== true && !el.shape.off.checked;
    el.shape.offLabel.classList.toggle('disabled', el.shape.off.disabled);
    // 4 行の表示は annotation-style-rows.js の render が先に決めるので、ここでは非表示にするだけ。
    if (view.strokeless === true)
      el.lineRows.forEach((line) => (line.hidden = true));
  }

  // テキスト・吹き出しの行「枠線」。行そのものの表示は annotation-style-rows.js が決める。
  function renderText(view) {
    const on = view?.border?.on ?? null;
    if (on === null)
      return;
    check(el.text, on);
    el.textChips.hidden = !on.mixed && on.value === false;
  }

  // view は annotation-style-patch.js の viewOf の形か null。
  function render(view) {
    if (el === null)
      return false;
    renderShape(view);
    renderText(view);
    return true;
  }

  function bindGroup(group, setNone, setOn) {
    const onChange = (event) => {
      root.SigK.annotatePreview?.cancel();
      const done = event.target.value === 'off' ? setNone() : setOn();
      // 当てられなかった時（表示のみの書き込みなど）は、ラジオボタンを今の値に戻す。
      if (!done)
        root.SigK.annotationProps?.refresh();
    };
    group.on.addEventListener('change', onChange);
    group.off.addEventListener('change', onChange);
  }

  function groupOf(container) {
    const off = container.querySelector('input[value="off"]');
    return { row: container, on: container.querySelector('input[value="on"]'), off, offLabel: off.closest('label') };
  }

  function init(doc, win) {
    if (win.__sigkStrokeRowReady === true)
      return false;
    const row = doc.getElementById('props-stroke-on-row');
    const border = doc.getElementById('props-border-on');
    if (row === null || border === null)
      return false;
    win.__sigkStrokeRowReady = true;
    el = {
      shape: groupOf(row),
      text: groupOf(border),
      textChips: border.parentElement.querySelector('.chip-row'),
      // 図形が「なし」の時に非表示にする行（線の色・線種・線の太さ・透明度）。
      lineRows: ['props-color-row', 'props-style-row', 'props-width-row', 'props-opacity-row'].map((id) => doc.getElementById(id)).filter((line) => line !== null),
    };
    bindGroup(el.shape, () => annotate().setStrokeNone(), () => annotate().setStrokeOn());
    bindGroup(el.text, () => textStyle().setBorderNone(), () => textStyle().setBorderOn());
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationStrokeRow = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
