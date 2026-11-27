'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// マーキングの配置・番号・次に配置する値の記憶（spec-7-9 確定事項F1・F3・F5）。形と描画は marking-rules.test.js・marking-graphics.test.js、
// ハンドルと行は marking-props.test.js、保存と読み戻しは marking-roundtrip.test.js が見る。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function withShell(t, { ui = null } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: {} }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) },
    ...(ui === null ? {} : { ui }),
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

// pt の点をクリックする。
function click(shell, point) {
  const at = px(shell, point);
  mouse(shell, 'mousedown', pageNode(shell), at);
  mouse(shell, 'mouseup', pageNode(shell), at);
  mouse(shell, 'click', pageNode(shell), at);
}

function added(shell) {
  return shell.SigK.viewer.getAnnotations().added;
}

const center = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];

test('編集ツールバーの多角形の右に［マーキング］があり、押すとマーキングの書き込みツールを選択する', async (t) => {
  const shell = await withShell(t);
  const { document, SigK } = shell;
  const button = document.querySelector('#edit-bar .edit-tool[data-tool="marking"]');
  assert.equal(button.closest('.edit-item').previousElementSibling.querySelector('[data-shape]').dataset.shape, 'polygon');
  assert.equal(button.querySelector('svg') !== null, true);
  button.click();
  assert.equal(SigK.annotate.getTool(), 'marking');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(document.documentElement.getAttribute('data-tool'), 'marking');
  assert.equal(document.getElementById('props-kind').textContent, 'マーキング（次に追加する書き込み）');
});

test('ページをクリックすると、クリックした位置を中心に既定の点付き丸を配置して選択する。Ctrl+Z で元に戻る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  click(shell, [200, 600]);
  assert.equal(added(shell).length, 1);
  const entry = added(shell)[0];
  assert.equal(entry.kind, 'marking');
  assert.deepEqual(plain(entry.marking), { shape: 'target', outer: 100, dot: 15, ring: 50, cross: 150, fontSize: 50 });
  assert.deepEqual([entry.color, entry.opacity, entry.lineWidth], ['#ff0000', 1, 3]);
  const [cx, cy] = center(entry.rect);
  assert.ok(Math.abs(cx - 200) < 0.6 && Math.abs(cy - 600) < 0.6, `中心 ${cx},${cy}`);
  assert.equal(entry.rect[2] - entry.rect[0], 100);
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.annotate.getTool(), 'marking', '書き込みツールは選択したまま');
  assert.ok(shell.document.querySelector('.annot-layer g[data-kind="marking"] g.marking.target') !== null);
  SigK.pageEdit.undo();
  assert.equal(added(shell).length, 0);
});

test('既存の書き込みの上をクリックすると、配置せずにその書き込みを選択する', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  click(shell, [200, 600]);
  const first = added(shell)[0];
  SigK.annotate.select(null);
  click(shell, [205, 603]);
  assert.equal(added(shell).length, 1);
  assert.equal(SigK.annotate.getSelected(), first.id);
});

test('選択中に何も無い所をクリックすると、選択の解除だけを行い配置しない。もう一度クリックすると配置する（決定102 ⑧）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  click(shell, [200, 600]);
  assert.equal(added(shell).length, 1);
  assert.equal(SigK.annotate.getSelected(), added(shell)[0].id);
  click(shell, [400, 600]);
  assert.equal(added(shell).length, 1, '配置しない');
  assert.equal(SigK.annotate.getSelected(), null, '選択を解除する');
  click(shell, [400, 600]);
  assert.equal(added(shell).length, 2);
  assert.equal(SigK.annotate.getSelected(), added(shell)[1].id);
  // ほかの書き込みを選択している時も同じ。
  SigK.annotate.select(added(shell)[0].id);
  click(shell, [300, 400]);
  assert.equal(added(shell).length, 2);
  assert.equal(SigK.annotate.getSelected(), null);
});

