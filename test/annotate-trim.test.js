'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// トリミングの枠の押し離し（spec-4b-6a 確定事項12〜16・26。決定64 ①）。切る・外すは trim-tool.test.js、右パネルは trim-props.test.js。
// jsdom はレイアウトしないので、ページの枠の左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

const A = 'C:\\work\\a.pdf';
const PHOTO = 'C:\\work\\photo.jpg';
const BOX = [100, 200, 400, 600];

async function withTrim(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('trim');
  await shell.flush();
  return shell;
}

function pageNode(shell, index = 0) {
  return shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
}

function viewportOf(shell, index = 0) {
  return shell.SigK.viewer.getTextLayer(index).viewport;
}

function px(shell, index, point) {
  return viewportOf(shell, index).convertToViewportPoint(point[0], point[1]);
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

// 枠の左上（紙の座標で x1・y2）から右下（x2・y1）まで引く。
function drawFrame(shell, box = BOX, index = 0) {
  return pull(shell, index, [box[0], box[3]], [box[2], box[1]]);
}

function key(shell, name) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  shell.document.body.dispatchEvent(event);
  return event;
}

function frameOf(shell) {
  const frame = shell.SigK.annotateTrim.getFrame();
  return frame === null ? null : { index: frame.index, box: [...frame.box] };
}

test('トリミングを持って紙の上を引くと、そのページに枠・暗い外側・8 点のつまみ・大きさの札が出る', async (t) => {
  const shell = await withTrim(t);
  const down = drawFrame(shell);

  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(frameOf(shell), { index: 0, box: BOX });
  const layer = pageNode(shell).querySelector('.trim-layer');
  assert.ok(layer !== null);
  assert.equal(layer.querySelectorAll('.trim-shade').length, 4);
  assert.equal(layer.querySelectorAll('.trim-handle').length, 8);
  // 300pt × 400pt は 106 mm × 141 mm。
  assert.equal(layer.querySelector('.trim-label').textContent, '幅 106 mm × 高さ 141 mm');
  const [x1, y1] = px(shell, 0, [BOX[0], BOX[3]]);
  const box = layer.querySelector('.trim-box');
  assert.equal(Number.parseFloat(box.style.left), x1);
  assert.equal(Number.parseFloat(box.style.top), y1);
  // 書き込みは選ばず、切ってもいない。
  assert.equal(shell.SigK.annotate.getSelection().length, 0);
  assert.equal(shell.SigK.viewer.getPlan()[0].crop, undefined);
});

test('3px 以内の押し離しでは枠を出さず、紙の外を押しても何もしない', async (t) => {
  const shell = await withTrim(t);
  const [x, y] = px(shell, 0, [200, 400]);
  fire(shell, 'mousedown', pageNode(shell), [x, y], { buttons: 1 });
  fire(shell, 'mousemove', shell.document.body, [x + 3, y - 3], { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell), [x + 3, y - 3]);
  assert.equal(frameOf(shell), null);
  assert.equal(shell.document.querySelector('.trim-layer'), null);

  const outside = fire(shell, 'mousedown', shell.document.getElementById('view'), [5, 5], { buttons: 1 });
  assert.equal(outside.defaultPrevented, false);
  assert.equal(shell.SigK.annotateTrim.isDragging(), false);
});

test('つまみを掴むと大きさが、中を掴むと位置が変わり、どちらも見える範囲から出ない', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);

  // 右下のつまみを右下へ。
  pull(shell, 0, [BOX[2], BOX[1]], [450, 150]);
  assert.deepEqual(frameOf(shell).box, [100, 150, 450, 600]);
  // 中を掴んで左上へ大きく動かすと、紙の端で止まる（大きさは変わらない）。
  pull(shell, 0, [300, 400], [-1000, 2000]);
  assert.deepEqual(frameOf(shell).box, [0, A4.height - 450, 350, A4.height]);
  // 左のつまみを右の辺の先まで引いても、10pt より狭くならない。
  pull(shell, 0, [0, A4.height - 225], [1000, A4.height - 225]);
  assert.deepEqual(frameOf(shell).box, [340, A4.height - 450, 350, A4.height]);
});

test('枠の外を引くと引き直し、別のページで引けばそのページへ移る', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  drawFrame(shell, [50, 50, 150, 150]);
  assert.deepEqual(frameOf(shell), { index: 0, box: [50, 50, 150, 150] });

  drawFrame(shell, [200, 300, 500, 700], 1);
  assert.deepEqual(frameOf(shell), { index: 1, box: [200, 300, 500, 700] });
  assert.equal(pageNode(shell, 0).querySelector('.trim-layer'), null);
  assert.ok(pageNode(shell, 1).querySelector('.trim-layer') !== null);
});

