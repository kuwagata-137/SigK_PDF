'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 閲覧・ページ編集の左＋右の同時押し（spec-2-5 確定事項K4・K7・K14）。ページの表示の上で左と右の両方を押すと、［選択］と［ハンド］を
// 入れ替えて覚える。編集モードの今の仕組み（spec-4b-3b 確定事項E。annotate-right-button.js）を広げたもので、押している操作の
// 取りやめ・全部離すまで捨てる・続くダブルクリックを捨てるのも同じ。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'view') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  return shell;
}

function pageNode(shell) {
  return shell.document.querySelector('.pdf-page[data-page="1"]');
}

function view(shell) {
  return shell.document.getElementById('view');
}

// buttons は押している間のボタン（1 左・2 右・3 両方）。detail は続けて押した回数。
function fire(shell, type, target, [x, y], { button = 0, buttons = 0, detail = 1 } = {}) {
  const event = new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button, buttons, detail });
  target.dispatchEvent(event);
  return event;
}

// 左を押し、右を押し、全部離す。右の押しの event を返す。
function chord(shell, at = [300, 300]) {
  fire(shell, 'mousedown', pageNode(shell), at, { button: 0, buttons: 1 });
  const right = fire(shell, 'mousedown', pageNode(shell), at, { button: 2, buttons: 3 });
  fire(shell, 'mouseup', pageNode(shell), at, { button: 0, buttons: 2 });
  fire(shell, 'mouseup', pageNode(shell), at, { button: 2, buttons: 0 });
  return right;
}

for (const mode of ['view', 'pages']) {
  test(`${mode === 'view' ? '閲覧' : 'ページ編集'}の左＋右は、選択とハンドを入れ替えて覚え、ツールバーの印も替わる（K4・K7）`, async (t) => {
    const shell = await withShell(t, mode);
    const { SigK, document } = shell;
    const before = shell.uiCalls.length;

    assert.equal(chord(shell).defaultPrevented, true);
    assert.equal(SigK.pointerMode.get(), 'hand');
    assert.equal(document.getElementById('btn-pointer-hand').classList.contains('active'), true);
    assert.equal(document.documentElement.hasAttribute('data-panning'), false, '左＋右の左の押しでは引き始めない');
    chord(shell);
    assert.equal(SigK.pointerMode.get(), 'select');
    assert.deepEqual(shell.uiCalls.slice(before), [{ viewPointer: 'hand' }, { viewPointer: 'select' }]);
  });
}

test('右を先に押してから左を押しても、切り替えは 1 回だけ。全部離すまでの押しでは切り替えない（K4。spec-4b-3b 確定事項E3）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 2, buttons: 2 });
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 3 });
  assert.equal(SigK.pointerMode.get(), 'hand');
  fire(shell, 'mouseup', pageNode(shell), [300, 300], { button: 2, buttons: 1 });
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 2, buttons: 3 });
  assert.equal(SigK.pointerMode.get(), 'hand', '全部離すまでは 2 回目を数えない');
  fire(shell, 'mouseup', pageNode(shell), [300, 300], { button: 0, buttons: 0 });
});

test('ハンドで引いている途中に右を押すと、引くのを終えて選択へ戻り、離すまで動かない（K4）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.pointerMode.press('hand');
  fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 1 });
  fire(shell, 'mousemove', document.body, [300, 250], { buttons: 1 });
  assert.equal(view(shell).scrollTop, 50);

  fire(shell, 'mousedown', pageNode(shell), [300, 250], { button: 2, buttons: 3 });
  assert.equal(SigK.pointerMode.get(), 'select');
  assert.equal(document.documentElement.hasAttribute('data-panning'), false);
  fire(shell, 'mousemove', document.body, [300, 100], { buttons: 3 });
  assert.equal(view(shell).scrollTop, 50, '左＋右の後は動かない');
  fire(shell, 'mouseup', document.body, [300, 100], { button: 0, buttons: 0 });
});

test('左＋右の直後の 2 回目の押しは、紙の単語が選ばれないよう既定の動きを止める。1 秒たてば止めない（K14）', async (t) => {
  const shell = await withShell(t);
  const { SigK, window } = shell;
  let clock = 5000;
  window.performance.now = () => clock;

  chord(shell);
  const second = fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 1, detail: 2 });
  assert.equal(second.defaultPrevented, true);
  fire(shell, 'mouseup', pageNode(shell), [300, 300], { button: 0, buttons: 0, detail: 2 });

  // 選択に戻してから 1 秒より後の押しは、ふつうのダブルクリック（単語を選ぶ）。
  chord(shell);
  assert.equal(SigK.pointerMode.get(), 'select');
  clock += SigK.annotateRightButton.CHORD_IGNORE_MS + 1;
  const later = fire(shell, 'mousedown', pageNode(shell), [300, 300], { button: 0, buttons: 1, detail: 2 });
  assert.equal(later.defaultPrevented, false);
  fire(shell, 'mouseup', pageNode(shell), [300, 300], { button: 0, buttons: 0 });
});
