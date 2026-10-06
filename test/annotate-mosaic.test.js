'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// モザイクの道具の押し離しと右パネル（spec-4b-6b 確定事項10〜17。決定64 ⑦・決定66 ④）。下見の塗りは mosaic-paint.test.js、
// 文字の層と検索は mosaic-preview.test.js。jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま
// .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';
const PHOTO = 'C:\\work\\photo.jpg';
const BOX = [100, 200, 400, 600];

async function withMosaic(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('mosaic');
  await shell.flush();
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function px(shell, index, point) {
  return shell.SigK.viewer.getTextLayer(index).viewport.convertToViewportPoint(point[0], point[1]);
}

function fire(shell, type, target, [x, y], { buttons = 0 } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });
  target.dispatchEvent(event);
  return event;
}

// index のページで、紙の座標の点 from から to まで引く（押す → 動かす → 離す）。release を false にすると離さない。
function pull(shell, index, from, to, { release = true } = {}) {
  const down = fire(shell, 'mousedown', pageNode(shell, index), px(shell, index, from), { buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, px(shell, index, to), { buttons: 1 });
  if (release)
    fire(shell, 'mouseup', pageNode(shell, index), px(shell, index, to));
  return down;
}

// 範囲の左上（紙の座標で x1・y2）から右下（x2・y1）まで引く。
function drawBox(shell, box = BOX, index = 0, options = {}) {
  return pull(shell, index, [box[0], box[3]], [box[2], box[1]], options);
}

// 引いて置き、描き直しを待つ（置くと plan が変わり、全ページを描き直す）。
async function placeBox(shell, box = BOX, index = 0) {
  const down = drawBox(shell, box, index);
  await shell.flush();
  return down;
}

// plan の mosaic を、こちらの配列に写して返す（jsdom の配列は deepEqual で比べられない）。
function mosaicOf(shell, index = 0) {
  const items = shell.SigK.viewer.getPlan()[index].mosaic;
  return items === undefined ? undefined : JSON.parse(JSON.stringify(items));
}

function text(shell, id) {
  return shell.document.getElementById(id).textContent;
}

test('モザイクを持って紙の上を引き、離すと、その範囲に今の粗さのモザイクを置く（1 世代・未保存の印）', async (t) => {
  const shell = await withMosaic(t);
  const { SigK, document } = shell;
  const down = await placeBox(shell);
  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(mosaicOf(shell), [{ box: BOX, block: 8 }]);
  // 離したら破線の四角は消える。書き込みは選ばない。
  assert.equal(document.querySelector('.mosaic-draft'), null);
  assert.equal(SigK.annotate.getSelection().length, 0);
  assert.equal(SigK.viewer.isDirty(), true);
  // 2 つ目は後ろへ足す。
  await placeBox(shell, [50, 60, 70, 80]);
  assert.deepEqual(mosaicOf(shell), [{ box: BOX, block: 8 }, { box: [50, 60, 70, 80], block: 8 }]);
});

test('引いている間は破線の四角を出し、3px 以内の押し離しでは置かない', async (t) => {
  const shell = await withMosaic(t);
  const { document } = shell;
  drawBox(shell, BOX, 0, { release: false });
  const draft = pageNode(shell).querySelector('.mosaic-draft');
  assert.ok(draft !== null);
  const [x1, y1] = px(shell, 0, [BOX[0], BOX[3]]);
  assert.equal(Number.parseFloat(draft.style.left), x1);
  assert.equal(Number.parseFloat(draft.style.top), y1);
  assert.equal(mosaicOf(shell), undefined, '離すまでは置かない');
  fire(shell, 'mouseup', pageNode(shell), px(shell, 0, [BOX[2], BOX[1]]));
  assert.deepEqual(mosaicOf(shell), [{ box: BOX, block: 8 }]);
  await shell.flush();

  const [x, y] = px(shell, 1, [100, 100]);
  fire(shell, 'mousedown', pageNode(shell, 1), [x, y], { buttons: 1 });
  fire(shell, 'mousemove', document.body, [x + 2, y + 2], { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell, 1), [x + 2, y + 2]);
  assert.equal(mosaicOf(shell, 1), undefined);
});

test('範囲は見える範囲（切ってあれば切った範囲）の中に収める', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 400, height: 500 }, A4, A4], views: [[50, 60, 450, 560]] });
  const shell = await withMosaic(t, { pdfjs });
  pull(shell, 0, [0, 1000], [200, 300]);
  assert.deepEqual(mosaicOf(shell), [{ box: [50, 300, 200, 560], block: 8 }]);
});

