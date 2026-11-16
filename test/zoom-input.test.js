'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

require('../renderer/viewer-layout.js');

// ツールバーの倍率の入力欄（spec-7-6 確定事項ZI1〜ZI4。docs/07 決定93）。ページ番号の欄と同じく、Enter キーかほかの所のクリック
// （change）で確定し、Esc キーで取り消す。

const A = 'C:\\work\\a.pdf';

async function openShell(t, { open = true } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) } });
  t.after(() => shell.cleanup());
  if (open)
    await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

const field = (shell) => shell.document.getElementById('zoom-value');

// 欄に打って（input）から、Enter キーか change で確定する。
function type(shell, text, how = 'enter') {
  const input = field(shell);
  input.focus();
  input.value = text;
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  if (how === 'enter')
    input.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  else if (how === 'change')
    input.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

test('parseZoomInput は「%」・全角・小数を受け、範囲外は最大・最小にし、数字でなければ null（ZI1・ZI2）', () => {
  const { parseZoomInput } = globalThis.SigK.viewerLayout;
  assert.equal(parseZoomInput('137'), 1.37);
  assert.equal(parseZoomInput(' 137 % '), 1.37);
  assert.equal(parseZoomInput('１３７％'), 1.37);
  assert.equal(parseZoomInput('137.5'), 1.38);
  assert.equal(parseZoomInput('2000'), 10);
  assert.equal(parseZoomInput('0'), 0.1);
  assert.equal(parseZoomInput('5', { min: 0.5, max: 3 }), 0.5);
  assert.equal(parseZoomInput('400', { min: 0.5, max: 3 }), 3);
  for (const text of ['', 'abc', '-50', '1e3', '50%%', '12a'])
    assert.equal(parseZoomInput(text), null, text);
});

test('入力して Enter キーを押すと、その倍率で表示し、［幅］の押した状態を解除する（ZI1・ZI3）', async (t) => {
  const shell = await openShell(t);
  const { SigK, document } = shell;
  SigK.viewer.applyFit('width');
  assert.equal(document.getElementById('btn-fit-width').classList.contains('active'), true);
  type(shell, '137');
  assert.equal(SigK.viewer.getState().zoom, 1.37);
  assert.equal(SigK.viewer.getState().fit, null);
  assert.equal(field(shell).value, '137%');
  assert.equal(document.getElementById('btn-fit-width').classList.contains('active'), false);
  // 段に無い倍率からも［＋］［－］は最も近い段へ動く（ZI2）。
  document.getElementById('zoom-in').dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(SigK.viewer.getState().zoom, 1.5);
});

test('ほかの所をクリックしたとき（change）も確定する。範囲外は最大・最小、数字でなければ元の倍率に戻す（ZI1・ZI2）', async (t) => {
  const shell = await openShell(t);
  const { SigK } = shell;
  type(shell, '2000', 'change');
  assert.equal(SigK.viewer.getState().zoom, 10);
  assert.equal(field(shell).value, '1000%');
  type(shell, '3', 'change');
  assert.equal(SigK.viewer.getState().zoom, 0.1);
  type(shell, 'abc', 'change');
  assert.equal(SigK.viewer.getState().zoom, 0.1, '数字でないときは倍率を変えない');
  assert.equal(field(shell).value, '10%', '元の倍率の表示に戻す');
});

test('Esc キーは入力を取り消して元の倍率の表示に戻し、倍率は変えない（ZI1）', async (t) => {
  const shell = await openShell(t);
  const { SigK } = shell;
  const before = SigK.viewer.getState().zoom;
  type(shell, '250', 'none');
  field(shell).dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(SigK.viewer.getState().zoom, before);
  assert.equal(field(shell).value, SigK.viewerLayout.formatZoom(before));
  assert.notEqual(shell.document.activeElement, field(shell), '欄から抜ける');
});

test('入力している途中は、倍率が変わっても欄の数字を上書きしない', async (t) => {
  const shell = await openShell(t);
  type(shell, '24', 'none');
  shell.SigK.viewer.setZoom(2);
  assert.equal(field(shell).value, '24');
  field(shell).dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(shell.SigK.viewer.getState().zoom, 0.24, '段に無い 24% もそのまま使う');
});

test('ツールモードでは帯の倍率を変え、範囲は 50〜300%（ZI2）', async (t) => {
  const shell = await openShell(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  const viewerZoom = SigK.viewer.getState().zoom;
  type(shell, '180');
  assert.equal(SigK.toolsZoom.get(), 1.8);
  assert.equal(field(shell).value, '180%');
  type(shell, '1000');
  assert.equal(SigK.toolsZoom.get(), 3);
  type(shell, '10');
  assert.equal(SigK.toolsZoom.get(), 0.5);
  assert.equal(SigK.viewer.getState().zoom, viewerZoom, '閲覧の倍率は変えない');
});

test('文書が無いときは入力欄も灰色で、打っても倍率は変わらない（ZI4）', async (t) => {
  const shell = await openShell(t, { open: false });
  assert.equal(field(shell).disabled, true);
  assert.equal(shell.SigK.zoomInput.commit(shell.document), false);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  assert.equal(field(shell).disabled, false);
  assert.equal(field(shell).hasAttribute('data-tip'), false, '文字を打つ欄にはツールチップを付けない（spec-2-5 確定事項J17）');
});
