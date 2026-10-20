'use strict';

// 異常な PDF を開いたときの画面側（spec-6-1 タスク D）。本物の pdf.js での様子は起動確認 SIGK_SMOKE_ABNORMAL（smoke-abnormal.js）が見る。
//
// D3: 所有者のパスワードだけの PDF は、開くときにパスワードを聞かれないが暗号化されている。保存の部品（pdf-lib）は暗号を書けないので、
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

// D7（計画 P6）。タブの上限はファイルを読む前に判定する（今は 200MB まで読んでから断っていた）。使用中のファイルは最近使ったファイルから消さない。
test('タブが上限まで開いていたら、ファイルを読まず、［開く］の窓も出さずに断る（D7）', async (t) => {
  const files = {};
  for (let index = 0; index < 21; index += 1)
    files[`C:\\work\\${index}.pdf`] = makeSource({ path: `C:\\work\\${index}.pdf` });
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  const { SigK } = shell;
  for (let index = 0; index < SigK.tabs.MAX_TABS; index += 1)
    await SigK.tabs.openPath(`C:\\work\\${index}.pdf`);
  const reads = [];
  const read = shell.window.pdfAPI.read;
  shell.window.pdfAPI.read = async (filePath) => { reads.push(filePath); return read(filePath); };
  let dialogs = 0;
  shell.window.pdfAPI.open = async () => { dialogs += 1; return { canceled: true }; };
  assert.equal(await SigK.tabs.openPath('C:\\work\\20.pdf'), false);
  assert.equal(await SigK.tabs.openViaDialog(), false);
  assert.deepEqual(reads, [], '読む前に断る');
  assert.equal(dialogs, 0, '窓を出す前に断る');
  assert.match(SigK.viewBanner.text(), /タブが多すぎるので/);
  assert.equal(await SigK.tabs.openPath('C:\\work\\3.pdf'), true, '開いているファイルへは、上限でも切り替えられる');
});

test('ほかのプログラムが使っていて読めなかったファイルは、最近使ったファイルから消さない。見つからないファイルは今のとおり消す（D7）', async (t) => {
  const shell = await createShell({ files: {
    [A]: { error: 'ファイルが他のプログラムで使われています。', code: 'EBUSY' },
    'C:\\work\\gone.pdf': { error: 'ファイルが見つかりません。', code: 'ENOENT' },
  } });
  t.after(() => shell.cleanup());
  assert.equal(await shell.SigK.tabs.openPath(A), false);
  assert.equal(shell.recentCalls.some((call) => call.kind === 'remove' && call.path === A), false);
  assert.equal(shell.SigK.viewer.getMessage(), 'ファイルが他のプログラムで使われています。');
  assert.equal(await shell.SigK.tabs.openPath('C:\\work\\gone.pdf'), false);
  assert.equal(shell.recentCalls.some((call) => call.kind === 'remove' && call.path === 'C:\\work\\gone.pdf'), true);
});

// D4（決定81 ⑬）。1 ページだけ壊れた PDF は、今のとおり文書全体を開かず、どのページで失敗したかを出す。
test('ページを読めない PDF は、文書全体を開かずに、失敗したページの番号を出す（決定81 ⑬）', async (t) => {
  const pdfjs = createPdfjsStub();
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) }, pdfjs });
  t.after(() => shell.cleanup());
  const getDocument = pdfjs.getDocument;
  pdfjs.getDocument = (params) => {
    const task = getDocument(params);
    task.promise = task.promise.then((doc) => {
      const getPage = doc.getPage;
      return Object.assign(doc, { getPage: async (number) => {
        if (number === 2)
          throw Object.assign(new Error('Page dictionary kid reference points to wrong type of object.'), { name: 'UnknownErrorException' });
        return getPage(number);
      } });
    });
    return task;
  };
  assert.equal(await shell.SigK.tabs.openPath(A), false);
  await shell.flush();
  assert.equal(shell.SigK.viewer.getMessage(), '2 ページ目が壊れているので、この PDF を開けませんでした。');
  assert.equal(shell.SigK.tabs.list().length, 1, '開けなくてもタブは作る（理由を見せるため。spec-1-2 確定事項19）');
  const logged = shell.logs.find((entry) => entry.context?.source === 'viewer');
  assert.match(logged?.message ?? '', /Page dictionary kid reference/, '記録には pdf.js の元の文を残す');
  assert.equal(logged.context.page, 2);
  assert.equal(logged.context.cause, 'UnknownErrorException', '元の例外の名前も残す（点検の直し）');
  // 開けなかった文書は畳む（pdf.js の側に残さない。点検の直し I-3）。
  assert.equal(pdfjs.documents.at(-1).destroyed, true);
});

// D9（点検の直し）。表示と印刷の canvas が、大きな紙でも画素の上限に収まるか。
test('A0 を 400% で映すと、pdf.js に頼む倍率を上限まで下げる（表示）', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 2384, height: 3370 }] });
  const shell = await openWith(t, {}, { pdfjs });
  pdfjs.viewportCalls.length = 0;
  shell.SigK.viewer.setZoom(4);
  await shell.flush();
  await shell.flush();
  const full = 4 * (96 / 72);
  const scales = pdfjs.viewportCalls.filter((call) => call.page === 1).map((call) => call.scale);
  assert.ok(scales.includes(full), '先に倍率どおりの寸法を見る');
  const capped = scales.find((scale) => scale < full * 0.99);
  assert.ok(capped !== undefined, `上限で下げた倍率が無い: ${scales.join(', ')}`);
  const pixels = (2384 * capped) * (3370 * capped);
  assert.ok(pixels <= shell.SigK.pageImage.MAX_CANVAS_PIXELS * 1.001, `${Math.round(pixels / 1e6)}M 画素`);
});

test('とても大きな紙を印刷するときも、1 ページの画像を画素の上限に収める（印刷）', async (t) => {
  const pdfjs = createPdfjsStub({ sizes: [{ width: 14400, height: 14400 }] });
  const shell = await openWith(t, {}, { pdfjs });
  shell.SigK.print.open();
  const result = await shell.SigK.print.prepare({ mode: 'all' });
  assert.equal(result.ok, true);
  const { width, height } = result.images[0];
  assert.ok(width * height <= shell.SigK.pageImage.MAX_CANVAS_PIXELS * 1.001, `${width}×${height}`);
  assert.ok(width > 10000, '上限いっぱいまでは描く');
});
