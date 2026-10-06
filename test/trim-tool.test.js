'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// トリミングを切る・外す（spec-4b-6a 確定事項10・14・17〜19。決定64 ②③）。枠の押し離しは annotate-trim.test.js、右パネルは
// trim-props.test.js。plan の作り替えの細部（余白の読み替え）は page-crop.test.js と trim-commit.test.js が見る。

const A = 'C:\\work\\a.pdf';
const PHOTO = 'C:\\work\\photo.jpg';
const BOX = [100, 200, 400, 600];
const PAPER = [0, 0, A4.width, A4.height];

async function withTrim(t, { pdfjs = createPdfjsStub(), ...options } = {}) {
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) }, ...options });
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

function fire(shell, type, target, [x, y], buttons = 0) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
}

// index のページで、紙の座標の箱 box を囲む枠を引く。
function drawFrame(shell, box = BOX, index = 0) {
  const viewport = shell.SigK.viewer.getTextLayer(index).viewport;
  const from = viewport.convertToViewportPoint(box[0], box[3]);
  const to = viewport.convertToViewportPoint(box[2], box[1]);
  fire(shell, 'mousedown', pageNode(shell, index), from, 1);
  fire(shell, 'mousemove', shell.document.body, to, 1);
  fire(shell, 'mouseup', pageNode(shell, index), to);
}

function key(shell, name) {
  shell.document.body.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

// jsdom の世界の配列は、こちらの配列と deepEqual で比べられないので、こちらの配列に写す。
function crops(shell) {
  return Array.from(shell.SigK.viewer.getPlan(), (page) => (page.crop === undefined ? null : [...page.crop]));
}

test('Enter で切ると 1 世代で crop が付き、枠が消え、道具はトリミングのまま。元に戻す・やり直すが効く', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  const depth = SigK.pageEdit.getHistoryState().depth;
  drawFrame(shell);
  key(shell, 'Enter');

  assert.deepEqual(crops(shell), [BOX, null, null]);
  assert.equal(SigK.pageEdit.getHistoryState().depth, depth + 1);
  assert.equal(SigK.annotateTrim.getFrame(), null);
  assert.equal(shell.document.querySelector('.trim-layer'), null);
  assert.equal(SigK.annotate.getTool(), 'trim');
  assert.equal(SigK.viewer.isDirty(), true);

  SigK.pageEdit.undo();
  assert.deepEqual(crops(shell), [null, null, null]);
  assert.equal(SigK.viewer.isDirty(), false);
  SigK.pageEdit.redo();
  assert.deepEqual(crops(shell), [BOX, null, null]);
});

test('［適用］でも切り、切ったページの上端へ表示を寄せる', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  drawFrame(shell, BOX, 1);
  document.getElementById('props-trim-apply').click();

  assert.deepEqual(crops(shell), [null, BOX, null]);
  assert.equal(SigK.viewer.getState().current, 1);
});

test('枠が今の見える範囲と同じなら、何も積まずに枠だけ消す', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  const depth = SigK.pageEdit.getHistoryState().depth;
  drawFrame(shell, [-50, -50, A4.width + 50, A4.height + 50]);
  assert.deepEqual([...SigK.annotateTrim.getFrame().box], PAPER);
  key(shell, 'Enter');

  assert.equal(SigK.annotateTrim.getFrame(), null);
  assert.equal(SigK.pageEdit.getHistoryState().depth, depth);
  assert.deepEqual(crops(shell), [null, null, null]);
});

test('切ったページでもう一度引くと、切った範囲の中で切り直せる', async (t) => {
  const shell = await withTrim(t);
  drawFrame(shell);
  key(shell, 'Enter');
  await shell.flush();
  // 枠は切った範囲の中にしか引けない。
  drawFrame(shell, [0, 0, 1000, 1000]);
  assert.deepEqual([...shell.SigK.annotateTrim.getFrame().box], BOX);
  key(shell, 'Escape');
  drawFrame(shell, [150, 250, 300, 500]);
  key(shell, 'Enter');
  assert.deepEqual(crops(shell), [[150, 250, 300, 500], null, null]);
});

