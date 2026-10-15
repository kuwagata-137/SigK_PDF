'use strict';

// ツールモードで開く（決定80）。
//
// ファイルはどのモードで開いてもタブで開き、モードは変えない。ツールモードではページビューがツールの画面の下に
// 隠れるので、開けなかった理由は帯で出す。［開く］・ドロップ・エクスプローラーからの起動で開いたファイルは帯（タブ）になり、
// 帯を対象にするツールは、その帯をそのまま使う（ツールへの受け渡しは spec-2-5 確定事項G13 で無くした）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const GONE = 'C:\\work\\消えた.pdf';

const broken = () => Object.assign(new Error('broken'), { name: 'InvalidPDFException' });

async function withShell(t, { mode = 'tools', files = {}, ...options } = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), ...files },
    ...options,
  });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元は IPC の往復のあとに届く。届くのを待ってからモードを替える（tools-merge.test.js と同じ）。
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  await shell.flush();
  return shell;
}

const modeOf = (shell) => shell.document.documentElement.getAttribute('data-mode');

// ---- 開けなかった理由は帯で出す ----

test('ツールモードで壊れたファイルを開くと、理由を帯で出し、ツールモードのまま', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ openError: broken() }) });

  assert.equal(await shell.SigK.tabs.openPath(A), false);

  assert.equal(shell.SigK.tabs.count(), 1, '開けなかったタブも作る（spec-1-2 確定事項19）');
  assert.equal(modeOf(shell), 'tools');
  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.match(shell.SigK.viewBanner.text(), /壊れている/);
});

test('ツールモードで読めないファイルを開こうとすると、理由を帯で出す（タブは作らない）', async (t) => {
  const shell = await withShell(t);

  assert.equal(await shell.SigK.tabs.openPath(GONE), false);

  assert.equal(shell.SigK.tabs.count(), 0);
  assert.equal(shell.SigK.viewBanner.text(), '読み込み結果が用意されていません。');
  assert.equal(modeOf(shell), 'tools');
});

test('ツールモードでタブが上限を超えると、理由を帯で出す', async (t) => {
  const files = {};
  const paths = [];
  for (let index = 0; index < 21; index += 1) {
    const filePath = `C:\\work\\t${index}.pdf`;
    files[filePath] = makeSource({ path: filePath });
    paths.push(filePath);
  }
  const shell = await withShell(t, { files });
  for (const filePath of paths.slice(0, 20))
    await shell.SigK.tabs.openPath(filePath);

  assert.equal(await shell.SigK.tabs.openPath(paths[20]), false);

  assert.equal(shell.SigK.viewBanner.text(), '20 個まで開けますが、タブが多すぎるので、使わないタブを閉じてください。');
});

test('ツールモードで開けなかったタブへ切り替えると、理由を帯でもう一度出す', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ openError: broken() }) });
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  shell.SigK.viewBanner.hide();

  shell.SigK.tabs.activate(shell.SigK.tabs.list()[0].id);

  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.match(shell.SigK.viewBanner.text(), /壊れている/);
});

test('閲覧モードで開けなかったときは、今までどおりページビューの真ん中に出し、帯は出さない', async (t) => {
  const shell = await withShell(t, { mode: 'view', pdfjs: createPdfjsStub({ openError: broken() }) });

  await shell.SigK.tabs.openPath(A);

  assert.match(shell.document.getElementById('view-message').textContent, /壊れている/);
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

// ---- ツールモードの帯は、タブを開いても切り替えても消さない ----
//
// 別のタブへ移るとき、前の文書について出した帯は消す（viewer.js の resetView）。ツールモードの帯はツールの画面の
// 知らせ（名前の順に並べた・1つ目だけを対象にした・開けなかった理由）で、下で開くタブとは関係が無い。ツールモードでも
// タブを開くようにしたので、消すと、右クリックの束の 3 本目を開いたところで名前の順の注記が消えるなどしていた。

test('ツールモードでは、タブを開いても切り替えても閉じても、ツールの帯を消さない', async (t) => {
  const shell = await withShell(t);
  await shell.SigK.tabs.openPath(A);
  shell.SigK.viewBanner.show('ツールの知らせ', { tone: 'warn' });

  await shell.SigK.tabs.openPath(B);
  assert.equal(shell.SigK.viewBanner.text(), 'ツールの知らせ');

  shell.SigK.tabs.activate(shell.SigK.tabs.list()[0].id);
  assert.equal(shell.SigK.viewBanner.isVisible(), true);

  shell.SigK.tabs.forceCloseTab(shell.SigK.tabs.activeId());
  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.equal(shell.SigK.viewBanner.text(), 'ツールの知らせ');
});

test('閲覧モードでは、今までどおり別のタブを開くと前の文書の帯を消す', async (t) => {
  const shell = await withShell(t, { mode: 'view' });
  await shell.SigK.tabs.openPath(A);
  shell.SigK.viewBanner.show('a.pdf の知らせ');

  await shell.SigK.tabs.openPath(B);

  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

// ---- ［開く］で開いたファイルは帯になり、帯を対象にするツールはそれを使う（tabs.js の runOpenCommand） ----

const plain = (value) => structuredClone(value);
const mergePaths = (shell) => plain(shell.SigK.toolsMerge.rows().map((row) => row.path));

// 結合は帯（＝タブ）を対象にするので、開いたタブがそのまま結合の行になり、既定でチェックが入る（spec-2-5 確定事項E2）。
test('結合を選んでいるとき、［開く］で開いたファイルは帯になり、結合の行にもチェック付きで入る', async (t) => {
  const shell = await withShell(t, { openResults: [makeSource({ path: B })] });

  shell.fireOpenRequest();
  await shell.flush();
  shell.fireOpenRequest(A);
  await shell.flush();

  assert.deepEqual(plain(shell.SigK.tabs.list().map((tab) => tab.path)), [B, A]);
  assert.deepEqual(mergePaths(shell), [B, A]);
  assert.deepEqual(plain(shell.SigK.toolsMerge.rows().map((row) => row.checked)), [true, true]);
  assert.equal(modeOf(shell), 'tools');
});

test('分割を選んでいるとき、［開く］で開いたファイルは分割の対象になる', async (t) => {
  const shell = await withShell(t);
  shell.SigK.tools.select('split');

  assert.equal(await shell.SigK.tabs.runOpenCommand(B), true);
  await shell.flush();

  assert.equal(shell.SigK.toolsSplit.source().path, B);
  assert.equal(shell.SigK.tabs.count(), 1);
});

test('画像→PDF を選んでいるとき、［開く］で開いた PDF はタブで開くだけ', async (t) => {
  const shell = await withShell(t);
  shell.SigK.tools.select('convert');

  await shell.SigK.tabs.runOpenCommand(A);
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.deepEqual(plain(shell.SigK.toolsConvert.rows()), []);
  assert.equal(shell.SigK.tools.selected(), 'convert');
});

test('開けなかったファイルも帯になり、結合の行に入る（理由は帯で出す）', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ openError: broken() }) });

  assert.equal(await shell.SigK.tabs.runOpenCommand(A), false);
  await shell.flush();

  assert.deepEqual(mergePaths(shell), [A]);
  assert.match(shell.SigK.viewBanner.text(), /壊れている/);
});

test('閲覧モードの［開く］はタブで開くだけで、ツールモードへ移らない', async (t) => {
  const shell = await withShell(t, { mode: 'view' });

  await shell.SigK.tabs.runOpenCommand(A);
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(modeOf(shell), 'view');
});
