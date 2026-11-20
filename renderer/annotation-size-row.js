(function (root) {
  'use strict';

  // プロパティパネルの行「大きさ」（幅・高さの数値欄）と、チェック欄「縦横比を固定」（spec-7-9 確定事項D1〜D4。質問 SH3・NM1）。
  //
  // 四角・丸・×印を 1 件選択している時は両方を、四角・丸・×印の書き込みツールを選択している時はチェック欄だけを表示する。複数選択・
  // トリミング・モザイク・ほかの書き込みでは両方を隠す（annotation-props.js・annotation-bulk-props.js・trim-props.js・mosaic-props.js
  // が render を呼ぶ）。数値欄は Enter・フォーカスを外す（change）で確定し、図形の中心を保ったまま大きさを変えて 1 世代積む
  // （annotate-transform.js の commit）。範囲の外と数でない値は当てずに今の値へ戻す。Esc は打ちかけを捨てて今の値へ戻す
  // （field-escape.js）。打ちかけの値は、打ち始めた時の相手（選択中の書き込みと書き込みツール）にだけ当てる（annotation-text-rows.js と同じ）。

  let el = null;
  // いま表示している書き込み（大きさの行を隠していれば null）。
  let shown = null;
  // 数値欄にフォーカスが入った時の相手（targetKey）。フォーカスが無ければ null。
  let typingFor = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function size() {
    return root.SigK.shapeSize;
  }

  function targetKey() {
    return JSON.stringify([annotate().getSelection(), annotate().getTool()]);
  }

  function editableBox(entry) {
    return entry !== null && entry !== undefined && entry.readonly !== true && size().isBoxKind(entry.kind);
  }

  function shownText(field) {
    return shown === null ? '' : size().shownOf(size().sizeOf(shown)[field]);
  }

  // 打っている途中の欄は上書きしない。
  function fillField(input, field) {
    if (el.doc.activeElement === input && typingFor === targetKey())
      return;
    input.value = shownText(field);
  }

  // entry は選択中の 1 件（無ければ null）、toolKind は選択中の書き込みツールが描く種類（無ければ null）。
  function render(entry, toolKind = null) {
    if (el === null)
      return false;
    shown = editableBox(entry) ? entry : null;
    el.sizeRow.hidden = shown === null;
    el.ratioRow.hidden = shown === null && !(entry === null && size().isBoxKind(toolKind));
    el.check.checked = root.SigK.shapeRatio.isKept();
    if (shown !== null) {
      fillField(el.width, 'width');
      fillField(el.height, 'height');
    }
    return !el.ratioRow.hidden;
  }

  function restore(input, field) {
    input.value = shownText(field);
    return false;
  }

  // 数値欄の確定。当てたあとは、写しに替わって鍵が変わっても続けて打てるよう、今の相手を覚え直す。
  function commit(input, field) {
    const text = String(input.value).trim();
    const entry = annotate().selectedEntry();
    if (text === '' || !editableBox(entry) || (typingFor !== null && typingFor !== targetKey()))
      return restore(input, field);
    const patch = size().sizedTo(entry, field, Number(text), { keep: root.SigK.shapeRatio.isKept() });
    if (patch === null)
      return restore(input, field);
    root.SigK.annotatePreview?.cancel();
    const done = root.SigK.annotateTransform.commit(entry, patch);
    if (el.doc.activeElement === input)
      typingFor = targetKey();
    // 当てた値を表示の形（小数 1 桁）にそろえる。当てなかった時（同じ大きさ）も今の値に戻す。
    restore(input, field);
    return done;
  }

  function bindNumber(input, field) {
    input.addEventListener('focus', () => { typingFor = targetKey(); });
    input.addEventListener('blur', () => { typingFor = null; });
    input.addEventListener('change', () => commit(input, field));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter')
        return;
      event.preventDefault();
      commit(input, field);
    });
    root.SigK.fieldEscape?.bind(input, { shown: () => shownText(field) });
  }

  function init(doc, win) {
    if (win.__sigkSizeRowReady === true)
      return false;
    const byId = (id) => doc.getElementById(id);
    if (byId('props-box-size-row') === null || byId('props-keep-ratio-row') === null)
      return false;
    win.__sigkSizeRowReady = true;
    el = {
      doc, sizeRow: byId('props-box-size-row'), width: byId('props-box-width'), height: byId('props-box-height'),
      ratioRow: byId('props-keep-ratio-row'), check: byId('props-keep-ratio'),
    };
    bindNumber(el.width, 'width');
    bindNumber(el.height, 'height');
    el.check.addEventListener('change', () => root.SigK.shapeRatio.setKept(el.check.checked));
    root.SigK.fieldEscape?.bind(el.check);
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationSizeRow = { init, render };
})(typeof window !== 'undefined' ? window : globalThis);