test('番号付き丸は、配置するたびに文書の中の最大の番号＋1 になる。削除しても詰めず、取り消すと元の番号に戻る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  assert.equal(SigK.annotateMarking.setShape('number'), true);
  // 配置した番号付き丸は選択されるので、次のクリックの前に選択を解除する（決定102 ⑧）。
  const place = (point) => {
    SigK.annotate.select(null);
    click(shell, point);
  };
  place([100, 700]);
  place([200, 700]);
  place([300, 700]);
  assert.deepEqual(plain(added(shell).map((entry) => entry.marking.number)), [1, 2, 3]);
  // 2 を削除しても、次は 4。
  SigK.annotate.select(added(shell)[1].id);
  SigK.annotate.remove();
  place([400, 700]);
  assert.deepEqual(plain(added(shell).map((entry) => entry.marking.number)), [1, 3, 4]);
  SigK.pageEdit.undo();
  SigK.pageEdit.undo();
  assert.equal(SigK.annotateMarking.nextNumber(), 4, '取り消して 1・2・3 に戻った');
});

test('次に配置する形・大きさ・線の太さ・色・透明度を記憶し、起動時に戻す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  SigK.annotateMarking.setShape('double');
  assert.equal(SigK.annotateMarking.setSize('ring', 20), true);
  assert.equal(SigK.annotateMarking.setSize('ring', 120), false, '中の円は外の円より大きくしない');
  SigK.annotate.setLineWidth(5);
  SigK.annotate.setOpacity(0.5);
  SigK.annotate.setColor('#0070c0');
  const saved = shell.uiCalls.reduce((memo, patch) => ({ ...memo, ...(patch.annotMarking ?? {}) }), {});
  assert.deepEqual(saved, { shape: 'double', outer: 100, dot: 15, ring: 20, cross: 150, fontSize: 50, lineWidth: 5 });
  assert.equal(shell.uiCalls.some((patch) => patch.annotOpacity?.marking === 0.5), true);
  assert.equal(shell.uiCalls.some((patch) => patch.annotColors?.marking === '#0070c0'), true);
  assert.equal(SigK.annotate.getLineWidth('square'), 2, '図形の線の太さは変わらない');
  click(shell, [200, 600]);
  const entry = added(shell)[0];
  assert.deepEqual([entry.marking.shape, entry.marking.ring, entry.lineWidth, entry.opacity, entry.color], ['double', 20, 5, 0.5, '#0070c0']);
});

test('起動時に settings.json の annotMarking から戻す', async (t) => {
  const ui = { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotMarking: { shape: 'caution', outer: 48, lineWidth: 6 } };
  const shell = await withShell(t, { ui });
  await shell.flush();
  assert.equal(shell.SigK.annotateMarking.getNext().shape, 'caution');
  assert.equal(shell.SigK.annotateMarking.getNext().outer, 48);
  assert.equal(shell.SigK.annotate.getLineWidth('marking'), 6);
});

// pt の点から点へドラッグする（extra は Ctrl など）。
function drag(shell, from, to, extra = {}) {
  const [a, b] = [px(shell, from), px(shell, to)];
  mouse(shell, 'mousedown', pageNode(shell), a, extra);
  mouse(shell, 'mousemove', shell.document.body, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], extra);
  mouse(shell, 'mousemove', shell.document.body, b, extra);
  mouse(shell, 'mouseup', pageNode(shell), b, extra);
}

test('何も無い所からドラッグすると、押した点と離した点を対角とする正方形に外接する外の円で描き、ドラッグ中は下書きを表示する（決定102 ⑦）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('marking');
  const [a, b] = [px(shell, [100, 700]), px(shell, [180, 640])];
  mouse(shell, 'mousedown', pageNode(shell), a);
  mouse(shell, 'mousemove', document.body, b);
  const draft = SigK.annotateShape.draftFor(0);
  assert.equal(draft.kind, 'marking');
  assert.equal(draft.marking.outer, 80, '|dx| 80pt と |dy| 60pt の大きい方');
  assert.ok(pageNode(shell).querySelector('.annot-draft g.marking.target') !== null, '下書きを描く');
  assert.equal(added(shell).length, 0);
  mouse(shell, 'mouseup', pageNode(shell), b);
  assert.equal(added(shell).length, 1);
  const entry = added(shell)[0];
  assert.equal(entry.marking.outer, 80);
  // 中の円・十字線・文字サイズも外の円と同じ比（80/100）で変える（質問 MK3 案A）。
  assert.deepEqual([entry.marking.dot, entry.marking.cross, entry.marking.ring, entry.marking.fontSize], [12, 120, 40, 40]);
  assert.deepEqual(plain(center(entry.rect)), [140, 660], '中心は正方形の中心（引いた向きへ伸ばす）');
  assert.equal(SigK.annotate.getSelected(), entry.id);
  assert.equal(SigK.annotateShape.draftFor(0), null);
  SigK.pageEdit.undo();
  assert.equal(added(shell).length, 0);
});

