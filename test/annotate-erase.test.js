'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 消しゴムの道具の押し離し（spec-4b-5b 確定事項18〜24・31。決定62）。切り方・当たりそのものは ink-cut・eraser-reach・eraser-draft の
// テストが見る。jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';

// 読み込んだハイライト・テキスト・ペン（口は既定の答え { ok: true, details: {} } を返すので、ペンはペンのまま）。
const IMPORTED = [
  { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
  {
    id: '120R', subtype: 'FreeText', rect: [100, 700, 165, 720.5], rotation: 0,
    contentsObj: { str: 'よみこみ', dir: 'ltr' },
    defaultAppearanceData: { fontName: 'SigKJP', fontSize: 12, fontColor: new Uint8ClampedArray([217, 44, 44]) },
  },
  { id: '31R', subtype: 'Ink', rect: [58, 398, 202, 402], color: new Uint8ClampedArray([43, 92, 217]), borderStyle: { width: 3 }, inkLists: [new Float32Array([60, 400, 200, 400])], opacity: 1 },
];

async function withShell(t, { imported = [] } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: { 0: imported } }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
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

function px(shell, point) {
  return shell.SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
}

// buttons は押している間のボタン（1 左・2 右・3 両方）。
function fire(shell, type, target, [x, y], { button = 0, buttons = 0 } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons });
  target.dispatchEvent(event);
  return event;
}

// pt の点で押して、動かして（離さない）。
function press(shell, points) {
  const down = fire(shell, 'mousedown', pageNode(shell), px(shell, points[0]), { buttons: 1 });
  for (const point of points.slice(1))
    fire(shell, 'mousemove', shell.document.body, px(shell, point), { buttons: 1 });
  return down;
}

function release(shell, point) {
  fire(shell, 'mouseup', pageNode(shell), px(shell, point));
}

// pt の点をなぞる（押す → 動かす → 離す）。
function trace(shell, points) {
  const down = press(shell, points);
  release(shell, points.at(-1));
  return down;
}

function drawPen(shell, points) {
  shell.SigK.annotate.setTool('pen');
  trace(shell, points);
  shell.SigK.annotate.setTool(null);
  return shell.SigK.viewer.getAnnotations().added.at(-1).id;
}

function drawSquare(shell, from, to) {
  const { SigK } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  trace(shell, [from, to]);
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

function erase(shell, points) {
  shell.SigK.annotate.setTool('eraser');
  return trace(shell, points);
}

const added = (shell, id) => shell.SigK.viewer.getAnnotations().added.find((entry) => entry.id === id);
const plain = (value) => structuredClone(value);

// 画面に描いたペンの線の本数（線 1 本が polyline 1 つ）。
function strokesShown(shell, key) {
  return shell.document.querySelectorAll(`.annot-layer g[data-annot="${key}"] polyline`).length;
}

test('ペンを横切ると触れた所だけ消えて 2 本になり、鍵はそのまま。四角は枠に触れると丸ごと消え、塗っていない四角の内側では残る', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const pen = drawPen(shell, [[100, 500], [200, 500], [300, 500]]);
  const square = drawSquare(shell, [100, 600], [300, 700]);
  erase(shell, [[150, 480], [150, 520]]);
  const cut = added(shell, pen);
  assert.equal(cut.paths.length, 2);
  assert.ok(cut.paths[0].at(-1)[0] < 150 && cut.paths[1][0][0] > 150, '横切った x=150 の前後が消える');
  assert.ok(cut.rect[0] < 101 && cut.rect[2] > 299, '箱は切った形の外接');
  assert.equal(strokesShown(shell, pen), 2);
  // 塗っていない四角の内側をなぞっても消えない（決定62 ②）
  erase(shell, [[180, 640], [220, 660]]);
  assert.notEqual(added(shell, square), undefined);
  // 枠の線に触れると丸ごと消える
  erase(shell, [[200, 690], [200, 710]]);
  assert.equal(added(shell, square), undefined);
  assert.equal(SigK.annotate.getTool(), 'eraser', '消したあとも消しゴムを持ったまま');
});

