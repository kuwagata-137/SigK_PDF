'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 右パネルの「回転」の行（spec-4b-2 確定事項25〜27）。四角・丸を選んでいるときだけ出し、スライダーは下見、確定で 1 世代。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: {} }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

// 図形の道具で pt の 2 点を描いて選ぶ（kind は道具の段の種類）。
function draw(shell, kind, from, to) {
  const { SigK, document, window } = shell;
  SigK.annotate.setTool(kind === 'ink' ? 'pen' : 'shape');
  if (kind !== 'ink')
    SigK.annotate.setShapeKind(kind);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const fire = (type, target, point) => {
    const [x, y] = viewport.convertToViewportPoint(point[0], point[1]);
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
  fire('mousedown', page, from);
  fire('mousemove', document.body, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  fire('mousemove', document.body, to);
  fire('mouseup', page, to);
  SigK.annotate.setTool(null);
  return SigK.viewer.getAnnotations().added.at(-1);
}

function rowOf(document) {
  return {
    row: document.getElementById('props-angle-row'),
    range: document.getElementById('props-angle-range'),
    number: document.getElementById('props-angle'),
    presets: [...document.querySelectorAll('#props-angle-presets button')],
  };
}

function current(shell) {
  return shell.SigK.viewer.getAnnotations().added.at(-1);
}

test('回転の行は四角・丸を選んでいるときだけ出し、今の角度と同じボタンに印を付ける', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const row = rowOf(document);
  assert.equal(row.row.hidden, true, '何も選んでいなければ出さない');
  draw(shell, 'square', [100, 700], [300, 600]);
  assert.equal(row.row.hidden, false);
  assert.equal(row.number.value, '0');
  assert.deepEqual(row.presets.map((button) => button.classList.contains('on')), [true, false, false, false]);
  draw(shell, 'line', [100, 500], [300, 450]);
  assert.equal(row.row.hidden, true, '直線は端で向きを変えるので出さない');
  draw(shell, 'ink', [100, 300], [200, 320]);
  assert.equal(row.row.hidden, true);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('circle');
  SigK.annotate.select(null);
  assert.equal(row.row.hidden, true, '次に描く図形は 0° なので、道具だけでは出さない');
});

test('数値欄は Enter で確定して 1 世代積み、範囲の外は 360 の余り、同じ角度なら積まない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK, window } = shell;
  const entry = draw(shell, 'square', [100, 700], [300, 600]);
  const row = rowOf(document);
  const enter = (text) => {
    row.number.value = text;
    row.number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  enter('45');
  assert.equal(current(shell).angle, 45);
  assert.equal(current(shell).id, entry.id);
  assert.equal(row.number.value, '45');
  enter('-30');
  assert.equal(current(shell).angle, 330);
  enter('370');
  assert.equal(current(shell).angle, 10);
  enter('29.6');
  assert.equal(current(shell).angle, 30);
  // 同じ角度は積まない: 1 回戻すと 10° に戻る
  enter('30');
  SigK.pageEdit.undo();
  assert.equal(current(shell).angle, 10);
  // 読めない値は元に戻すだけ
  enter('abc');
  assert.equal(row.number.value, '10');
});

test('スライダーを動かしている間は下見、離すと 1 世代。ボタンは押したら 1 世代', async (t) => {
  const shell = await withShell(t);
  const { document, SigK, window } = shell;
  const entry = draw(shell, 'circle', [100, 700], [300, 600]);
  const row = rowOf(document);
  row.range.value = '60';
  row.range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), true);
  assert.equal(current(shell).angle, undefined, '下見の間は書き込みを変えない');
  const group = document.querySelector(`.annot-layer g[data-annot="${entry.id}"] g.shape`);
  assert.match(group.getAttribute('transform'), /^rotate\(60 /);
  row.range.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(SigK.annotatePreview.isActive(), false);
  assert.equal(current(shell).angle, 60);
  row.presets[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(current(shell).angle, 90);
  row.presets[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal('angle' in current(shell), false, '0° は角度を持たない');
  // Ctrl+Z 1 回ずつで 90° → 60° に戻る
  SigK.pageEdit.undo();
  assert.equal(current(shell).angle, 90);
  SigK.pageEdit.undo();
  assert.equal(current(shell).angle, 60);
});

test('回転の数値欄に打ちかけのまま別の四角を選ぶと、欄はその四角の角度に替わり、打ちかけの値は当たらない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK, window } = shell;
  const first = draw(shell, 'square', [100, 700], [300, 600]).id;
  const second = draw(shell, 'square', [100, 500], [300, 400]).id;
  const row = rowOf(document);
  row.presets[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const angles = () => [...SigK.viewer.getAnnotations().added].map((entry) => entry.angle ?? 0);
  assert.deepEqual(angles(), [0, 90]);
  SigK.annotate.select(first);
  row.number.focus();
  row.number.value = '45';
  SigK.annotate.select(second);
  assert.equal(row.number.value, '90', '選び直した四角の角度に替わる');
  row.number.dispatchEvent(new window.Event('change'));
  assert.deepEqual(angles(), [0, 90]);
  // 選び直した後に打った値は、その四角に当たる。
  row.number.value = '30';
  row.number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.deepEqual(angles(), [0, 30]);
});

test('angleOfText は小数を四捨五入し、範囲の外を 360 の余りにする。読めなければ null', async (t) => {
  const shell = await withShell(t);
  const row = shell.SigK.annotationAngleRow;
  assert.equal(row.angleOfText('45'), 45);
  assert.equal(row.angleOfText(' -30 '), 330);
  assert.equal(row.angleOfText('720'), 0);
  assert.equal(row.angleOfText('359.6'), 0);
  assert.equal(row.angleOfText(''), null);
  assert.equal(row.angleOfText('x'), null);
});
