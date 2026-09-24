'use strict';

// 透かしのプレビュー（spec-4-5 確定事項5）。jsdom には 2D コンテキストが無いので、ページの絵は
// 寸法だけで、透かしの SVG（位置・向き・大きさ・色・不透明度）とページ送りを見る。見た目は起動確認で見る。
// page.render まで届かないので、どのページを描いたかは getViewport の呼び出し（viewportCalls）で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const LOGO = 'C:\\work\\logo.png';
const A4 = { width: 595.28, height: 841.89 };

async function createPreviewShell(t, { rotations = null } = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }) },
    pdfjs: createPdfjsStub({ sizes: [A4, A4, A4], rotations }),
    watermarkImages: { [LOGO]: { kind: 'png', width: 400, height: 200 } },
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('watermark');
  return shell;
}

const byId = (shell, id) => shell.document.getElementById(id);
const fmt = (value) => String(Math.round(value * 1000) / 1000);

async function settle(shell) {
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
}

function expectedTransform(shell, { box = [0, 0, A4.width, A4.height], rotate = 0, width, height, angle = 45, size = 'medium', position = 'center' }) {
  const placed = shell.SigK.watermarkGeometry.displayPlacementOf({ box, rotate, width, height, angle, size, position });
  return `translate(${fmt(placed.cx)} ${fmt(placed.cy)}) rotate(${fmt(-placed.angle)}) scale(${fmt(placed.scale)})`;
}

test('対象が無いうちは案内だけを出し、ページ送りは押せない', async (t) => {
  const shell = await createPreviewShell(t);
  assert.equal(byId(shell, 'wm-preview-empty').hidden, false);
  assert.equal(byId(shell, 'wm-preview-cap').textContent, '');
  assert.equal(byId(shell, 'wm-preview-prev').getAttribute('aria-disabled'), 'true');
  assert.equal(byId(shell, 'wm-preview-next').getAttribute('aria-disabled'), 'true');
  assert.equal(byId(shell, 'wm-preview-overlay').children.length, 0);
});

test('対象を決めると 1 ページ目に文字の透かしを、保存と同じ幾何で重ねる', async (t) => {
  const shell = await createPreviewShell(t);
  await shell.SigK.toolsWatermark.setSource(A);
  await settle(shell);
  assert.equal(byId(shell, 'wm-preview-empty').hidden, true);
  assert.equal(byId(shell, 'wm-preview-cap').textContent, '1 ページ目（全 3 ページ）');
  const overlay = byId(shell, 'wm-preview-overlay');
  assert.equal(overlay.getAttribute('viewBox'), '0 0 595.28 841.89');
  const group = overlay.querySelector('g');
  // jsdom の幅の見積もりは全角 1 字 = 100（大きさ 100）で、保存側の Noto Sans JP と同じ 300。
  assert.equal(group.getAttribute('transform'), expectedTransform(shell, { width: 300, height: 144.8 }));
  const text = group.querySelector('text');
  assert.equal(text.textContent, '社外秘');
  assert.equal(text.getAttribute('fill'), '#808080');
  assert.equal(text.getAttribute('fill-opacity'), '0.3');
  assert.equal(text.getAttribute('y'), '43.6');
  assert.equal(text.getAttribute('text-anchor'), 'middle');
  assert.equal(byId(shell, 'wm-preview-next').getAttribute('aria-disabled'), null);
});

test('設定を変えると透かしだけを組み直し、ページの絵は描き直さない', async (t) => {
  const shell = await createPreviewShell(t);
  await shell.SigK.toolsWatermark.setSource(A);
  await settle(shell);
  const drawn = shell.pdfjs.viewportCalls.length;
  shell.SigK.toolsWatermark.setAngle(0);
  shell.SigK.toolsWatermark.setPosition('bottom-left');
  shell.SigK.toolsWatermark.setSize('small');
  shell.SigK.toolsWatermark.setColor('#2c5cd9');
  const group = byId(shell, 'wm-preview-overlay').querySelector('g');
  assert.equal(group.getAttribute('transform'), expectedTransform(shell, { width: 300, height: 144.8, angle: 0, size: 'small', position: 'bottom-left' }));
  assert.equal(group.querySelector('text').getAttribute('fill'), '#2c5cd9');
  assert.equal(shell.pdfjs.viewportCalls.length, drawn);
});

test('ページを送れて、透かしを入れないページは透かし無しで見せる', async (t) => {
  const shell = await createPreviewShell(t);
  await shell.SigK.toolsWatermark.setSource(A);
  await settle(shell);
  shell.SigK.toolsWatermark.setPageMode('range');
  shell.SigK.toolsWatermark.setRange('1');
  byId(shell, 'wm-preview-next').click();
  await settle(shell);
  assert.equal(shell.SigK.watermarkPreview.pageIndex(), 1);
  assert.equal(byId(shell, 'wm-preview-cap').textContent, '2 ページ目（全 3 ページ）（透かしを入れないページ）');
  assert.equal(byId(shell, 'wm-preview-overlay').children.length, 0);
  assert.equal(shell.pdfjs.viewportCalls.at(-1).page, 2);
  byId(shell, 'wm-preview-prev').click();
  await settle(shell);
  assert.equal(byId(shell, 'wm-preview-cap').textContent, '1 ページ目（全 3 ページ）');
  assert.equal(byId(shell, 'wm-preview-prev').getAttribute('aria-disabled'), 'true');
});

test('範囲を先に決めていれば、透かしを入れる最初のページから見せる', async (t) => {
  const shell = await createPreviewShell(t);
  shell.SigK.toolsWatermark.setPageMode('range');
  shell.SigK.toolsWatermark.setRange('3');
  await shell.SigK.toolsWatermark.setSource(A);
  await settle(shell);
  assert.equal(shell.SigK.watermarkPreview.pageIndex(), 2);
  assert.equal(byId(shell, 'wm-preview-cap').textContent, '3 ページ目（全 3 ページ）');
});

test('/Rotate 90 のページでは表示の縦横で置く（保存と同じ）', async (t) => {
  const shell = await createPreviewShell(t, { rotations: [90, 0, 0] });
  await shell.SigK.toolsWatermark.setSource(A);
  await settle(shell);
  const overlay = byId(shell, 'wm-preview-overlay');
  assert.equal(overlay.getAttribute('viewBox'), '0 0 841.89 595.28');
  assert.equal(overlay.querySelector('g').getAttribute('transform'), expectedTransform(shell, { rotate: 90, width: 300, height: 144.8 }));
});

test('画像の透かしは、幅 100 の箱に縦横比で置いた画像を重ねる', async (t) => {
  const shell = await createPreviewShell(t);
  await shell.SigK.toolsWatermark.setSource(A);
  await shell.SigK.toolsWatermark.setImage(LOGO);
  await settle(shell);
  const group = byId(shell, 'wm-preview-overlay').querySelector('g');
  assert.equal(group.getAttribute('transform'), expectedTransform(shell, { width: 100, height: 50 }));
  const image = group.querySelector('image');
  assert.deepEqual(['x', 'y', 'width', 'height', 'opacity'].map((key) => image.getAttribute(key)), ['-50', '-25', '100', '50', '0.3']);
});
