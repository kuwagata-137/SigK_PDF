'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 色・塗り・線なし・線種の指揮（spec-4b-1b 確定事項2〜5・16〜18・22〜25・28）。選んでいる書き込みに当てて 1 世代積むか、
// 次に付ける値として覚える。右パネルの行とパレットの窓は annotation-style-rows.test.js・color-popover.test.js が見る。

const A = 'C:\\work\\a.pdf';

// 他のアプリの四角（線 2pt・青）。
const IMPORTED = {
  0: [{ id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 2 }, opacity: 1 }],
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withShell(t, options = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

// pt の 2 点をドラッグして図形を描く。
function drag(shell, from, to) {
  const page = pageNode(shell);
  const viewport = shell.SigK.viewer.getTextLayer(0).viewport;
  const fire = (type, target, [x, y]) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const [start, end] = [from, to].map((point) => viewport.convertToViewportPoint(point[0], point[1]));
  fire('mousedown', page, start);
  fire('mousemove', shell.document.body, end);
  fire('mouseup', page, end);
}

function shapeTool(shell, kind) {
  shell.SigK.annotate.setTool('shape');
  shell.SigK.annotate.setShapeKind(kind);
}

test('四角の道具で塗り・線なし・線種を選ぶと次に描く四角に付き、道具ごとに覚える', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  shapeTool(shell, 'square');
  assert.deepEqual(plain(SigK.annotate.nextStyleOf('square')), { color: '#c00000', fill: null, lineStyle: 'solid' });
  // 塗りなしのまま線なしにはできない（線と塗りを両方なしにはできない。確定事項4）。
  assert.equal(SigK.annotate.setStrokeNone(), false);
  assert.equal(SigK.annotate.setFill('#FFFF00'), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotFills: { shape: '#ffff00' } });
  assert.equal(SigK.annotate.setStrokeNone(), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotStrokeNone: { shape: true } });
  assert.equal(SigK.annotate.setFill(null), false, '線なしのまま塗りなしにはできない');
  assert.equal(SigK.annotate.setLineStyle('cloudy'), true);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotLineStyles: { shape: 'cloudy' } });
  assert.equal(SigK.pageEdit.canUndo(), false, '次に付ける値は編集ではない');

  drag(shell, [100, 700], [300, 600]);
  const drawn = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([drawn.kind, drawn.color, drawn.fill, drawn.lineStyle, drawn.cloudIntensity], ['square', null, '#ffff00', 'cloudy', 1]);
  // 色を選ぶと線が戻る（線なしの印を外す）。
  SigK.annotate.select(null);
  assert.equal(SigK.annotate.setColor('#4472c4'), true);
  assert.deepEqual(plain(SigK.annotate.nextStyleOf('square')), { color: '#4472c4', fill: '#ffff00', lineStyle: 'cloudy' });
  assert.deepEqual(plain(shell.uiCalls.slice(-2)), [{ annotColors: { shape: '#4472c4' } }, { annotStrokeNone: { shape: false } }]);
  // 塗りを外すと線なしの印も外れる。
  assert.equal(SigK.annotate.setFill(null), true);
  assert.equal(SigK.annotate.fillOf('square'), null);
});

test('直線・矢印の道具は塗りと雲形を持たず、覚えた雲形は実線として描く', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotFills: { shape: '#ffff00' }, annotLineStyles: { shape: 'cloudy' } } });
  const { SigK } = shell;
  await shell.flush();
  shapeTool(shell, 'arrow');
  assert.deepEqual(plain(SigK.annotate.nextStyleOf('arrow')), { color: '#c00000', fill: null, lineStyle: 'solid' });
  assert.equal(SigK.annotate.setFill('#ffff00'), false);
  assert.equal(SigK.annotate.setStrokeNone(), false);
  assert.equal(SigK.annotate.setLineStyle('cloudy'), false);
  assert.equal(SigK.annotate.setLineStyle('dashed'), true);
  drag(shell, [100, 500], [300, 450]);
  const arrow = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([arrow.kind, arrow.lineStyle, 'fill' in arrow, 'dash' in arrow], ['arrow', 'dashed', false, false]);
  // ペンは実線だけで、線種を覚え直さない（描いた矢印を選んだままだと、その矢印への指示になるので外す）。
  SigK.annotate.select(null);
  SigK.annotate.setTool('pen');
  assert.equal(SigK.annotate.setLineStyle('dashed'), false);
  assert.equal(SigK.annotate.setLineStyle('solid'), true);
  assert.equal(SigK.annotate.lineStyleOf('square'), 'dashed');
});

test('覚えた塗り・線なし・線種は起動時に戻り、範囲の外は捨てる', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotFills: { shape: '#FFD966' }, annotStrokeNone: { shape: true }, annotLineStyles: { shape: 'wavy' } } });
  await shell.flush();
  const { SigK } = shell;
  assert.deepEqual(plain(SigK.annotate.nextStyleOf('circle')), { color: null, fill: '#ffd966', lineStyle: 'solid' });
});

test('選んでいる四角の塗り・線なし・線種は 1 世代で変わり、線と塗りを両方なしにはできない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  shapeTool(shell, 'square');
  drag(shell, [100, 700], [300, 600]);
  const id = SigK.annotate.getSelected();
  assert.equal(SigK.annotate.setStrokeNone(), false, '塗りが無ければ線なしにできない');
  assert.equal(SigK.annotate.setFill('#ffff00'), true);
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).fill, '#ffff00');
  assert.equal(SigK.annotate.setStrokeNone(), true);
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).color, null);
  assert.equal(SigK.annotate.setFill(null), false);
  assert.equal(SigK.annotate.setLineStyle('dashed'), true);
  const entry = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([entry.color, entry.fill, entry.lineStyle], [null, '#ffff00', 'dashed']);
  assert.equal(SigK.annotate.getSelected(), id);
  // 同じ値なら積まない。
  const generation = SigK.viewer.getAnnotations();
  assert.equal(SigK.annotate.setLineStyle('dashed'), true);
  assert.equal(SigK.annotationState.sameAnnots(generation, SigK.viewer.getAnnotations()), true);
  // 1 つずつ戻る。
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).lineStyle ?? 'solid', 'solid');
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).color, '#c00000');
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).fill ?? null, null);
});

test('読み込んだ四角に塗りを付けると写しに変わり、選択は写しへ移る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.select('30R');
  assert.equal(SigK.annotate.setFill('#a9ce91'), true);
  const annots = SigK.viewer.getAnnotations();
  assert.deepEqual(plain(annots.removed), ['30R']);
  assert.equal(annots.added.at(-1).fill, '#a9ce91');
  assert.equal(SigK.annotate.getSelected(), annots.added.at(-1).id);
  // 次に付ける値にもなる（道具ごとに最後の値を覚える。決定33 ⑥）。
  assert.equal(SigK.annotate.fillOf('square'), '#a9ce91');
});
