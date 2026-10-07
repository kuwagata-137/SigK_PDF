(function (root) {
  'use strict';

  // 右パネルの「回転」の行（spec-4b-2 確定事項25〜27。モック screenshots/phase4b-2-square.png）。
  //
  // 四角・丸・テキストを選んでいるときだけ出す（次に描く図形は 0°。テキストは spec-4b-4b 確定事項C2）。スライダー（0〜359）を動かしている間は下見
  // （annotate-preview.updateShape）、離したとき・数値欄の確定・0°/90°/180°/270° のボタンで 1 世代（annotate-transform.js の commit）。
  // 数値欄は小数を四捨五入し、範囲の外は 360 の余りにする（-30 → 330、370 → 10）。読み込んだ小数の角度は数値欄にそのまま出し、
  // スライダーは丸めた位置に置く。

  const PRESETS = Object.freeze([0, 90, 180, 270]);

  let el = null;

  function annotate() {
    return root.SigK.annotate;
  }

  function rotation() {
    return root.SigK.shapeRotation;
  }

  function isTurnable(entry) {
    return ['square', 'circle', 'text', 'cross', 'polygon'].includes(entry?.kind);
  }

  // 数値欄の値を当てる相手（選んでいる書き込みの鍵の並びと、持っている道具）。打ちかけの値は打ち始めたときの相手にだけ当てる。
  function targetKey() {
    return JSON.stringify([annotate().getSelection(), annotate().getTool()]);
  }

  function selectedBoxed() {
    const entry = annotate()?.selectedEntry() ?? null;
    return isTurnable(entry) && entry.readonly !== true ? entry : null;
  }

  // テキストは今までの形を新しい形へ移す（free-text-turn.js。spec-4b-4b 確定事項A3）。
  function anglePatch(entry, angle) {
    const normalized = rotation().normalizeAngle(Math.round(angle));
    if (entry.kind === 'text')
      return root.SigK.freeTextTurn.anglePatch(entry, normalized);
    return { angle: normalized, ...root.SigK.shapeGeometry.rectOfEntry(entry, { angle: normalized }) };
  }

  // スライダーを動かしている間の下見。
  function previewAngle(angle) {
    const entry = selectedBoxed();
    if (entry === null || !Number.isFinite(angle))
      return false;
    return root.SigK.annotatePreview.updateShape(entry.ref ?? entry.id, anglePatch(entry, angle));
  }

  // 確定（スライダーを離した・数値欄の確定・ボタン）。同じ角度なら積まない。
  function setAngle(angle) {
    const entry = selectedBoxed();
    root.SigK.annotatePreview.cancel();
    if (entry === null || !Number.isFinite(angle))
      return false;
    return root.SigK.annotateTransform.commit(entry, anglePatch(entry, angle));
  }

  // 数値欄の値（小数は四捨五入、範囲の外は 360 の余り）。読めなければ null。
  function angleOfText(text) {
    const trimmed = String(text).trim();
    const value = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(value))
      return null;
    return rotation().normalizeAngle(Math.round(value));
  }

  // 選んでいる書き込みに合わせて出し入れする（annotation-props.js の refresh）。
  function render(entry) {
    if (el === null)
      return false;
    const show = isTurnable(entry) && entry.readonly !== true;
    el.row.hidden = !show;
    if (!show)
      return false;
    const angle = rotation().angleOf(entry);
    root.SigK.propsRange.show(el.range, el.number, angle);
    el.range.value = String(Math.round(angle) % 360);
    for (const button of el.presets)
      button.classList.toggle('on', Number(button.dataset.angle) === angle);
    return true;
  }

  function init(doc, win) {
    if (win.__sigkAngleRowReady === true)
      return false;
    const row = doc.getElementById('props-angle-row');
    if (row === null)
      return false;
    win.__sigkAngleRowReady = true;
    el = {
      row,
      range: doc.getElementById('props-angle-range'),
      number: doc.getElementById('props-angle'),
      presets: [...doc.querySelectorAll('#props-angle-presets button')],
    };
    root.SigK.propsRange.bind(el.range, el.number, {
      min: 0, max: 359, onPreview: previewAngle, onCommit: setAngle, onCancel: () => root.SigK.annotatePreview.cancel(), clamp: angleOfText, targetOf: targetKey,
    });
    for (const button of el.presets)
      button.addEventListener('click', () => setAngle(Number(button.dataset.angle)));
    return true;
  }

  const SigK = (root.SigK = root.SigK || {});
  SigK.annotationAngleRow = { PRESETS, init, render, previewAngle, setAngle, angleOfText };
})(typeof window !== 'undefined' ? window : globalThis);