test('Esc は、引いている途中なら引く前の枠へ戻し、次に枠を消し、その次に道具を外す', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  pull(shell, 0, [BOX[2], BOX[1]], [500, 100], { release: false });
  assert.deepEqual(frameOf(shell).box, [100, 100, 500, 600]);

  key(shell, 'Escape');
  assert.deepEqual(frameOf(shell).box, BOX);
  assert.equal(shell.SigK.annotateTrim.isDragging(), false);
  key(shell, 'Escape');
  assert.equal(frameOf(shell), null);
  assert.equal(shell.document.querySelector('.trim-layer'), null);
  assert.equal(shell.SigK.annotate.getTool(), 'trim');
  key(shell, 'Escape');
  assert.equal(shell.SigK.annotate.getTool(), null);
});

test('道具・モードを替える・左＋右・取り消しの前・保存と印刷の前（finishEditing）は枠を捨てる', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  const cases = [
    ['道具を替える', () => SigK.annotate.setTool('pen')],
    ['モードを替える', () => SigK.shell.setMode(document, 'view')],
    ['左＋右', () => {
      fire(shell, 'mousedown', pageNode(shell), [10, 10], { buttons: 3 });
      // 全部のボタンを離すまでは、左＋右の続きとして捨てられる（spec-4b-3b 確定事項E2）。
      fire(shell, 'mouseup', pageNode(shell), [10, 10]);
    }],
    ['Ctrl+Z', () => SigK.pageEdit.undo()],
    ['保存と印刷の前', () => SigK.annotate.finishEditing()],
  ];
  for (const [label, act] of cases) {
    SigK.shell.setMode(document, 'annot');
    SigK.annotate.setTool('trim');
    drawFrame(shell);
    assert.ok(frameOf(shell) !== null, label);
    act();
    assert.equal(frameOf(shell), null, label);
    assert.equal(document.querySelector('.trim-layer'), null, label);
  }
});

test('倍率が変わっても枠は紙の座標のまま残り、描き直したページに描かれる', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  shell.SigK.viewer.setZoom(2);
  await shell.flush();

  assert.deepEqual(frameOf(shell), { index: 0, box: BOX });
  const box = pageNode(shell).querySelector('.trim-layer .trim-box');
  const [x1, y1] = px(shell, 0, [BOX[0], BOX[3]]);
  assert.equal(Number.parseFloat(box.style.left), x1);
  assert.equal(Number.parseFloat(box.style.top), y1);
});

test('引いている途中に倍率が変わったら、引く前の枠に戻す', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  pull(shell, 0, [300, 400], [350, 450], { release: false });
  shell.SigK.viewer.setZoom(2);
  await shell.flush();
  fire(shell, 'mousemove', shell.document.body, [10, 10], { buttons: 1 });

  assert.equal(shell.SigK.annotateTrim.isDragging(), false);
  assert.deepEqual(frameOf(shell).box, BOX);
});

test('左を離したのが届かなかったら、次に動かしたときに今の枠で終える', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  pull(shell, 0, [300, 400], [320, 380], { release: false });
  fire(shell, 'mousemove', shell.document.body, px(shell, 0, [330, 370]), { buttons: 0 });

  assert.equal(shell.SigK.annotateTrim.isDragging(), false);
  assert.deepEqual(frameOf(shell).box, [120, 180, 420, 580]);
});

test('つまみの上は向きの矢印、枠の中は移動、そのほかは十字（印を付けない）のカーソルになる', async (t) => {
  const shell = await withTrim(t);
  const html = shell.document.documentElement;
  drawFrame(shell);
  const hoverAt = (point) => fire(shell, 'mousemove', pageNode(shell), px(shell, 0, point));

  hoverAt([BOX[0], BOX[3]]);
  assert.equal(html.getAttribute('data-trim-cursor'), 'nwse');
  hoverAt([BOX[2], BOX[3]]);
  assert.equal(html.getAttribute('data-trim-cursor'), 'nesw');
  hoverAt([250, BOX[1]]);
  assert.equal(html.getAttribute('data-trim-cursor'), 'ns');
  hoverAt([250, 400]);
  assert.equal(html.getAttribute('data-trim-cursor'), 'move');
  hoverAt([500, 700]);
  assert.equal(html.hasAttribute('data-trim-cursor'), false);
  hoverAt([250, 400]);
  shell.SigK.annotate.setTool(null);
  assert.equal(html.hasAttribute('data-trim-cursor'), false);
});