test('すべてのページ: 大きさの違うページ・回したページも上下左右を同じ幅だけ切り、小さすぎるページはそのまま。帯で数を知らせる', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [A4, { width: 800, height: 1000 }, { width: 20, height: 20 }], rotations: [0, 90, 0] });
  const shell = await withTrim(t, { pdfjs });
  const { SigK, document } = shell;
  const depth = SigK.pageEdit.getHistoryState().depth;
  document.querySelector('#props-trim-scope button[data-scope="all"]').click();
  drawFrame(shell);
  key(shell, 'Enter');

  // 余白は上 241.89・右 195.28・下 200・左 100（画面の向き）。90° のページは、画面の上が紙の左の辺になる。
  assert.deepEqual(crops(shell), [BOX, [241.89, 100, 600, 804.72], null]);
  assert.equal(SigK.pageEdit.getHistoryState().depth, depth + 1);
  assert.equal(SigK.viewBanner.text(), '2 ページを切りました。小さすぎる 1 ページはそのままです。');
  assert.equal(document.getElementById('view-banner').getAttribute('data-tone'), 'info');
});

test('すべてのページ: 差し込んだページは切らず、帯に数を添える', async (t) => {
  const shell = await withTrim(t, {
    insertSourceResults: [{ path: PHOTO }],
    taskResults: [{ ok: true, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), pages: [{ width: A4.width, height: A4.height }], kind: 'jpeg' }],
  });
  const { SigK } = shell;
  await SigK.insert.run();
  await shell.flush();
  SigK.annotate.setTool('trim');
  SigK.trimTool.setScope('all');
  drawFrame(shell);
  key(shell, 'Enter');

  assert.deepEqual(crops(shell), [BOX, BOX, BOX, null]);
  assert.equal(Number.isInteger(SigK.viewer.getPlan()[3].insert), true);
  assert.equal(SigK.viewBanner.text(), '3 ページを切りました。差し込んだ 1 ページはそのままです。');
});

test('道具を持つたびに当てるページを［このページ］へ戻し、選択を外し、紙全体を 1 回だけ読む', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  assert.deepEqual(shell.boxesCalls.map((spec) => spec.source), [A]);
  assert.deepEqual(shell.boxesCalls[0].expect, { size: 1024, mtimeMs: 1000 });
  SigK.trimTool.setScope('all');
  SigK.annotate.setTool(null);
  SigK.annotate.setTool('trim');
  await shell.flush();

  assert.equal(SigK.trimTool.getScope(), 'page');
  assert.equal(shell.boxesCalls.length, 1);
});

test('［トリミングを外す］は紙全体を読み終えるまで待ち、ほかのアプリで切ってあるページも紙全体に戻す', async (t) => {
  let release = null;
  const pending = new Promise((resolve) => { release = resolve; });
  const pdfjs = createPdfjsStub({ sizes: [{ width: 400, height: 500 }, A4, A4], views: [[50, 60, 450, 560]] });
  const shell = await withTrim(t, { pdfjs, boxesResults: [() => pending] });
  const { SigK, document } = shell;
  const button = document.getElementById('props-trim-remove');
  assert.equal(button.hidden, false);

  const removing = SigK.trimTool.remove();
  assert.equal(SigK.trimTool.isRemoving(), true);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  release({ ok: true, boxes: [PAPER, PAPER, PAPER] });
  assert.equal(await removing, true);

  assert.deepEqual(crops(shell), [PAPER, null, null]);
  assert.equal(SigK.viewer.isDirty(), true);
  assert.equal(SigK.trimTool.isRemoving(), false);
  // もう紙全体なので外せない。
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(await SigK.trimTool.remove(), false);
});

test('紙全体を読めなければ、開いたときの見える範囲まで戻す（未保存の印も消える）', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  drawFrame(shell);
  key(shell, 'Enter');
  document.getElementById('props-trim-remove').click();
  await shell.flush();

  assert.deepEqual(crops(shell), [null, null, null]);
  assert.equal(SigK.viewer.isDirty(), false);
});

