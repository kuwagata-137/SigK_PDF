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

// ---- 変換画面は画像を受ける（spec-3-1 確定事項2） ----

const IMG = 'C:\\photo\\a.png';
const IMAGE_INFOS = { [IMG]: { kind: 'png', width: 1200, height: 800 } };

test('変換画面を選んでいるときは画像を受け、一覧へ足す', async (t) => {
  const shell = await withShell(t, { imageInfos: IMAGE_INFOS });
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG)]));
  await shell.flush();

  assert.equal(shell.SigK.toolsConvert.rows().length, 1);
  assert.equal(shell.SigK.toolsConvert.rows()[0].path, IMG);
  assert.equal(shell.SigK.tabs.count(), 0, 'タブでは開かない');
});

test('変換画面は BMP・GIF・TIFF の拡張子も受ける（spec-3-2 確定事項33）', async (t) => {
  const extra = { 'C:\\photo\\b.bmp': { kind: 'bmp', width: 10, height: 10 }, 'C:\\photo\\c.gif': { kind: 'gif', width: 10, height: 10 }, 'C:\\photo\\d.tif': { kind: 'tiff', width: 10, height: 10 }, 'C:\\photo\\e.TIFF': { kind: 'tiff', width: 10, height: 10 } };
  const shell = await withShell(t, { imageInfos: { ...IMAGE_INFOS, ...extra } });
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');

  fireDrag(shell, 'drop', makeDataTransfer(Object.keys(extra).map((filePath) => makeDroppedFile(filePath.split('\\').pop(), filePath))));
  await shell.flush();
  assert.equal(shell.SigK.toolsConvert.rows().map((row) => row.kind).join(','), 'bmp,gif,tiff,tiff');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('x.webp', 'C:\\photo\\x.webp')]));
  await shell.flush();
  assert.equal(shell.SigK.toolsConvert.rows().length, 4);
  assert.equal(shell.document.getElementById('view-banner').textContent, '画像ファイルではありません。PNG・JPEG・BMP・GIF・TIFF を落としてください。');
});

test('変換画面のほかでは画像を断り、PDF だけを受ける', async (t) => {
  const shell = await withShell(t, { imageInfos: IMAGE_INFOS });
  const message = () => shell.document.getElementById('view-message').textContent;

  // 閲覧中は従来どおり。画像は開かない。
  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG)]));
  await shell.flush();
  assert.equal(shell.SigK.tabs.count(), 0);
  assert.equal(message(), 'PDF ファイルではありません。PDF を落としてください。');

  // 結合の画面でも画像は受けない。
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG)]));
  await shell.flush();
  assert.equal(shell.SigK.toolsMerge.rows().length, 0);

  // 変換画面では PDF を受けない。
  shell.SigK.tools.select('convert');
  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  await shell.flush();
  assert.equal(shell.SigK.toolsConvert.rows().length, 0);
  assert.equal(shell.SigK.tabs.count(), 0);
});
