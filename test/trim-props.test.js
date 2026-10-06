'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, A4 } = require('./harness.js');

// 右パネルのトリミングの行とボタン（spec-4b-6a 確定事項17・19。見本 screenshots/phase4b-6-trim-frame.png・-trim-applied.png）。

const A = 'C:\\work\\a.pdf';
const BOX = [100, 200, 400, 600];
const PAPER = [0, 0, A4.width, A4.height];

async function withShell(t, { pdfjs = createPdfjsStub(), ...options } = {}) {
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) }, ...options });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  await shell.flush();
  return shell;
}

async function holdTrim(shell) {
  shell.SigK.annotate.setTool('trim');
  await shell.flush();
}

function drawFrame(shell, box = BOX, index = 0) {
  const viewport = shell.SigK.viewer.getTextLayer(index).viewport;
  const node = shell.document.querySelector(`.pdf-page[data-page="${index + 1}"]`);
  const fire = (type, target, [x, y], buttons) => target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
  const from = viewport.convertToViewportPoint(box[0], box[3]);
  const to = viewport.convertToViewportPoint(box[2], box[1]);
  fire('mousedown', node, from, 1);
  fire('mousemove', shell.document.body, to, 1);
  fire('mouseup', node, to, 0);
}

// 右パネルの見えている行の名前と値、ボタン。
function panel(shell) {
  const doc = shell.document;
  const rows = [...doc.querySelectorAll('#props .props-body > .prop')].filter((row) => !row.hidden)
    .map((row) => [row.querySelector('.k').textContent, row.querySelector('.v')?.textContent ?? null]);
  const scopes = [...doc.querySelectorAll('#props-trim-scope button')].map((button) => `${button.textContent}:${button.getAttribute('aria-pressed')}`);
  const buttons = ['props-trim-cancel', 'props-trim-apply', 'props-trim-remove', 'props-delete']
    .filter((id) => { const node = doc.getElementById(id); return !node.hidden && !(node.closest('[hidden]')); })
    .map((id) => `${id}${doc.getElementById(id).getAttribute('aria-disabled') === 'true' ? '（押せない）' : ''}`);
  return { rows, scopes, buttons, hint: doc.getElementById('props-hint').textContent };
}

test('トリミングを持つと、種類・当てるページ・このページの状態と［トリミングを外す］を出し、ほかの行と［削除］を隠す', async (t) => {
  const shell = await withShell(t);
  await holdTrim(shell);
  const { HINTS } = shell.SigK.annotationHints;

  assert.deepEqual(panel(shell), {
    rows: [['種類', 'トリミング'], ['当てるページ', null], ['このページ', '紙全体のままです']],
    scopes: ['このページ:true', 'すべてのページ:false'],
    buttons: ['props-trim-remove（押せない）'],
    hint: HINTS.trim,
  });
});

test('枠を引くと、残す大きさと［取消］［適用］を出し、［取消］で枠を消す', async (t) => {
  const shell = await withShell(t);
  await holdTrim(shell);
  drawFrame(shell);

  assert.deepEqual(panel(shell).rows, [['種類', 'トリミング'], ['当てるページ', null], ['残す大きさ', '幅 106 mm × 高さ 141 mm']]);
  assert.deepEqual(panel(shell).buttons, ['props-trim-cancel', 'props-trim-apply']);
  shell.document.getElementById('props-trim-cancel').click();
  assert.equal(shell.SigK.annotateTrim.getFrame(), null);
  assert.deepEqual(panel(shell).buttons, ['props-trim-remove（押せない）']);
});

test('切ったページなら「切ってあります（大きさ）」と切り直しのヒントを出し、［トリミングを外す］を押せる', async (t) => {
  const shell = await withShell(t);
  await holdTrim(shell);
  drawFrame(shell);
  shell.document.getElementById('props-trim-apply').click();
  await shell.flush();

  const { rows, buttons, hint } = panel(shell);
  assert.deepEqual(rows.at(-1), ['このページ', '切ってあります（幅 106 mm × 高さ 141 mm）']);
  assert.deepEqual(buttons, ['props-trim-remove']);
  assert.equal(hint, shell.SigK.annotationHints.HINTS.trimCropped);
  // ページ番号の欄のページが替わると、そのページの状態に替わる。
  shell.SigK.viewer.goToPage(1);
  assert.deepEqual(panel(shell).rows.at(-1), ['このページ', '紙全体のままです']);
  // 元に戻すと、切っていない状態に戻る。
  shell.SigK.viewer.goToPage(0);
  shell.SigK.pageEdit.undo();
  assert.deepEqual(panel(shell).rows.at(-1), ['このページ', '紙全体のままです']);
});

test('［すべてのページ］を押すと切り替わり、切ってあるページの数を出す', async (t) => {
  const shell = await withShell(t);
  await holdTrim(shell);
  shell.document.querySelector('#props-trim-scope button[data-scope="all"]').click();
  assert.deepEqual(panel(shell).scopes, ['このページ:false', 'すべてのページ:true']);
  assert.deepEqual(panel(shell).rows.at(-1), ['すべてのページ', 'どのページも紙全体のままです']);
  drawFrame(shell);
  shell.document.getElementById('props-trim-apply').click();

  assert.deepEqual(panel(shell).rows.at(-1), ['すべてのページ', '3 ページを切ってあります']);
});

test('ほかのアプリで切ってあるページは、紙全体を読み終えると「切ってあります」になる', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 400, height: 500 }, A4, A4], views: [[50, 60, 450, 560]] });
  const shell = await withShell(t, { pdfjs, boxesResults: [{ ok: true, boxes: [PAPER, PAPER, PAPER] }] });
  await holdTrim(shell);

  assert.deepEqual(panel(shell).rows.at(-1), ['このページ', '切ってあります（幅 141 mm × 高さ 176 mm）']);
  assert.deepEqual(panel(shell).buttons, ['props-trim-remove']);
});

test('道具を替えると、トリミングの行とボタンを隠して［削除］を戻す', async (t) => {
  const shell = await withShell(t);
  await holdTrim(shell);
  shell.SigK.annotate.setTool('pen');

  const { rows, buttons } = panel(shell);
  assert.equal(rows.some(([name]) => ['当てるページ', 'このページ', '残す大きさ'].includes(name)), false);
  assert.deepEqual(buttons, ['props-delete（押せない）']);
});
