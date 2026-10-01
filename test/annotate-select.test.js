'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 選んでいる書き込みを鍵の並びで持つ（spec-4b-3a 確定事項A・E・K4・L）。並びの操作そのものは annotation-selection.test.js が見る。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra }));
}

// 1 ページ目に四角の道具で pt の 2 点の箱を描き、鍵を返す。
function drawSquare(shell, from, to) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  mouse(shell, 'mousedown', node, px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', node, px(to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

// 3 つの四角（1 ページ目）と、2 ページ目の四角 1 つ。
function drawSet(shell) {
  const { SigK } = shell;
  const a = drawSquare(shell, [100, 700], [200, 650]);
  const b = drawSquare(shell, [300, 700], [400, 650]);
  const c = drawSquare(shell, [100, 500], [200, 450]);
  const entry = SigK.viewer.getAnnotations().added.at(-1);
  const annots = SigK.annotationState.addAnnot(SigK.viewer.getAnnotations(), { ...entry, id: undefined, src: 1 });
  SigK.pageEdit.commitAnnots(annots);
  const x = SigK.viewer.getAnnotations().added.at(-1).id;
  return { a, b, c, x };
}

test('selectKeys は選んだ順で持ち、最後が主。getSelected は 1 件のときだけ鍵を返す（確定事項A1・A4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b } = drawSet(shell);
  assert.deepEqual([...SigK.annotate.selectKeys([a, b])], [a, b]);
  assert.equal(SigK.annotate.getSelected(), null);
  assert.equal(SigK.annotate.selectedEntry(), null);
  assert.equal(SigK.annotate.primaryKey(), b);
  assert.equal(SigK.annotate.primaryEntry().id, b);
  assert.equal(SigK.annotate.selectedEntries().length, 2);
  assert.equal(SigK.annotate.isSelected(a), true);
  assert.equal(SigK.annotate.select(a), a);
  assert.equal(SigK.annotate.getSelected(), a);
  assert.equal(SigK.annotate.select(null), null);
  assert.deepEqual([...SigK.annotate.getSelection()], []);
});

test('selectKeys は引けない鍵と、主と別のページの鍵を落とす（確定事項A2・A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b, x } = drawSet(shell);
  assert.deepEqual([...SigK.annotate.selectKeys([a, 'gone', b])], [a, b]);
  // 主（最後）が 2 ページ目なら、1 ページ目の鍵は落ちる。
  assert.deepEqual([...SigK.annotate.selectKeys([a, b, x])], [x]);
});

test('toggleKey は同じページなら足す・外す、別のページならその 1 件だけに替える（確定事項B3・K1）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b, c, x } = drawSet(shell);
  SigK.annotate.select(a);
  assert.deepEqual([...SigK.annotate.toggleKey(b)], [a, b]);
  assert.deepEqual([...SigK.annotate.toggleKey(c)], [a, b, c]);
  assert.deepEqual([...SigK.annotate.toggleKey(a)], [b, c]);
  assert.deepEqual([...SigK.annotate.toggleKey(x)], [x]);
});

test('addKey は選んでいなければ足し、選んでいれば何もしない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b } = drawSet(shell);
  SigK.annotate.selectKeys([a, b]);
  assert.deepEqual([...SigK.annotate.addKey(a)], [a, b], '選んでいるものは主にも動かさない');
  SigK.annotate.select(a);
  assert.deepEqual([...SigK.annotate.addKey(b)], [a, b]);
});

test('2 件以上を選ぶと、枠は 1 件ごとの組（data-frame-key）でつまみが無い。1 件ならつまみが出る（確定事項E）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { a, b, c } = drawSet(shell);
  SigK.annotate.selectKeys([a, b, c]);
  const layer = document.querySelector('.annot-frame-layer');
  const groups = [...layer.querySelectorAll('.annot-frame-group')];
  assert.deepEqual(groups.map((group) => group.getAttribute('data-frame-key')), [a, b, c]);
  assert.equal(layer.querySelectorAll('.annot-handle').length, 0);
  assert.equal(layer.querySelectorAll('.annot-frame').length, 3);
  assert.equal(SigK.annotationFrame.shown().key, null);
  assert.deepEqual([...SigK.annotationFrame.shown().keys], [a, b, c]);
  SigK.annotate.select(a);
  assert.equal(layer.querySelectorAll('.annot-frame-group').length, 1);
  assert.ok(layer.querySelectorAll('.annot-handle').length > 0, '1 件ならつまみが出る');
});

