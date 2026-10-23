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
  assert.match(shell.document.getElementById('view-message').textContent, /PDF ファイルではないので/);
});

// File.path は Electron 32 で消えている。webUtils が空を返す状況（ドロップ
// 由来でない File など）でも、黙って何も起きないのではなく理由を出す。
test('パスが取れなければ、その旨を出す', async (t) => {
  const shell = await withShell(t);

  fireDrag(shell, 'drop', makeDataTransfer([{ name: 'a.pdf' }]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 0);
  assert.match(shell.document.getElementById('view-message').textContent, /場所を取得できなかったので/);
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
  assert.equal(shell.document.getElementById('view-banner').textContent, 'PDF でも画像でもないので、PDF か画像（PNG・JPEG・BMP・GIF・TIFF）をドロップしてください。');
});

test('閲覧モードでは画像を断り、PDF だけを受ける', async (t) => {
  const shell = await withShell(t, { imageInfos: IMAGE_INFOS });
  const message = () => shell.document.getElementById('view-message').textContent;

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG)]));
  await shell.flush();
  assert.equal(shell.SigK.tabs.count(), 0);
  assert.equal(message(), 'PDF ファイルではないので、PDF をドロップしてください。');
  assert.equal(shell.SigK.toolsConvert.rows().length, 0);
});

// ---- ツールモードのドロップもタブで開く（決定80） ----
//
// 今までは選んでいるツールにだけ渡し、タブでは開かなかった。起動時にツールモードで PDF を 2 つ落としても
// サムネイルが出ず、閲覧モードへ移ってもページが出なかった（ユーザーの報告）。どのモードで落としてもタブで開き、
// モードは変えない。結合は開いたタブ（帯）がそのまま行になる（spec-2-5 確定事項E2）。ほかのツールには、移り期間として今までどおり渡す（tool-handoff.js）。

const modeOf = (shell) => shell.document.documentElement.getAttribute('data-mode');
const tabPaths = (shell) => structuredClone(shell.SigK.tabs.list().map((tab) => tab.path));
const mergePaths = (shell) => structuredClone(shell.SigK.toolsMerge.rows().map((row) => row.path));
const convertPaths = (shell) => structuredClone(shell.SigK.toolsConvert.rows().map((row) => row.path));

// 前回の見た目の復元が届くのを待ってからツールモードへ入る（tools-merge.test.js と同じ）。
async function inTools(t, tool, options = {}) {
  const shell = await withShell(t, { imageInfos: IMAGE_INFOS, ...options });
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
  return shell;
}

test('【要】ツールモードで PDF を 2 つ落とすと、タブが 2 枚でき、ツールモードのまま、結合の一覧にも 2 つ入る', async (t) => {
  const shell = await inTools(t, 'merge');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A), makeDroppedFile('b.pdf', B)]));
  await shell.flush();

  assert.deepEqual(tabPaths(shell), [A, B], '落とした順にタブが並ぶ');
  assert.equal(modeOf(shell), 'tools');
  assert.deepEqual(mergePaths(shell), [A, B]);
  // 閲覧モードへ移れば、最後に開いたファイルのページが見える。
  shell.SigK.shell.setMode(shell.document, 'view');
  assert.equal(shell.SigK.viewer.getState().file.name, 'b.pdf');
});

test('結合を選んでいるときに画像を落とすと、画像→PDF に切り替えて一覧へ足す', async (t) => {
  const shell = await inTools(t, 'merge');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG)]));
  await shell.flush();

  assert.equal(shell.SigK.tools.selected(), 'convert');
  assert.deepEqual(convertPaths(shell), [IMG]);
  assert.deepEqual(mergePaths(shell), []);
  assert.equal(shell.SigK.tabs.count(), 0, '画像はタブにしない');
});

test('PDF と画像を一緒に落とすと、PDF はタブと結合の一覧へ、画像は画像→PDF の一覧へ入る', async (t) => {
  const shell = await inTools(t, 'merge');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.png', IMG), makeDroppedFile('a.pdf', A)]));
  await shell.flush();

  assert.deepEqual(tabPaths(shell), [A]);
  assert.deepEqual(mergePaths(shell), [A]);
  assert.deepEqual(convertPaths(shell), [IMG]);
  assert.equal(shell.SigK.tools.selected(), 'convert', '画像を足した画像→PDF を見せる');
});

test('画像→PDF を選んでいるときに PDF を落とすと、タブで開くだけで、変換の一覧には入れない', async (t) => {
  const shell = await inTools(t, 'convert');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('a.pdf', A)]));
  await shell.flush();

  assert.deepEqual(tabPaths(shell), [A]);
  assert.deepEqual(convertPaths(shell), []);
  assert.equal(shell.SigK.tools.selected(), 'convert');
  assert.equal(modeOf(shell), 'tools');
});

// 分割の対象は選んでいる帯なので、最後に開いた帯が ✂ の盤になる。どの帯も盤にできるので、「1つ目のファイルだけを対象にしました。」の通知バーは出さない（spec-2-5 確定事項G13）。
test('分割を選んでいるときに PDF を 2 つ落とすと、タブは 2 枚、分割の対象は最後に開いた帯', async (t) => {
  const shell = await inTools(t, 'split');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('b.pdf', B), makeDroppedFile('a.pdf', A)]));
  await shell.flush();

  assert.deepEqual(tabPaths(shell), [B, A]);
  assert.equal(shell.SigK.toolsSplit.source().path, A);
  assert.notEqual(shell.SigK.viewBanner.text(), shell.SigK.toolsSplit.NOTE_FIRST_ONLY);
});

test('ツールモードで PDF でも画像でもないものだけを落とすと、理由を通知バーで出す', async (t) => {
  const shell = await inTools(t, 'merge');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('表.xlsx', 'C:\\work\\表.xlsx')]));
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 0);
  assert.equal(shell.SigK.viewBanner.text(), 'PDF でも画像でもないので、PDF か画像（PNG・JPEG・BMP・GIF・TIFF）をドロップしてください。');
});

test('透かしを選んでいるときは、透かしの画像に使えない BMP を断る', async (t) => {
  const BMP = 'C:\\photo\\b.bmp';
  const shell = await inTools(t, 'watermark', { imageInfos: { [BMP]: { kind: 'bmp', width: 10, height: 10 } } });

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('b.bmp', BMP)]));
  await shell.flush();

  assert.equal(shell.SigK.tools.selected(), 'watermark', '画像→PDF へは切り替えない');
  assert.deepEqual(convertPaths(shell), []);
  assert.equal(shell.SigK.viewBanner.text(), 'PDF でも PNG・JPEG でもないので、PDF か PNG・JPEG の画像をドロップしてください。');
});

test('ツールモードで落とした PDF のうち読めなかったものの理由は、後のタブを開いても帯に残る', async (t) => {
  const GONE = 'C:\\work\\消えた.pdf';
  const shell = await inTools(t, 'merge');

  fireDrag(shell, 'drop', makeDataTransfer([makeDroppedFile('消えた.pdf', GONE), makeDroppedFile('a.pdf', A)]));
  await shell.flush();

  assert.deepEqual(tabPaths(shell), [A]);
  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.equal(shell.SigK.viewBanner.text(), '読み込み結果が用意されていません。');
  // 結合は帯（＝タブ）を対象にする（spec-2-5 確定事項E2）ので、読めずにタブにならなかったファイルは結合の行にも入らない。
  assert.deepEqual(mergePaths(shell), [A]);
});
