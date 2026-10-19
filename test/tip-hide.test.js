'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 説明の吹き出しを消す（spec-2-5 J1・J6・J10・J11・J13。tip.js・tip-view.js）。出す方は tip.test.js。
// この時点の index.html の要素はまだ title を持つので、テストの中で対象の要素に data-tip を付けてから流す。
// 待ち時間は小さくし（DELAY_MS 30・GRACE_MS 200）、待つのは window.setTimeout の実時間。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'view') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  shell.SigK.tip.DELAY_MS = 30;
  shell.SigK.tip.GRACE_MS = 200;
  return shell;
}

function pointer(shell, type, node, init = {}) {
  node.dispatchEvent(new shell.window.PointerEvent(type, { bubbles: true, buttons: 0, pointerType: 'mouse', ...init }));
}
const over = (shell, node, init) => pointer(shell, 'pointerover', node, init);
const out = (shell, node, to = shell.document.body) => pointer(shell, 'pointerout', node, { relatedTarget: to });
const sleep = (shell, ms) => new Promise((resolve) => shell.window.setTimeout(resolve, ms));

// ツールバーの［上書き保存］に data-tip を付けて、説明の吹き出しを出したところで返す。
async function shownOnSave(shell) {
  const save = shell.document.getElementById('btn-save');
  save.dataset.tip = 'bar.save';
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(shell.SigK.tip.isShown(), true, '前提: 出ている');
  return save;
}

test('押すと消え、同じ対象の上にいる間は出し直さない。出て入り直すと、また出す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  document.getElementById('btn-save').setAttribute('aria-describedby', 'save-note');
  const save = await shownOnSave(shell);
  assert.equal(save.getAttribute('aria-describedby'), 'tip');
  pointer(shell, 'pointerdown', save, { buttons: 1 });
  assert.equal(SigK.tip.isShown(), false);
  assert.equal(document.getElementById('tip').hidden, true);
  assert.equal(save.getAttribute('aria-describedby'), 'save-note', '消すと元の aria-describedby に戻す');
  pointer(shell, 'pointerup', save);
  over(shell, save.firstElementChild);
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false, '押した対象の上にいる間は出し直さない');
  out(shell, save);
  over(shell, save);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '出て入り直すと、また出す');
});

test('Esc を押すと説明の吹き出しが消え、同じ 1 回で道具も外れる（決定80 ㊸）', async (t) => {
  const shell = await withShell(t, 'annot');
  const { SigK, document, window } = shell;
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind('square');
  await shownOnSave(shell);
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  assert.equal(SigK.tip.isShown(), false);
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(event.defaultPrevented, true, 'Esc の取りやめは止めない');
});

const HIDE_CASES = [
  ['ホイール', (shell) => shell.document.getElementById('view').dispatchEvent(new shell.window.WheelEvent('wheel', { bubbles: true, deltaY: 100 }))],
  ['スクロール', (shell) => shell.document.getElementById('view').dispatchEvent(new shell.window.Event('scroll'))],
  ['窓の大きさが変わる', (shell) => shell.window.dispatchEvent(new shell.window.Event('resize'))],
  ['アプリが非活性になる', (shell) => shell.window.dispatchEvent(new shell.window.Event('blur'))],
];

for (const [label, fire] of HIDE_CASES) {
  test(`ホイール・スクロール・窓の大きさが変わる・アプリが非活性になると消える（${label}）`, async (t) => {
    const shell = await withShell(t);
    await shownOnSave(shell);
    fire(shell);
    assert.equal(shell.SigK.tip.isShown(), false);
  });
}

test('窓が開くと消える', async (t) => {
  const shell = await withShell(t);
  await shownOnSave(shell);
  shell.document.getElementById('help-dialog').setAttribute('open', '');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('モードが変わると消える', async (t) => {
  const shell = await withShell(t);
  await shownOnSave(shell);
  shell.SigK.shell.setMode(shell.document, 'tools');
  assert.equal(shell.SigK.tip.isShown(), false);
});

test('待っている間に対象が画面から消えたら出さない', async (t) => {
  const shell = await withShell(t, 'tools');
  const { SigK, document } = shell;
  SigK.strips.setShown(true);
  await shell.flush();
  const strip = document.querySelector('#strips .strip');
  const close = strip.querySelector('[data-act="close"]');
  close.dataset.tip = 'strip.close';
  over(shell, close);
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), true, '比べるため: 消えなければ出る');
  assert.equal(document.querySelector('#tip .tip-keys').textContent, 'キー: Ctrl+W（選んでいる帯）');
  SigK.tip.hide();
  over(shell, close);
  strip.remove();
  await sleep(shell, 60);
  assert.equal(SigK.tip.isShown(), false);
});

test('popover が使えるときは showPopover で出し、hidePopover で消す', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const tip = document.getElementById('tip');
  const calls = [];
  tip.showPopover = () => calls.push('show');
  tip.hidePopover = () => calls.push('hide');
  await shownOnSave(shell);
  assert.deepEqual(calls, ['hide', 'show'], 'いったん外してから出す（あとから開いた窓より前に出すため）');
  assert.equal(tip.hidden, false);
  SigK.tip.hide();
  assert.deepEqual(calls, ['hide', 'show', 'hide']);
  assert.equal(tip.hidden, true);
});