test('ドラッグ 1 回は 1 世代で、Ctrl+Z で全部戻り、やり直しで全部消える。何にも触れなければ世代を積まない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const pen = drawPen(shell, [[100, 500], [300, 500]]);
  const square = drawSquare(shell, [100, 520], [300, 600]);
  const before = plain(SigK.viewer.getAnnotations());
  const depth = SigK.pageEdit.getHistoryState();
  erase(shell, [[400, 200], [420, 210]]);
  assert.deepEqual(SigK.pageEdit.getHistoryState(), depth, '何にも触れなければ積まない');
  // ペンを切り、四角の下の辺に触れる 1 回
  erase(shell, [[200, 480], [200, 530]]);
  assert.equal(SigK.pageEdit.getHistoryState().at, depth.at + 1);
  assert.equal(added(shell, pen).paths.length, 2);
  assert.equal(added(shell, square), undefined);
  SigK.pageEdit.undo();
  assert.deepEqual(plain(SigK.viewer.getAnnotations()), before);
  SigK.pageEdit.redo();
  assert.equal(added(shell, pen).paths.length, 2);
  assert.equal(added(shell, square), undefined);
});

test('線が全部消えたペンは消え、書き込みの上を押しても選ばず掴まない。当てたら選択を外す', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const short = drawPen(shell, [[200, 500], [240, 500]]);
  const square = drawSquare(shell, [100, 600], [300, 700]);
  SigK.annotate.setTool('eraser');
  SigK.annotate.select(square);
  // 四角の内側（線から離れた所）を押して引いても、選び直さず、掴んで動かさない
  const rect = [...added(shell, square).rect];
  trace(shell, [[200, 650], [210, 655]]);
  assert.deepEqual([...added(shell, square).rect], rect);
  assert.deepEqual([...SigK.annotate.getSelection()], [square]);
  // 線に沿ってなぞったペンは丸ごと消え、選択は外れる
  trace(shell, [[195, 500], [245, 500]]);
  assert.equal(added(shell, short), undefined);
  assert.equal(SigK.annotate.getSelected(), null);
});

test('テキスト・ハイライトは消さず、読み込んだペンは切ると写しになる（元は removed へ）', async (t) => {
  const shell = await withShell(t, { imported: IMPORTED });
  const { SigK } = shell;
  placeText(shell);
  const before = plain(SigK.viewer.getAnnotations());
  const depth = SigK.pageEdit.getHistoryState();
  erase(shell, [[140, 290], [140, 320]]);
  erase(shell, [[130, 670], [130, 730]]);
  assert.deepEqual(plain(SigK.viewer.getAnnotations()), before, 'ハイライトと読み込んだテキスト・自前のテキストは残る');
  assert.deepEqual(SigK.pageEdit.getHistoryState(), depth, '世代も積まない');
  erase(shell, [[130, 390], [130, 410]]);
  const annots = SigK.viewer.getAnnotations();
  assert.deepEqual([...annots.removed], ['31R']);
  const copy = annots.added.at(-1);
  assert.equal(copy.kind, 'ink');
  assert.equal(copy.paths.length, 2);
  assert.equal(copy.ref, undefined);
});

test('取りやめ: Esc・Ctrl+Z・道具の持ち替え・モードの切り替えでは当てない。Ctrl+Z は履歴も動かさない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const pen = drawPen(shell, [[100, 500], [300, 500]]);
  const depth = SigK.pageEdit.getHistoryState();
  const run = (abort) => {
    SigK.annotate.setTool('eraser');
    press(shell, [[150, 480], [150, 520]]);
    assert.equal(SigK.annotateErase.isErasing(), true);
    assert.equal(strokesShown(shell, pen), 2, 'なぞっている間は切った形を下見する');
    abort();
    assert.equal(SigK.annotateErase.isErasing(), false);
    assert.equal(strokesShown(shell, pen), 1, '下見を元に戻す');
    release(shell, [150, 520]);
    assert.equal(added(shell, pen).paths.length, 1, '離しても当てない');
    assert.deepEqual(SigK.pageEdit.getHistoryState(), depth);
  };
  run(() => assert.equal(SigK.annotate.escape(), true));
  assert.equal(SigK.annotate.getTool(), 'eraser', 'Esc はなぞっている途中をやめるだけで、道具は離さない');
  run(() => assert.equal(SigK.pageEdit.undo(), true));
  run(() => SigK.annotate.setTool('pen'));
  run(() => SigK.shell.setMode(shell.document, 'view'));
  SigK.shell.setMode(shell.document, 'annot');
  assert.equal(added(shell, pen).paths.length, 1);
});

