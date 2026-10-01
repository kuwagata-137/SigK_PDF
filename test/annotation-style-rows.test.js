'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 右パネルの見た目の行（spec-4b-1b 確定事項1〜9。モック screenshots/phase4b-style*.png）。色・塗り・線種・線の太さ・
// 不透明度の行を、道具（次に付ける値）か選んでいる書き込みに合わせて出し入れする。

const A = 'C:\\work\\a.pdf';

const IMPORTED = {
  0: [{ id: '17R', subtype: 'Line', rect: [48, 198, 252, 302], color: new Uint8ClampedArray([0, 0, 0]), borderStyle: { width: 2 }, lineCoordinates: [50, 200, 250, 300], lineEndings: ['None', 'None'] }],
};

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

const ROWS = ['props-color-row', 'props-fill-row', 'props-style-row', 'props-width-row', 'props-size-row', 'props-opacity-row'];

// 出ている行の名前（ROWS の順）。
function shownRows(document) {
  return ROWS.filter((id) => !document.getElementById(id).hidden).map((id) => id.replace(/^props-|-row$/g, ''));
}

function shownStyles(document) {
  return [...document.querySelectorAll('#props-style button:not([hidden])')].map((button) => button.dataset.style);
}

test('行の並びは 種類 → 色 → 塗り → 線種 → 線の太さ・文字の大きさ → 不透明度 → 回転 → 本文 → 作成者 → ページ', async (t) => {
  const shell = await withShell(t);
  const ids = [...shell.document.querySelectorAll('#props .props-body > .prop')].map((node) => node.id || 'kind');
  // 回転の行は不透明度の下（spec-4b-2 確定事項25）
  assert.deepEqual(ids, ['kind', 'props-color-row', 'props-fill-row', 'props-style-row', 'props-width-row', 'props-size-row',
    'props-opacity-row', 'props-angle-row', 'props-contents-row', 'props-author-row', 'props-page-row', 'props-text-row']);
});

test('道具ごとに出す行と、色の行の見出しが替わる', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const label = () => document.getElementById('props-color-label').textContent;
  assert.deepEqual(shownRows(document), [], '道具も選択も無ければ出さない');
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  assert.deepEqual(shownRows(document), ['color', 'fill', 'style', 'width', 'opacity']);
  assert.equal(label(), '線の色');
  assert.deepEqual(shownStyles(document), ['solid', 'dashed', 'cloudy']);
  assert.equal(document.getElementById('props-fill-name').textContent, 'なし');
  assert.equal(document.querySelector('#props-fill .sw').classList.contains('none'), true, '「なし」は白地に斜線');
  assert.equal(document.getElementById('props-color').getAttribute('aria-label'), '線の色 #C00000');
  SigK.annotate.setShapeKind('line');
  assert.deepEqual(shownRows(document), ['color', 'style', 'width', 'opacity']);
  assert.deepEqual(shownStyles(document), ['solid', 'dashed']);
  SigK.annotate.setTool('pen');
  assert.deepEqual(shownRows(document), ['color', 'width', 'opacity']);
  SigK.annotate.setTool('text');
  assert.deepEqual(shownRows(document), ['color', 'size', 'opacity']);
  assert.equal(label(), '文字の色');
  SigK.annotate.setTool('note');
  assert.deepEqual(shownRows(document), ['color', 'opacity']);
  assert.equal(label(), '色');
  SigK.annotate.setTool('underline');
  assert.deepEqual(shownRows(document), ['color']);
  SigK.annotate.setTool(null);
  assert.deepEqual(shownRows(document), []);
});

test('線種のボタンで次に付ける線種を選び、押している印を付ける', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('circle');
  const button = (lineStyle) => document.querySelector(`#props-style button[data-style="${lineStyle}"]`);
  assert.deepEqual([button('solid').getAttribute('aria-pressed'), button('solid').title], ['true', '実線']);
  button('cloudy').dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.annotate.lineStyleOf('circle'), 'cloudy');
  assert.equal(button('cloudy').classList.contains('on'), true);
  assert.equal(button('solid').getAttribute('aria-pressed'), 'false');
  // 直線では雲形を実線として示す（確定事項25）。
  SigK.annotate.setShapeKind('line');
  assert.equal(button('solid').classList.contains('on'), true);
  assert.equal(button('cloudy').hidden, true);
  // 絵はアイコンの流儀（24 の格子）。
  assert.equal(button('dashed').querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
});

test('四角・丸のヒントに「両方なしにはできない」を添え、塗りがあれば「文字は取り出せる」も添える', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const hint = () => document.getElementById('props-hint').textContent;
  const { HINTS } = SigK.annotationProps;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  assert.equal(hint(), `${HINTS.shape}${HINTS.box}`);
  SigK.annotate.setFill('#ffff00');
  assert.equal(hint(), `${HINTS.shape}${HINTS.box}${HINTS.fill}`);
  SigK.annotate.setShapeKind('arrow');
  assert.equal(hint(), HINTS.shape);
  SigK.annotate.setTool('pen');
  assert.equal(hint(), HINTS.pen);
});

test('選んでいる線なしの四角は色のチップが「なし」になり、表示のみの書き込みには見た目の行を出さない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  SigK.annotate.setFill('#ffff00');
  SigK.annotate.setStrokeNone();
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const fire = (type, target, point) => {
    const [x, y] = viewport.convertToViewportPoint(point[0], point[1]);
    target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
  fire('mousedown', page, [100, 700]);
  fire('mousemove', document.body, [300, 600]);
  fire('mouseup', page, [300, 600]);
  assert.equal(document.getElementById('props-kind').textContent, '四角');
  assert.equal(document.getElementById('props-color-name').textContent, 'なし');
  assert.equal(document.querySelector('#props-color .sw').classList.contains('none'), true);
  assert.equal(document.getElementById('props-fill-name').textContent, '#FFFF00');
  const HINTS = SigK.annotationProps.HINTS;
  assert.equal(document.getElementById('props-hint').textContent, `${HINTS.shapeSelected.replace(HINTS.move, `${HINTS.move}${HINTS.boxTransform}`)}${HINTS.box}${HINTS.fill}`);
  SigK.annotate.select('17R');
  assert.equal(document.getElementById('props-kind').textContent, '直線（表示のみ）');
  assert.deepEqual(shownRows(document), []);
});