test('ダブルクリックしても書き込みを直さない', async (t) => {
  const shell = await withTrim(t);
  const event = new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
  pageNode(shell).dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test('差し込んだ未保存のページで引くと、枠を出さずに帯（黄）で断る', async (t) => {
  const shell = await withTrim(t, {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [{ ok: true, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), pages: [{ width: A4.width, height: A4.height }], kind: 'jpeg' }],
  });
  const { SigK, document } = shell;
  await SigK.insert.run();
  await shell.flush();
  const index = SigK.viewer.getPlan().findIndex((page) => Number.isInteger(page.insert));
  assert.ok(index >= 0);
  SigK.annotate.setTool('trim');

  const down = fire(shell, 'mousedown', pageNode(shell, index), [50, 50], { buttons: 1 });
  fire(shell, 'mousemove', document.body, [200, 200], { buttons: 1 });
  fire(shell, 'mouseup', pageNode(shell, index), [200, 200]);
  assert.equal(down.defaultPrevented, true);
  assert.equal(frameOf(shell), null);
  assert.equal(SigK.viewBanner.text(), '差し込んだページは、保存してから切ってください。');
  assert.equal(document.getElementById('view-banner').getAttribute('data-tone'), 'warn');
});

test('原点のずれた紙（ほかのアプリで切ってあるページ）でも、引いた枠が紙の座標で合い、見える範囲から出ない', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 400, height: 500 }, A4, A4], views: [[50, 60, 450, 560]] });
  const shell = await withTrim(t, { pdfjs });
  drawFrame(shell, [100, 150, 300, 400]);
  assert.deepEqual(frameOf(shell), { index: 0, box: [100, 150, 300, 400] });
  // 見える範囲の外から引いても、見える範囲の中に収める。
  pull(shell, 0, [0, 1000], [200, 300]);
  assert.deepEqual(frameOf(shell), { index: 0, box: [50, 300, 200, 560] });
});

test('枠があるときの Ctrl+Z は枠を捨てるだけで、前に切ったものは戻さない（描きかけの多角形と同じ。点検 3）', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  drawFrame(shell);
  key(shell, 'Enter');
  await shell.flush();
  drawFrame(shell, [150, 250, 350, 550]);
  assert.ok(frameOf(shell) !== null);

  SigK.pageEdit.undo();
  assert.equal(frameOf(shell), null);
  assert.deepEqual([...SigK.viewer.getPlan()[0].crop], BOX);
  SigK.pageEdit.undo();
  assert.equal(SigK.viewer.getPlan()[0].crop, undefined);
});

test('右パネルのボタンの上で Enter を押しても切らず、ボタンに任せる（点検 2）', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  drawFrame(shell);
  const enterOn = (node) => {
    const event = new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event;
  };
  for (const id of ['props-trim-cancel', 'props-trim-apply'])
    assert.equal(enterOn(document.getElementById(id)).defaultPrevented, false, id);
  assert.equal(enterOn(document.querySelector('#props-trim-scope button[data-scope="all"]')).defaultPrevented, false);
  assert.ok(frameOf(shell) !== null);
  assert.equal(SigK.viewer.getPlan()[0].crop, undefined);
});

// 道具の段のボタンをマウスで押すと、Windows の Chromium はボタンへフォーカスを移す。紙の上の押下は preventDefault するので
// フォーカスはそのまま残り、Enter がボタンのもの（点検 2）になって切れなかった（計画外の直し③）。jsdom はマウスの押下で
// フォーカスを移さないので、focus() してから detail が 1（マウス）の click を送る。
test('道具の段のトリミングをマウスで押して持ったあと、枠を引いて Enter を押すと切れる（計画外の直し③）', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool(null);
  const button = document.querySelector('#edit-bar .edit-tool[data-tool="trim"]');
  button.focus();
  button.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  await shell.flush();
  assert.equal(SigK.annotate.getTool(), 'trim');
  assert.notEqual(document.activeElement, button, 'ボタンにフォーカスが残っている');

  drawFrame(shell);
  const enter = new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual([...SigK.viewer.getPlan()[0].crop], BOX);
});

test('タブを替える・印刷を開くと、枠を捨てる', async (t) => {
  const B = 'C:\\work\\b.pdf';
  const shell = await withTrim(t);
  const { SigK } = shell;
  drawFrame(shell);
  await SigK.print.open();
  assert.equal(frameOf(shell), null);
  SigK.print.close?.();

  drawFrame(shell);
  shell.files[B] = makeSource({ path: B, name: 'b.pdf' });
  await SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(frameOf(shell), null);
  assert.equal(shell.document.querySelector('.trim-layer'), null);
});
