'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 見出し「枠線」「塗り」と、塗りの見出しの行（塗りの透明度・ハッチング・ハッチング色・ハッチング間隔・ハッチング線幅。spec-7-9 確定事項B1〜B4・
// C1〜C3）と、それを当てる annotate-fill.js。

const A = 'C:\\work\\a.pdf';

async function withShell(t, ui = null) {
  const shell = await createShell({
    pdfjs: createPdfjsStub(),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    ...(ui === null ? {} : { ui }),
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

// 表示している行と見出し（パネルの上から順）。
function shownIds(document) {
  return [...document.querySelectorAll('#props .props-body > .prop, #props .props-body > .prop-head')]
    .filter((node) => !node.hidden && /^props-(stroke-head|fill-head|color-row|fill-row|style-row|width-row|opacity-row|fill-opacity-row|hatch|set-row)/.test(node.id))
    .map((node) => node.id.replace(/^props-|-row$/g, ''));
}

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

function change(shell, id, value) {
  const node = shell.document.getElementById(id);
  // 欄にフォーカスを置いて入力し、確定する（Enter か欄の外）。
  node.focus();
  node.value = String(value);
  node.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

test('四角の書き込みツールでは、見出し「枠線」「塗り」で分け、塗りつぶしの行を塗りの見出しのすぐ下に移す', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  assert.deepEqual(shownIds(document), ['set', 'stroke-head', 'color', 'style', 'width', 'opacity', 'fill-head', 'fill', 'fill-opacity', 'hatch']);
  assert.equal(document.querySelector('#props-fill-row .k').textContent, '塗りつぶし');
  assert.equal(document.getElementById('props-stroke-head').textContent, '枠線');
  assert.equal(document.getElementById('props-fill-head').textContent, '塗り');
  assert.equal(document.getElementById('props-hatch').value, 'none');
  // 直線では見出しを付けず、今の並び（透明度の行 1 つ）に戻す。
  SigK.annotate.setShapeKind('line');
  assert.deepEqual(shownIds(document), ['color', 'style', 'width', 'opacity']);
  assert.equal(document.getElementById('props-fill-row').previousElementSibling.id, 'props-format-row');
  // テキストは見出しを付けず、塗りつぶしの行は書式の次のまま。
  SigK.annotate.setTool('text');
  assert.equal(document.getElementById('props-stroke-head').hidden, true);
  assert.equal(document.getElementById('props-fill-row').hidden, false);
  assert.equal(document.getElementById('props-fill-row').previousElementSibling.id, 'props-format-row');
});

test('書き込みツールの塗りの透明度とハッチングは、次に追加する四角に付き、記憶する', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  shell.slide('props-fill-opacity-range', [40, 70]);
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotFillOpacity: { shape: 0.3 } });
  change(shell, 'props-hatch', 'cross');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotHatch: { shape: { pattern: 'cross' } } });
  assert.deepEqual(shownIds(document).slice(-4), ['hatch', 'hatch-color', 'hatch-gap', 'hatch-width']);
  change(shell, 'props-hatch-gap', 9);
  change(shell, 'props-hatch-width', 1.5);
  shell.pickColor('props-hatch-color', '#0070c0');
  assert.deepEqual(plain(shell.uiCalls.at(-1)), { annotHatch: { shape: { color: '#0070c0' } } });
  // 範囲の外は当てずに、今の値へ戻す。
  change(shell, 'props-hatch-gap', 80);
  assert.equal(document.getElementById('props-hatch-gap').value, '9');
  const entry = drawSquare(shell, [100, 600], [240, 680]);
  assert.equal(entry.fillOpacity, 0.3);
  assert.deepEqual(plain(entry.hatch), { pattern: 'cross', color: '#0070c0', gap: 9, width: 1.5 });
});

test('選択中の四角の塗りの透明度・ハッチングは 1 世代で変わり、枠線の透明度を変えても塗りは変わらない', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const entry = drawSquare(shell, [100, 600], [240, 680]);
  SigK.annotate.select(entry.id);
  assert.equal(document.getElementById('props-fill-head').hidden, false);
  change(shell, 'props-hatch', 'diagonal');
  const hatched = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual(plain(hatched.hatch), { pattern: 'diagonal', color: '#ff0000', gap: 6, width: 1 });
  shell.slide('props-fill-opacity-range', [50]);
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).fillOpacity, 0.5);
  // 枠線の透明度は opacity だけを変える。
  shell.slide('props-opacity-range', [20]);
  const after = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([after.opacity, after.fillOpacity], [0.8, 0.5]);
  assert.equal(document.getElementById('props-fill-opacity').value, '50');
  assert.equal(document.getElementById('props-opacity').value, '20');
  // 1 世代ずつ戻る。
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).opacity, 1);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).fillOpacity, undefined);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added.at(-1).hatch, undefined);
});

test('枠線の透明度だけを持つ今までの四角は、枠線の透明度を変えると塗りの透明度を今の値で残す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const entry = drawSquare(shell, [100, 600], [240, 680]);
  SigK.annotate.select(entry.id);
  SigK.annotate.setOpacity(0.6);
  const changed = SigK.viewer.getAnnotations().added.at(-1);
  assert.deepEqual([changed.opacity, changed.fillOpacity], [0.6, 1]);
});

test('2 件以上を選択していれば、塗りを持てる書き込みにだけ当てる', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const first = drawSquare(shell, [100, 600], [240, 680]);
  const second = drawSquare(shell, [300, 600], [400, 680]);
  SigK.annotate.selectKeys([first.id, second.id]);
  assert.equal(document.getElementById('props-fill-head').hidden, false);
  change(shell, 'props-hatch', 'grid');
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added.map((each) => each.hatch?.pattern)), ['grid', 'grid']);
  change(shell, 'props-hatch-width', 3);
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added.map((each) => each.hatch.width)), [3, 3]);
  SigK.pageEdit.undo();
  assert.deepEqual(plain(SigK.viewer.getAnnotations().added.map((each) => each.hatch.width)), [1, 1]);
  // そろっていない値は「混在」。
  SigK.annotate.select(first.id);
  change(shell, 'props-hatch', 'none');
  SigK.annotate.selectKeys([first.id, second.id]);
  assert.equal(document.getElementById('props-hatch').value, '');
});

test('起動時に記憶した塗りの透明度とハッチングを戻し、範囲の外は捨てる', async (t) => {
  const shell = await withShell(t, {
    mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 },
    annotFillOpacity: { shape: 0.4 }, annotHatch: { shape: { pattern: 'vertical', color: '#00B050', gap: 90, width: 2 } },
  });
  const look = plain(shell.SigK.annotate.nextStyleOf('circle'));
  assert.equal(look.fillOpacity, 0.4);
  assert.deepEqual(look.hatch, { pattern: 'vertical', color: '#00b050', gap: 6, width: 2 });
  assert.equal(shell.SigK.annotate.nextStyleOf('line').hatch, undefined);
});