test('ドラッグで描く時も、外の円は 4〜720pt の範囲で止め、番号付き丸は次の番号を付ける。選択中でもドラッグなら描く', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  SigK.annotateMarking.setShape('number');
  click(shell, [300, 300]);
  assert.equal(SigK.annotate.getSelected(), added(shell)[0].id);
  drag(shell, [100, 700], [101.5, 690]);
  assert.equal(added(shell).length, 2, '選択中でもドラッグなら描く');
  assert.deepEqual([added(shell)[1].marking.outer, added(shell)[1].marking.number], [10, 2]);
  drag(shell, [200, 200], [203.5, 200]);
  assert.equal(added(shell)[2].marking.outer, 4, '外の円は 4pt で止める');
  SigK.annotate.select(null);
  drag(shell, [50, 800], [51, 799.5]);
  assert.equal(added(shell).length, 4, '3px 以内の動きはクリックとして、既定の大きさで配置する');
  assert.equal(added(shell)[3].marking.outer, 100);
});

test('ドラッグの途中で Esc を押すと、描かずにやめる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('marking');
  mouse(shell, 'mousedown', pageNode(shell), px(shell, [100, 700]));
  mouse(shell, 'mousemove', document.body, px(shell, [200, 600]));
  assert.notEqual(SigK.annotateShape.draftFor(0), null);
  SigK.annotate.escape();
  assert.equal(SigK.annotateShape.draftFor(0), null);
  mouse(shell, 'mouseup', pageNode(shell), px(shell, [200, 600]));
  assert.equal(added(shell).length, 0);
});

test('マーキングはドラッグで移動し、Ctrl を押しながらドラッグするとコピーを作る（番号付き丸の番号は同じまま）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  SigK.annotateMarking.setShape('number');
  click(shell, [200, 600]);
  SigK.annotate.setTool(null);
  const before = added(shell)[0];
  drag(shell, [200, 600], [260, 560]);
  const moved = added(shell)[0];
  assert.equal(added(shell).length, 1);
  assert.deepEqual(plain(center(moved.rect)), [center(before.rect)[0] + 60, center(before.rect)[1] - 40]);
  assert.deepEqual(plain(moved.marking), plain(before.marking));
  drag(shell, [260, 560], [300, 500], { ctrlKey: true });
  assert.equal(added(shell).length, 2);
  assert.deepEqual(plain(added(shell).map((entry) => entry.marking.number)), [1, 1]);
});

test('複数選択では、色・線の太さ・透明度をまとめて変える', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  SigK.annotate.setTool('marking');
  click(shell, [100, 600]);
  SigK.annotate.select(null);
  click(shell, [200, 600]);
  SigK.annotate.setTool(null);
  SigK.annotate.selectKeys(added(shell).map((entry) => entry.id));
  assert.equal(SigK.annotate.getSelection().length, 2);
  assert.equal(shell.document.getElementById('props-marking-shape-row').hidden, true, '複数選択では形の行を隠す');
  SigK.annotate.setColor('#00b050');
  SigK.annotate.setLineWidth(6);
  SigK.annotate.setOpacity(0.4);
  assert.deepEqual(plain(added(shell).map((entry) => [entry.color, entry.lineWidth, entry.opacity])), [['#00b050', 6, 0.4], ['#00b050', 6, 0.4]]);
  assert.equal(SigK.annotate.getLineWidth('marking'), 6);
  assert.equal(SigK.annotate.getLineWidth('square'), 2);
});

test('ヒント・注釈一覧の名前とアイコン・ツールチップは、マーキングの文言', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('marking');
  const hint = () => document.getElementById('props-hint').textContent;
  assert.equal(hint(), SigK.annotationHints.HINTS.marking);
  click(shell, [200, 600]);
  assert.equal(hint(), SigK.annotationHints.HINTS.markingSelected);
  const entry = added(shell)[0];
  assert.equal(SigK.annotationIndex.labelOf(entry), 'マーキング');
  assert.equal(SigK.annotationIndex.iconOf(entry), 'marking');
  assert.ok(SigK.icons.has('marking'));
  assert.equal(SigK.tipContent.resolve(document.querySelector('.edit-tool[data-tool="marking"]')).name, 'マーキング');
});
