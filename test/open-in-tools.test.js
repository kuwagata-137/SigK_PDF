'use strict';

// ツールモードで開く（決定80）。
//
// ファイルはどのモードで開いてもタブで開き、モードは変えない。ツールモードではページビューがツールの画面の下に
// 隠れるので、開けなかった理由は帯で出す。［開く］・ドロップ・エクスプローラーからの起動で開いたファイルは、
// 移り期間として、選んでいるツールにも渡す（tool-handoff.js）。

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
  const call = { canceled: false };

  assert.equal(await shell.SigK.tabs.openPath(A, call), false);

  assert.equal(shell.SigK.tabs.count(), 1, '開けなかったタブも作る（spec-1-2 確定事項19）');
  assert.equal(modeOf(shell), 'tools');
  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.match(shell.SigK.viewBanner.text(), /壊れている/);
  assert.equal(call.error, shell.SigK.viewBanner.text(), '呼び出しの控えにも理由を残す（続けて開くと帯が消えるため）');
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