test('左＋右: なぞっている途中をやめてハンドへ持ち替え、そのあとの動き・離しでは消さない', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  const pen = drawPen(shell, [[100, 500], [300, 500]]);
  SigK.annotate.setTool('eraser');
  press(shell, [[150, 480], [150, 520]]);
  const at = px(shell, [150, 520]);
  fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 3 });
  assert.equal(SigK.annotateErase.isErasing(), false);
  assert.equal(SigK.annotate.getTool(), 'hand');
  fire(shell, 'mouseup', pageNode(shell), at, { button: 2, buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, px(shell, [250, 520]), { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell), px(shell, [250, 520]));
  assert.equal(added(shell, pen).paths.length, 1);
  assert.equal(strokesShown(shell, pen), 1);
});

test('輪のカーソル: 消しゴムを持って紙の上で押す点に出て、紙の外・窓の外・持ち替え・モードの切り替えで隠れる', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  assert.equal(document.querySelector('.eraser-ring'), null, '持つまでは作らない');
  SigK.annotate.setTool('eraser');
  assert.equal(document.documentElement.getAttribute('data-tool'), 'eraser');
  assert.equal(document.querySelector('#edit-bar [data-tool="eraser"]').getAttribute('aria-pressed'), 'true');
  fire(shell, 'mousemove', pageNode(shell), [50, 60]);
  const ring = document.querySelector('.eraser-ring');
  assert.equal(ring.hidden, false);
  assert.equal(ring.style.left, '50px');
  assert.equal(ring.style.top, '60px');
  assert.equal(ring.parentElement, document.body);
  fire(shell, 'mousemove', document.body, [50, 60]);
  assert.equal(ring.hidden, true, '紙の外');
  fire(shell, 'mousemove', pageNode(shell), [70, 80]);
  document.documentElement.dispatchEvent(new shell.window.MouseEvent('mouseleave'));
  assert.equal(ring.hidden, true, '窓の外');
  fire(shell, 'mousemove', pageNode(shell), [70, 80]);
  SigK.annotate.setTool('pen');
  assert.equal(ring.hidden, true, '持ち替え');
  fire(shell, 'mousemove', pageNode(shell), [70, 80]);
  assert.equal(ring.hidden, true, 'ペンを持っていると出ない');
  SigK.annotate.setTool('eraser');
  fire(shell, 'mousemove', pageNode(shell), [70, 80]);
  SigK.shell.setMode(document, 'view');
  fire(shell, 'mousemove', pageNode(shell), [70, 80]);
  assert.equal(ring.hidden, true, '表示モード');
});

// 自前のテキストを (100, 700) に置いて確定する（annotate-text.test.js と同じ手順）。
function placeText(shell) {
  const { SigK, document } = shell;
  SigK.annotate.setTool('text');
  trace(shell, [[100, 700]]);
  const node = document.querySelector('textarea.free-text-editor');
  node.value = 'こんにちは';
  node.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  fire(shell, 'mousedown', document.getElementById('view'), [5, 5]);
  fire(shell, 'mouseup', document.getElementById('view'), [5, 5]);
  SigK.annotate.select(null);
}

test('消しゴムを持つと右パネルにヒントが出て、ダブルクリックでテキストの入力欄を開かない', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  placeText(shell);
  assert.equal(SigK.freeTextEditor.isEditing(), false);
  SigK.annotate.setTool('eraser');
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationHints.HINTS.eraser);
  fire(shell, 'dblclick', pageNode(shell), px(shell, [110, 690]));
  assert.equal(SigK.freeTextEditor.isEditing(), false);
  assert.equal(SigK.annotate.getSelected(), null);
  // 道具を持っていなければ、同じ所のダブルクリックで入力欄が開く
  SigK.annotate.setTool(null);
  fire(shell, 'dblclick', pageNode(shell), px(shell, [110, 690]));
  assert.equal(SigK.freeTextEditor.isEditing(), true);
});
