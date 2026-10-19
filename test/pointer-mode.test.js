'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 閲覧の［選択］［ハンド］の状態とツールバーの 1 組（spec-2-5 確定事項K2・K3・K7・K8・K11。決定80 ㉒〜㉕。
// 見本 screenshots/strips1-view-hand.png）。状態（viewPointer）はアプリ全体で 1 つで、選んだら覚える。

const A = 'C:\\work\\a.pdf';

async function withShell(t, { open = true, ui } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) }, ...(ui === undefined ? {} : { ui }) });
  t.after(() => shell.cleanup());
  await shell.flush();
  if (open) {
    await shell.SigK.tabs.openPath(A);
    await shell.flush();
  }
  return shell;
}

function click(shell, id) {
  const node = shell.document.getElementById(id);
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
}

// 押している方の印（active・aria-pressed）と、押せるか（aria-disabled）。
function bar(shell) {
  const read = (id) => {
    const node = shell.document.getElementById(id);
    return { on: node.classList.contains('active'), pressed: node.getAttribute('aria-pressed'), disabled: node.getAttribute('aria-disabled') };
  };
  return { select: read('btn-pointer-select'), hand: read('btn-pointer-hand') };
}

function pressedOf(shell) {
  const { select, hand } = bar(shell);
  assert.equal(select.on, select.pressed === 'true', '印と aria-pressed が食い違う');
  assert.equal(hand.on, hand.pressed === 'true', '印と aria-pressed が食い違う');
  if (select.on && hand.on)
    assert.fail('両方を押している');
  return select.on ? 'select' : (hand.on ? 'hand' : null);
}

test('ツールバーの［元に戻す］［やり直し］の右に、区切りと［選択］［ハンド］の 1 組が並ぶ（K2）', async (t) => {
  const { document, SigK } = await withShell(t, { open: false });
  const group = document.getElementById('pointer-mode');

  assert.notEqual(group, null, '1 組が無い');
  assert.equal(group.className, 'tb-seg');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), '紙の上のマウスの働き');
  assert.equal(group.previousElementSibling.className, 'tb-sep');
  assert.equal(group.previousElementSibling.previousElementSibling.id, 'btn-redo');
  assert.equal(group.nextElementSibling.className, 'tb-sep');
  assert.deepEqual([...group.children].map((el) => el.id), ['btn-pointer-select', 'btn-pointer-hand']);
  for (const [id, icon, label, tip] of [
    ['btn-pointer-select', 'pointerSelect', '選択', 'bar.pointerSelect'],
    ['btn-pointer-hand', 'hand', 'ハンド', 'bar.pointerHand'],
  ]) {
    const node = document.getElementById(id);
    assert.equal(node.className.split(' ')[0], 'tb-btn', id);
    assert.equal(node.getAttribute('role'), 'button', id);
    assert.equal(node.textContent.trim(), label, id);
    assert.equal(node.getAttribute('aria-label'), label, id);
    assert.equal(node.dataset.tip, tip, id);
    assert.equal(SigK.tipContent.resolve(node).name, label, id);
    assert.notEqual(node.querySelector(`[data-icon="${icon}"] svg`), null, `${id} の絵が描かれていない`);
  }
});

test('既定は［選択］を押した形で、html の data-pointer は select（K7）', async (t) => {
  const shell = await withShell(t);

  assert.equal(shell.SigK.pointerMode.get(), 'select');
  assert.equal(shell.document.documentElement.getAttribute('data-pointer'), 'select');
  assert.equal(pressedOf(shell), 'select');
  assert.equal(bar(shell).select.disabled, 'false');
  assert.equal(bar(shell).hand.disabled, 'false');
});

test('閲覧で［ハンド］を押すとハンドになって覚え、押している方をもう一度押しても変わらない（K7・K5）', async (t) => {
  const shell = await withShell(t);
  const before = shell.uiCalls.length;

  click(shell, 'btn-pointer-hand');
  assert.equal(shell.SigK.pointerMode.get(), 'hand');
  assert.equal(shell.document.documentElement.getAttribute('data-pointer'), 'hand');
  assert.equal(pressedOf(shell), 'hand');
  assert.deepEqual(shell.uiCalls.slice(before), [{ viewPointer: 'hand' }]);

  click(shell, 'btn-pointer-hand');
  assert.equal(shell.SigK.pointerMode.get(), 'hand', '押している方を押しても選択へ戻らない');
  assert.equal(shell.uiCalls.length, before + 1, '変わらなければ覚え直さない');

  click(shell, 'btn-pointer-select');
  assert.equal(shell.SigK.pointerMode.get(), 'select');
  assert.equal(pressedOf(shell), 'select');
  assert.deepEqual(shell.uiCalls.slice(before + 1), [{ viewPointer: 'select' }]);
});

test('ページ編集でも押して切り替えられ、ツールモードでは灰色で押しても変わらない（K3・K11）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;

  SigK.shell.setMode(document, 'pages');
  click(shell, 'btn-pointer-hand');
  assert.equal(SigK.pointerMode.get(), 'hand');
  assert.equal(pressedOf(shell), 'hand');

  SigK.shell.setMode(document, 'tools');
  assert.equal(bar(shell).select.disabled, 'true');
  assert.equal(bar(shell).hand.disabled, 'true');
  // ツールモードでも、いまの方を押した形で見せる（見本 screenshots/strips1-tools.png）。
  assert.equal(pressedOf(shell), 'hand');
  click(shell, 'btn-pointer-select');
  assert.equal(SigK.pointerMode.get(), 'hand', 'ツールモードでは押せない');

  SigK.shell.setMode(document, 'view');
  assert.equal(bar(shell).select.disabled, 'false');
  assert.equal(pressedOf(shell), 'hand', 'モードを替えても最後に選んだ方が続く（K5）');
});

test('文書が開いていなくても、閲覧では押せる（K11）', async (t) => {
  const shell = await withShell(t, { open: false });

  assert.equal(bar(shell).hand.disabled, 'false');
  click(shell, 'btn-pointer-hand');
  assert.equal(shell.SigK.pointerMode.get(), 'hand');
});

test('編集モードでは 1 組が編集の道具を映し、押すと道具の段と同じに道具を持つ・離す（K8）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'annot');

  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(pressedOf(shell), null, '道具なしではどちらも押していない形');

  click(shell, 'btn-pointer-select');
  assert.equal(SigK.annotate.getTool(), 'select');
  assert.equal(pressedOf(shell), 'select');
  assert.equal(document.querySelector('#edit-bar [data-tool="select"]').getAttribute('aria-pressed'), 'true', '道具の段も同じ印');

  SigK.annotate.toggleTool('pen');
  assert.equal(pressedOf(shell), null, '描く道具ではどちらも押していない形');

  click(shell, 'btn-pointer-hand');
  assert.equal(SigK.annotate.getTool(), 'hand');
  assert.equal(pressedOf(shell), 'hand');
  click(shell, 'btn-pointer-hand');
  assert.equal(SigK.annotate.getTool(), null, '同じボタンをもう一度押すと道具なし');
  assert.equal(pressedOf(shell), null);
});
