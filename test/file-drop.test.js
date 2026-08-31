'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function withShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  return shell;
}

// jsdom は DragEvent を持たない。ドロップ側が読むのは dataTransfer と
// preventDefault だけなので、Event に載せて済ませる。
function fireDrag(shell, type, dataTransfer) {
  const event = new shell.window.Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = dataTransfer;
  shell.document.dispatchEvent(event);
  return event;
}

test('PDF をドロップするとタブで開く', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.name, 'a.pdf');
});

test('複数の PDF をまとめて落とすと、落とした順にタブが並ぶ', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([
    makeDroppedFile('a.pdf', A),
    makeDroppedFile('b.pdf', B),
  ]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 2);
  assert.deepEqual(
    [...shell.document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent),
    ['a.pdf', 'b.pdf'],
  );
});

test('PDF 以外が混ざっていれば、その分だけ無視する', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([
    makeDroppedFile('メモ.txt', 'C:\\work\\メモ.txt'),
    makeDroppedFile('a.pdf', A),
  ]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.name, 'a.pdf');
});

test('PDF が1つも無ければ理由を出す', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('表.xlsx', 'C:\\work\\表.xlsx')]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 0);
  assert.match(shell.document.getElementById('view-message').textContent, /PDF ファイルではありません/);
});

// File.path は Electron 32 で消えている。webUtils が空を返す状況（ドロップ
// 由来でない File など）でも、黙って何も起きないのではなく理由を出す。
test('パスが取れなければ、その旨を出す', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([{ name: 'a.pdf' }]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 0);
  assert.match(shell.document.getElementById('view-message').textContent, /場所を取得できませんでした/);
});

test('ドラッグ中は受け入れの表示が出て、落とすと消える', async (t) => {
  const shell = await withShell(t);
  const overlay = shell.document.getElementById('view-drop');

  assert.equal(overlay.hidden, true);

  fireDrag(shell, 'dragenter', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  assert.equal(overlay.hidden, false);

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  await shell.flush();
  assert.equal(overlay.hidden, true);
});

test('子要素をまたいで dragleave が飛んでも、表示は消えない', async (t) => {
  const shell = await withShell(t);
  const overlay = shell.document.getElementById('view-drop');
  const data = makeDataTransfer([makeDroppedFile('a.pdf', A)]);

  fireDrag(shell, 'dragenter', data);
  fireDrag(shell, 'dragenter', data);
  fireDrag(shell, 'dragleave', data);

  assert.equal(overlay.hidden, false, '入った数と出た数が釣り合うまでは出したままにする');
  assert.equal(shell.SigK.fileDrop.depth(), 1);

  fireDrag(shell, 'dragleave', data);
  assert.equal(overlay.hidden, true);
});

test('ファイルを運んでいないドラッグには反応しない', async (t) => {
  const shell = await withShell(t);
  const overlay = shell.document.getElementById('view-drop');

  const event = fireDrag(shell, 'dragenter', makeDataTransfer([], { types: ['text/plain'] }));

  assert.equal(overlay.hidden, true);
  assert.equal(event.defaultPrevented, false, '文字のドラッグまで奪ってはいけない');
});

test('ドロップの既定動作は必ず止める', async (t) => {
  const shell = await withShell(t);

  // 止めないと Chromium がそのファイルへページ遷移する。
  const dropped = fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  assert.equal(dropped.defaultPrevented, true);

  const over = fireDrag(shell, 'dragover', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  assert.equal(over.defaultPrevented, true);
  await shell.flush();
});

test('同じファイルを2回落としてもタブは1枚のまま', async (t) => {
  const shell = await withShell(t);
  const data = () => makeDataTransfer([makeDroppedFile('a.pdf', A)]);

  fireDrag(shell, 'drop', data());
  await shell.flush();
  fireDrag(shell, 'drop', data());
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
});