test('Esc・道具やモードを替える・左＋右・Ctrl+Z・保存と印刷の前・窓のフォーカスが外れたら、引いている途中をやめて置かない', async (t) => {
  const shell = await withMosaic(t);
  const { SigK, document, window } = shell;
  const cases = [
    ['Esc', () => SigK.annotate.escape()],
    ['道具を替える', () => SigK.annotate.setTool('pen')],
    ['モードを替える', () => SigK.shell.setMode(document, 'view')],
    ['左＋右', () => {
      fire(shell, 'mousedown', pageNode(shell), [10, 10], { buttons: 3 });
      fire(shell, 'mouseup', pageNode(shell), [10, 10]);
    }],
    ['Ctrl+Z', () => SigK.pageEdit.undo()],
    ['保存と印刷の前', () => SigK.annotate.finishEditing()],
    ['窓のフォーカスが外れた', () => window.dispatchEvent(new window.Event('blur'))],
  ];
  for (const [label, act] of cases) {
    SigK.shell.setMode(document, 'annot');
    SigK.annotate.setTool('mosaic');
    drawBox(shell, BOX, 0, { release: false });
    assert.equal(SigK.annotateMosaic.isDragging(), true, label);
    act();
    assert.equal(SigK.annotateMosaic.isDragging(), false, label);
    assert.equal(document.querySelector('.mosaic-draft'), null, label);
    fire(shell, 'mouseup', pageNode(shell), px(shell, 0, [BOX[2], BOX[1]]));
    assert.equal(mosaicOf(shell), undefined, label);
  }
});

test('Esc は引いている途中が無ければ道具を外す', async (t) => {
  const { SigK } = await withMosaic(t);
  assert.equal(SigK.annotate.escape(), true);
  assert.equal(SigK.annotate.getTool(), null);
});

test('差し込んだ未保存のページで引くと、置かずに帯（黄）で断る', async (t) => {
  const shell = await withMosaic(t, {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [{ ok: true, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), pages: [{ width: A4.width, height: A4.height }], kind: 'jpeg' }],
  });
  const { SigK, document } = shell;
  await SigK.insert.run();
  await shell.flush();
  const index = SigK.viewer.getPlan().findIndex((page) => Number.isInteger(page.insert));
  assert.ok(index >= 0);
  SigK.annotate.setTool('mosaic');
  const down = fire(shell, 'mousedown', pageNode(shell, index), [50, 50], { buttons: 1 });
  fire(shell, 'mousemove', document.body, [200, 200], { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell, index), [200, 200]);
  assert.equal(down.defaultPrevented, true);
  assert.equal(SigK.viewer.getPlan()[index].mosaic, undefined);
  assert.equal(SigK.viewBanner.text(), '差し込んだページは、保存してからモザイクを入れてください。');
  assert.equal(document.getElementById('view-banner').getAttribute('data-tone'), 'warn');
});

