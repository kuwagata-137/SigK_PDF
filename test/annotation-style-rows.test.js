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

const ROWS = ['props-color-row', 'props-size-row', 'props-format-row', 'props-fill-row', 'props-style-row', 'props-border-row', 'props-width-row', 'props-opacity-row'];

// 出ている行の名前（ROWS の順）。
function shownRows(document) {
  return ROWS.filter((id) => !document.getElementById(id).hidden).map((id) => id.replace(/^props-|-row$/g, ''));
}

function shownStyles(document) {
  return [...document.querySelectorAll('#props-style button:not([hidden])')].map((button) => button.dataset.style);
}

// 四角の道具で pt の 2 点を描いて選ぶ。
function drawSquare(shell, from, to) {
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const fire = (type, target, point) => {
    const [x, y] = viewport.convertToViewportPoint(point[0], point[1]);
    target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
  fire('mousedown', page, from);
  fire('mousemove', document.body, to);
  fire('mouseup', page, to);
  SigK.annotate.setTool(null);
  return SigK.viewer.getAnnotations().added.at(-1);
}

// 描いた書き込みの値（描いた順）。
function addedValues(SigK, field, fallback) {
  return [...SigK.viewer.getAnnotations().added].map((entry) => entry[field] ?? fallback);
}

test('行の並びは 種類 → トリミングの当てるページと大きさ → モザイクの粗さと数 → 色 → 文字の大きさ → 書式 → 塗り → 線種 → 枠線 → 線の太さ → 不透明度 → 回転 → 本文 → 作成者 → ページ', async (t) => {
  const shell = await withShell(t);
  const ids = [...shell.document.querySelectorAll('#props .props-body > .prop')].map((node) => node.id || 'kind');
  // 回転の行は不透明度の下（spec-4b-2 確定事項25）。文字の大きさは色の直後（spec-4b-4a 確定事項G1。960×600 でも見えるように）
  // トリミングの 2 行は種類の直後（spec-4b-6a 確定事項17。道具を持っている間だけ出す）。モザイクの 2 行はその次（spec-4b-6b 確定事項14）。
  assert.deepEqual(ids, ['kind', 'props-trim-scope-row', 'props-trim-size-row', 'props-mosaic-block-row', 'props-mosaic-count-row', 'props-color-row', 'props-size-row', 'props-format-row', 'props-fill-row', 'props-style-row', 'props-border-row', 'props-width-row',
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
  // テキストは塗りと枠線の行も出し、太さの行は枠線があるときだけ（spec-4b-4a 確定事項G1）。
  assert.deepEqual(shownRows(document), ['color', 'size', 'format', 'fill', 'border', 'opacity']);
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
  assert.equal(hint(), `${HINTS.shape}${HINTS.lineSnap}`);
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

// 数値欄に打ちかけのまま紙の上の別の書き込みを押すと、欄はフォーカスを保ったまま選び直される（annotate-grab.js の
// begin が mousedown を preventDefault する）。そのあとの確定（Enter か欄の外）が別の書き込みに当たってはいけない。

test('太さの数値欄に打ちかけのまま別の書き込みを選ぶと、欄はその書き込みの値に替わり、打ちかけの値は当たらない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const first = drawSquare(shell, [100, 700], [200, 600]).id;
  const second = drawSquare(shell, [300, 700], [400, 600]).id;
  SigK.annotate.setLineWidth(6);
  SigK.annotate.select(first);
  const number = document.getElementById('props-width');
  number.focus();
  number.value = '20';
  SigK.annotate.select(second);
  assert.equal(number.value, '6', '選び直した書き込みの値に替わる');
  number.dispatchEvent(new window.Event('change'));
  assert.deepEqual(addedValues(SigK, 'lineWidth'), [2, 6]);
  // 選び直した後に打った値は、その書き込みに当たる。
  number.value = '24';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(addedValues(SigK, 'lineWidth'), [2, 24]);
});

test('不透明度の数値欄に打ちかけのまま別の書き込みを選ぶと、欄はその書き込みの値に替わり、打ちかけの値は当たらない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const first = drawSquare(shell, [100, 700], [200, 600]).id;
  const second = drawSquare(shell, [300, 700], [400, 600]).id;
  SigK.annotate.setOpacity(0.5);
  SigK.annotate.select(first);
  const number = document.getElementById('props-opacity');
  number.focus();
  number.value = '20';
  SigK.annotate.select(second);
  assert.equal(number.value, '50', '選び直した書き込みの値に替わる');
  number.dispatchEvent(new window.Event('change'));
  assert.deepEqual(addedValues(SigK, 'opacity', 1), [1, 0.5]);
  number.value = '80';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(addedValues(SigK, 'opacity', 1), [1, 0.8]);
});

test('太さの数値欄に打ちかけのまま太さの違う書き込みを足して選ぶと、欄は空で「–」になり、打ちかけの値はどちらにも当たらない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document, window } = shell;
  const first = drawSquare(shell, [100, 700], [200, 600]).id;
  const second = drawSquare(shell, [300, 700], [400, 600]).id;
  SigK.annotate.setLineWidth(6);
  SigK.annotate.select(first);
  const number = document.getElementById('props-width');
  number.focus();
  number.value = '20';
  SigK.annotate.toggleKey(second);
  assert.deepEqual([number.value, number.placeholder], ['', '–']);
  number.dispatchEvent(new window.Event('change'));
  assert.deepEqual(addedValues(SigK, 'lineWidth'), [2, 6]);
});