test('すべてのページを外すと、切ってあるページを全部 1 世代で戻す', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  drawFrame(shell);
  key(shell, 'Enter');
  await shell.flush();
  drawFrame(shell, [10, 20, 300, 400], 1);
  key(shell, 'Enter');
  await shell.flush();
  assert.deepEqual(crops(shell), [BOX, [10, 20, 300, 400], null]);
  const depth = SigK.pageEdit.getHistoryState().depth;
  SigK.trimTool.setScope('all');
  assert.equal(await SigK.trimTool.remove(), true);

  assert.deepEqual(crops(shell), [null, null, null]);
  assert.equal(SigK.pageEdit.getHistoryState().depth, depth + 1);
});

test('外すのを待っている間にタブを替えたら当てない', async (t) => {
  let release = null;
  const B = 'C:\\work\\b.pdf';
  const shell = await withTrim(t, { boxesResults: [() => new Promise((resolve) => { release = resolve; })] });
  const { SigK } = shell;
  drawFrame(shell);
  key(shell, 'Enter');
  shell.files[B] = makeSource({ path: B, name: 'b.pdf' });
  const removing = SigK.trimTool.remove();
  await SigK.tabs.openPath(B);
  release({ ok: true, boxes: [PAPER, PAPER, PAPER] });

  assert.equal(await removing, false);
  assert.deepEqual(crops(shell), [null, null, null]);
});

test('切った範囲の外の書き込みは消えずに残り、外すとまた見える（決定64 ④）', async (t) => {
  const shell = await withTrim(t);
  const { SigK, document } = shell;
  // 切る範囲の外（紙の左下）に四角を描く。
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const from = viewport.convertToViewportPoint(20, 120);
  const to = viewport.convertToViewportPoint(80, 40);
  fire(shell, 'mousedown', pageNode(shell), from, 1);
  fire(shell, 'mousemove', document.body, to, 1);
  fire(shell, 'mouseup', pageNode(shell), to);
  const id = SigK.viewer.getAnnotations().added.at(-1).id;
  const drawn = () => pageNode(shell).querySelector(`.annot-layer g[data-annot="${id}"]`) !== null;
  assert.equal(drawn(), true);

  SigK.annotate.setTool('trim');
  drawFrame(shell);
  key(shell, 'Enter');
  await shell.flush();
  assert.deepEqual(crops(shell), [BOX, null, null]);
  assert.equal(SigK.viewer.getAnnotations().added.some((entry) => entry.id === id), true);

  document.getElementById('props-trim-remove').click();
  await shell.flush();
  assert.deepEqual(crops(shell), [null, null, null]);
  assert.equal(SigK.viewer.getAnnotations().added.some((entry) => entry.id === id), true);
  assert.equal(drawn(), true);
});

test('外すのを待つ間に切り直したら、待ち明けに外さず、帯で知らせる（点検 1）', async (t) => {
  let release = null;
  const shell = await withTrim(t, { boxesResults: [() => new Promise((resolve) => { release = resolve; })] });
  const { SigK } = shell;
  drawFrame(shell);
  key(shell, 'Enter');
  await shell.flush();
  const removing = SigK.trimTool.remove();
  // 待つ間に、同じページを切り直す。
  drawFrame(shell, [150, 250, 350, 550]);
  key(shell, 'Enter');
  release({ ok: true, boxes: [PAPER, PAPER, PAPER] });

  assert.equal(await removing, false);
  assert.deepEqual(crops(shell), [[150, 250, 350, 550], null, null]);
  assert.equal(SigK.viewBanner.text(), '読み込みを待つ間にページが変わったので、トリミングを外しませんでした。もう一度押してください。');
});

test('すべてのページで、枠が今の見える範囲と同じなら、何も積まず帯も出さない（点検 6）', async (t) => {
  const shell = await withTrim(t);
  const { SigK } = shell;
  SigK.trimTool.setScope('all');
  drawFrame(shell, [-50, -50, A4.width + 50, A4.height + 50]);
  key(shell, 'Enter');

  assert.deepEqual(crops(shell), [null, null, null]);
  assert.equal(SigK.viewBanner.isVisible(), false);
});