test('translate に鍵を渡すと、その鍵の組だけをずらす（確定事項E3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { a, b } = drawSet(shell);
  SigK.annotate.selectKeys([a, b]);
  SigK.annotationFrame.translate(10, 5, [b]);
  const style = (key) => document.querySelector(`.annot-frame-group[data-frame-key="${key}"]`).style.transform;
  assert.equal(style(a), '');
  assert.equal(style(b), 'translate(10px, 5px)');
  SigK.annotationFrame.translate(0, 0);
  assert.equal(style(b), '');
});

test('一覧は選んだ行を全部光らせる（確定事項K4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const { a, c } = drawSet(shell);
  if (SigK.shell.getEditSide() !== 'list')
    document.querySelector('#side-switch button[data-side="list"]').click();
  SigK.annotate.selectKeys([a, c]);
  const on = [...document.querySelectorAll('#annot-rows .annot-row.on')].map((row) => row.dataset.key);
  assert.deepEqual(on.sort(), [a, c].sort());
});

test('Delete で選んだ全部を消して 1 世代。Ctrl+Z で全部戻り、複数選択も戻る（確定事項H1・L）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b, c } = drawSet(shell);
  SigK.annotate.selectKeys([a, c]);
  const depth = SigK.pageEdit.getHistoryState().at;
  assert.equal(SigK.annotate.remove(), true);
  assert.equal(SigK.pageEdit.getHistoryState().at, depth + 1);
  const ids = () => SigK.viewer.getAnnotations().added.map((entry) => entry.id);
  assert.equal(ids().includes(a) || ids().includes(c), false);
  assert.ok(ids().includes(b));
  assert.deepEqual([...SigK.annotate.getSelection()], []);
  SigK.pageEdit.undo();
  assert.ok(ids().includes(a) && ids().includes(c));
  assert.deepEqual([...SigK.annotate.getSelection()], [a, c]);
  SigK.pageEdit.redo();
  assert.deepEqual([...SigK.annotate.getSelection()], []);
});

test('履歴は鍵の配列を写して積む（後から元の配列を変えても、世代は変わらない。確定事項L1）', async (t) => {
  const shell = await withShell(t);
  const { editHistory } = shell.SigK;
  const keys = ['a', 'b'];
  let history = editHistory.createHistory({ plan: [], annots: null });
  history = editHistory.pushHistory(history, { plan: [], annots: null }, { annot: { before: keys, after: 'a' } });
  keys.push('c');
  const undone = editHistory.undo(history);
  assert.deepEqual([...undone.annot], ['a', 'b']);
});

test('Esc は複数の選択を全部外し、もう一度で道具を離す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b } = drawSet(shell);
  SigK.annotate.setTool('pen');
  SigK.annotate.selectKeys([a, b]);
  assert.equal(SigK.annotate.escape(), true);
  assert.deepEqual([...SigK.annotate.getSelection()], []);
  assert.equal(SigK.annotate.getTool(), 'pen');
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotate.getTool(), null);
});

test('選んでいる書き込みが別の経路で消えたら、読むときに選択から落ちる（確定事項A3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const { a, b } = drawSet(shell);
  SigK.annotate.selectKeys([a, b]);
  const annots = SigK.annotationState.removeAnnot(SigK.viewer.getAnnotations(), SigK.annotationState.findAnnot(SigK.viewer.getAnnotations(), {}, b));
  SigK.pageEdit.commitAnnots(annots);
  assert.deepEqual([...SigK.annotate.getSelection()], [a]);
  assert.equal(SigK.annotate.getSelected(), a);
});