test('右パネル: 種類・粗さ 3 段・このページの数・外すボタン・ヒントを出し、ほかの行と［削除］を隠す', async (t) => {
  const shell = await withMosaic(t);
  const { SigK, document } = shell;
  assert.equal(text(shell, 'props-kind'), 'モザイク');
  assert.equal(document.getElementById('props-mosaic-block-row').hidden, false);
  assert.deepEqual([...document.querySelectorAll('#props-mosaic-block button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    [['細かい', 'false'], ['ふつう', 'true'], ['粗い', 'false']]);
  assert.equal(text(shell, 'props-mosaic-count'), 'モザイクはありません');
  const remove = document.getElementById('props-mosaic-remove');
  assert.equal(remove.hidden, false);
  assert.equal(remove.getAttribute('aria-disabled'), 'true');
  assert.equal(document.getElementById('props-delete').hidden, true);
  assert.equal(document.getElementById('props-color-row').hidden, true);
  assert.equal(document.getElementById('props-trim-scope-row').hidden, true);
  assert.match(text(shell, 'props-hint'), /^紙の上を引いて、隠す範囲を囲んでください。/);

  await placeBox(shell);
  await placeBox(shell, [10, 10, 50, 50]);
  assert.equal(text(shell, 'props-mosaic-count'), 'モザイク 2 か所（まだ保存していません）');
  assert.equal(remove.getAttribute('aria-disabled'), null);
  // ほかのページに移ると、そのページの数。
  SigK.viewer.goToPage(1);
  await shell.flush();
  assert.equal(text(shell, 'props-mosaic-count'), 'モザイクはありません');
  // 道具を外すと行を隠し、［削除］を戻す。
  SigK.annotate.setTool(null);
  assert.equal(document.getElementById('props-mosaic-block-row').hidden, true);
  assert.equal(remove.hidden, true);
  assert.equal(document.getElementById('props-delete').hidden, false);
});

test('粗さを選ぶと覚え、次に置くモザイクから効く（置いたものは変わらない）', async (t) => {
  const shell = await withMosaic(t);
  const { SigK, document } = shell;
  await placeBox(shell);
  document.querySelector('#props-mosaic-block button[data-block="14"]').click();
  assert.equal(SigK.annotateMosaic.getBlock(), 14);
  assert.deepEqual(JSON.parse(JSON.stringify(shell.uiCalls.at(-1))), { annotMosaicBlock: 14 });
  assert.equal(document.querySelector('#props-mosaic-block button[data-block="14"]').getAttribute('aria-pressed'), 'true');
  await placeBox(shell, [10, 10, 50, 50]);
  assert.deepEqual(mosaicOf(shell), [{ box: BOX, block: 8 }, { box: [10, 10, 50, 50], block: 14 }]);
});

test('設定の粗さで始まり、3 段のどれでもなければふつう', async (t) => {
  const shell = await withMosaic(t, { ui: { mode: 'view', pageLayout: 'single', sidePanel: { open: true, width: 240 }, annotMosaicBlock: 4 } });
  assert.equal(shell.SigK.annotateMosaic.getBlock(), 4);
  assert.equal(shell.SigK.annotateMosaic.applyBlock(10), 4);
  assert.equal(shell.SigK.annotateMosaic.setBlock(10), false);
});

test('［このページのモザイクを外す］は今のページのモザイクを全部外し、1 世代で Ctrl+Z・やり直しが効く', async (t) => {
  const shell = await withMosaic(t);
  const { SigK, document } = shell;
  await placeBox(shell);
  await placeBox(shell, [10, 10, 50, 50]);
  document.getElementById('props-mosaic-remove').click();
  assert.equal(mosaicOf(shell), undefined);
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(text(shell, 'props-mosaic-count'), 'モザイクはありません');
  SigK.pageEdit.undo();
  assert.equal(mosaicOf(shell).length, 2);
  SigK.pageEdit.undo();
  assert.equal(mosaicOf(shell).length, 1);
  SigK.pageEdit.redo();
  SigK.pageEdit.redo();
  assert.equal(mosaicOf(shell), undefined);
  // 無ければ押しても積まない。
  assert.equal(SigK.annotateMosaic.removeOnPage(), false);
});

test('回したページでも、引いた範囲が紙の座標（回す前）で合う', async (t) => {
  const shell = await withMosaic(t);
  const { SigK } = shell;
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  await shell.flush();
  await placeBox(shell);
  assert.deepEqual(mosaicOf(shell), [{ box: BOX, block: 8 }]);
  assert.equal(SigK.viewer.getPlan()[0].rotate, 90);
});
