'use strict';

// 異常な PDF を開いたときの画面側（spec-6-1 タスク D）。本物の pdf.js での様子は起動確認 SIGK_SMOKE_ABNORMAL（smoke-abnormal.js）が見る。
//
// D3: 所有者パスワードだけの PDF は、開くときにパスワードを聞かれないが暗号化されている。保存の部品（pdf-lib）は暗号を書けないので、
// パスワード付きと同じ扱い（読む・検索・印刷・ページ編集はできる、保存とツールは事前に断る）にする。暗号の有無は pdf.js の文書情報の
// EncryptFilterName（文書情報の窓の「暗号化」と同じ判定）で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const LOCKED = 'パスワードで保護された PDF は保存できません。';

async function openWith(t, info, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) }, pdfjs: createPdfjsStub({ info }), ...options });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

test('文書情報に暗号の印（EncryptFilterName）がある PDF は、パスワードを聞かれなくても保存できない文書として扱う（D3）', async (t) => {
  const shell = await openWith(t, { EncryptFilterName: 'Standard' });
  const { SigK } = shell;
  assert.equal(SigK.viewer.getState().file.encrypted, true);
  assert.equal(SigK.save.unsaveableReason(), LOCKED);
  SigK.viewer.applyPlan(SigK.pagePlan.rotatePages(SigK.viewer.getPlan(), [0], 90));
  assert.deepEqual(structuredClone(await SigK.save.saveActive()), { error: LOCKED });
  assert.equal(shell.taskCalls.length, 0, '保存を押す前に断る（ワーカーを回さない）');
  SigK.shell.setMode(shell.document, 'tools');
  SigK.tools.select('watermark');
  assert.equal(SigK.toolsWatermark.stateText(), '「a.pdf」はパスワード付きなので透かしを入れられません。ほかの帯を選んでください。');
  assert.equal(SigK.toolsWatermark.canRun(), false);
});

test('暗号の印が無い・空の文字・文書情報を読めないときは、今のとおり保存できる文書として扱う', async (t) => {
  for (const info of [{}, { EncryptFilterName: '' }, { EncryptFilterName: null }]) {
    const shell = await openWith(t, info);
    assert.equal(shell.SigK.viewer.getState().file.encrypted, false, JSON.stringify(info));
  }
  const pdfjs = createPdfjsStub();
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) }, pdfjs });
  t.after(() => shell.cleanup());
  const getDocument = pdfjs.getDocument;
  pdfjs.getDocument = (params) => {
    const task = getDocument(params);
    task.promise = task.promise.then((doc) => Object.assign(doc, { getMetadata: async () => { throw new Error('読めない'); } }));
    return task;
  };
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  assert.equal(shell.SigK.viewer.getState().open, true);
  assert.equal(shell.SigK.viewer.getState().file.encrypted, false);
});
