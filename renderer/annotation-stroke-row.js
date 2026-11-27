(function (root) {
  'use strict';

  // プロパティパネルの見出し「枠線」の最初の行のラジオボタン「あり」「なし」（docs/spec-7-10-shape-tools.md。決定102 ④）。
  //
  // 四角・丸・閉じた多角形（とその書き込みツール）の時だけ表示する（見出し「枠線」「塗り」を表示する時と同じ。annotation-fill-rows.js）。
  // 「なし」は annotate.setStrokeNone（線の色を null にする。保存では /C を書かない。今までの［線なし］と同じ）、「あり」は
  // annotate.setStrokeOn（なしにする前の線の色を当てる）。塗りつぶしがなしの時は「なし」をクリックできない（線と塗りつぶしを両方
  // なしにはできない。spec-4b-1b 確定事項4）。複数選択で、枠線のあるものとないものが混ざる時は、どちらも選択しない。
  // 「なし」の時は、見出し「枠線」の線の色・線種・線の太さ・透明度の行を非表示にする（質問 SH5 案A。テキストの枠線と、ハッチングの
  // 行と同じ決まり）。「あり」に戻すと、なしにする前の線の色（stroke-color-memo.js）と、残っている線種・線の太さ・透明度で表示する。
  // 複数選択で枠線のある書き込みか、四角・丸・閉じた多角形以外の書き込みがある時は、4 行を表示する（その書き込みの値を変えられるように）。

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  // view は annotation-style-patch.js の viewOf の形か null。split は見出し「枠線」「塗り」を表示する時。
  function render(view) {
    if (el === null)
      return false;
    const stroke = view?.split === true ? view.stroke : null;
    el.row.hidden = stroke === null || stroke === undefined;
    if (el.row.hidden)
      return true;
    el.on.checked = !stroke.mixed && stroke.value === true;
    el.off.checked = !stroke.mixed && stroke.value === false;
    // 枠線があり塗りつぶしがない時は、「なし」をクリックできない（今の決まり）。
    el.off.disabled = view.strokeNoneEnabled !== true && !el.off.checked;
    el.offLabel.classList.toggle('disabled', el.off.disabled);
    // 4 行の表示は annotation-style-rows.js の render が先に決めるので、ここでは非表示にするだけ。
    if (view.strokeless === true)
      el.lineRows.forEach((line) => (line.hidden = true));
    return true;
  }

  function onChange(event) {
    root.SigK.annotatePreview?.cancel();
    const done = event.target.value === 'off' ? annotate().setStrokeNone() : annotate().setStrokeOn();
    // 当てられなかった時（表示のみの書き込みなど）は、ラジオボタンを今の値に戻す。
    if (!done)
      root.SigK.annotationProps?.refresh();
  }

  function init(doc, win) {
    if (win.__sigkStrokeRowReady === true)
      return false;
    const row = doc.getElementById('props-stroke-on-row');
    if (row === null)
      return false;
    win.__sigkStrokeRowReady = true;
    el = {
      row,
      on: row.querySelector('input[value="on"]'),
      off: row.querySelector('input[value="off"]'),
      offLabel: row.querySelector('input[value="off"]').closest('label'),
      // 「なし」の時に非表示にする行（線の色・線種・線の太さ・透明度）。
      lineRows: ['props-color-row', 'props-style-row', 'props-width-row', 'props-opacity-row'].map((id) => doc.getElementById(id)).filter((line) => line !== null),
    };
    el.on.addEventListener('change', onChange);
    el.off.addEventListener('change', onChange);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationStrokeRow = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
