'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeText, pageNode, plain } = require('./text-helpers.js');

// テキストの幅のつまみ（spec-4b-4a 確定事項F・A2）。jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、
// clientX/Y がそのまま .pdf-page 基準の CSS px になる。字の送り幅は全角 1em・半角 0.5em の見積もり。

const FIFTEEN = 'あいうえおかきくけこさしすせそ';

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
}

function handleOf(shell, id) {
  return shell.SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === id);
}

// つまみを押して、表示の px で dx だけ横へ動かす。release なら離す。
function pull(shell, id, dx, { release = true } = {}) {
  const at = handleOf(shell, id).at;
  const to = [at[0] + dx, at[1]];
  mouse(shell, 'mousedown', pageNode(shell), at);
  mouse(shell, 'mousemove', shell.document.body, to);
  if (release)
    mouse(shell, 'mouseup', pageNode(shell), to);
}

test('widthPatch は表示の右の向きに沿った量で幅を変え、右のつまみは左を、左のつまみは右を動かさない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, FIFTEEN);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const scale = viewport.scale;
  const resize = SigK.freeTextResize;
  assert.equal(resize.contentWidthOf(entry), 144, '自動の幅は最長行（12 字）');
  // 右のつまみを 40pt 狭める（上下の動きは見ない）。
  const narrower = resize.widthPatch(entry, 'right', [0, 0], [-40 * scale, 25 * scale], viewport);
  assert.equal(narrower.width, 104);
  assert.equal(narrower.rect[0], entry.rect[0]);
  assert.equal(narrower.rect[2] - narrower.rect[0], 104 + 4);
  // 左のつまみを 20pt 左へ広げると、箱の右は動かない。
  const wider = resize.widthPatch(entry, 'left', [0, 0], [-20 * scale, 0], viewport);
  assert.equal(wider.width, 164);
  assert.equal(wider.rect[2], entry.rect[2]);
  // 下限は 1 字（大きさ）。
  assert.equal(resize.widthPatch(entry, 'right', [0, 0], [-500 * scale, 0], viewport).width, 12);
  assert.equal(resize.widthPatch(entry, 'top', [0, 0], [1, 0], viewport), null);
});

test('右のつまみを引くと、引いている間は下見で、離すと固定の幅で折り返し直して 1 世代積む', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, FIFTEEN);
  SigK.annotate.setTool(null);
  SigK.annotate.select(entry.id);
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  const at = SigK.pageEdit.getHistoryState().at;
  pull(shell, 'right', -24 * scale, { release: false });
  assert.equal(SigK.pageEdit.getHistoryState().at, at, '引いている間は積まない');
  const drawn = [...pageNode(shell).querySelectorAll('.annot-layer g[data-kind="text"] text')].map((node) => node.textContent);
  assert.deepEqual(drawn, ['あいうえおかきくけこ', 'さしすせそ'], '下見は 10 字で折り返す');
  mouse(shell, 'mouseup', pageNode(shell), handleOf(shell, 'right').at);
  assert.equal(SigK.pageEdit.getHistoryState().at, at + 1);
  const changed = SigK.annotate.selectedEntry();
  assert.equal(changed.width, 120);
  assert.deepEqual(plain(SigK.freeTextMetrics.layoutOfEntry(changed).lines), ['あいうえおかきくけこ', 'さしすせそ']);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getAnnotations().added[0].width, 'auto');
});

test('Esc で幅の引きを取りやめると元の形に戻り、積まない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  const entry = placeText(shell, 100, 700, FIFTEEN);
  SigK.annotate.setTool(null);
  SigK.annotate.select(entry.id);
  const at = SigK.pageEdit.getHistoryState().at;
  pull(shell, 'left', 30, { release: false });
  document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  mouse(shell, 'mouseup', pageNode(shell), [0, 0]);
  assert.equal(SigK.pageEdit.getHistoryState().at, at);
  assert.equal(SigK.viewer.getAnnotations().added[0].width, 'auto');
});

test('今までの形のテキストも幅のつまみで引くと、固定の幅の新しい形に移る（確定事項A2・F1）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const old = SigK.annotationState.addAnnot(SigK.viewer.getAnnotations(), {
    id: 'sigk-old', src: 0, kind: 'text', color: '#222a35', opacity: 1, text: FIFTEEN, fontSize: 10, rotation: 0,
    rect: [100, 683.5, 254, 700], quads: [[100, 700, 254, 700, 100, 683.5, 254, 683.5]],
  });
  SigK.pageEdit.commitAnnots(old, { annot: { before: null, after: 'sigk-old' } });
  SigK.annotate.select('sigk-old');
  const scale = SigK.viewer.getTextLayer(0).viewport.scale;
  pull(shell, 'right', -50 * scale);
  const changed = SigK.annotate.selectedEntry();
  assert.equal(changed.width, 100);
  assert.deepEqual(plain(SigK.freeTextMetrics.layoutOfEntry(changed).lines), ['あいうえおかきくけこ', 'さしすせそ']);
});

test('引いた幅が最長行とほぼ同じで行の並びも自動と同じなら、開き直して自動と見誤られないよう 0.02pt 広げる（完了判定5）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeText(shell, 100, 700, 'あいう');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  // 動かさずに引いた形（今の最長行 36pt のまま）は、そのままだと読み戻しで自動に見える。
  const patch = SigK.freeTextResize.widthPatch(entry, 'right', [0, 0], [0, 0], viewport);
  assert.equal(patch.width, 36 + SigK.freeTextMetrics.FIXED_MARGIN);
  const advanceOf = (unit, bold) => SigK.freeTextShape.advanceOf(shell.document, unit, bold);
  assert.equal(SigK.importedTextDetails.widthOf({ ...entry, ...patch }, { advanceOf, pageLength: SigK.freeTextMetrics.pageLengthOf(0, 0) }), patch.width);
});
