'use strict';

// 分割の盤のサムネイルを描く層（spec-2-2b 確定事項D2〜D5、spec-2-5 確定事項G6・G10）。盤は選んでいる帯（タブ）の今の中身から描き、
// PDF を読み直さない。頼まれたページだけ描き、上限を超えたら手放し、帯を替えたら全部手放す。jsdom には 2D コンテキストが無いので、
// 描いたかどうかは pdf.js の偽物の viewportCalls（倍率 1 でない呼び出しが描いた印）、手放したかどうかは cleanups で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function createThumbShell(t, { sizes = [A4, A4, A4, A4, A4, A4] } = {}) {
  const pdfjs = createPdfjsStub({ sizes });
  const shell = await createShell({ pdfjs, files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  // ツールモードでは、ページの表示と左の欄のサムネイルを描かない（描いた印に混ざらないように）。
  shell.SigK.shell.setMode(shell.document, 'tools');
  await settle(shell);
  const [a, b] = shell.SigK.tabs.list().map((tab) => tab.id);
  return { shell, pdfjs, thumbs: shell.SigK.splitThumbs, a, b };
}

const settle = async (shell) => {
  for (let i = 0; i < 8; i += 1)
    await shell.flush();
};

// 描いたページ（1 始まり）。倍率 1 の呼び出しは寸法を測っただけ。
const drawnPages = (pdfjs) => [...new Set(pdfjs.viewportCalls.filter((call) => call.scale !== 1).map((call) => call.page))].sort((x, y) => x - y);

test('頼まれたページだけを、紙の枠に収まる大きさで、帯の文書から描く（PDF を読み直さない）', async (t) => {
  const { shell, pdfjs, thumbs, a } = await createThumbShell(t);
  const opened = pdfjs.documents.length;
  thumbs.setTab(a);
  pdfjs.viewportCalls.length = 0;
  thumbs.want([0, 2], { cap: 72 });
  await settle(shell);
  assert.deepEqual(drawnPages(pdfjs), [1, 3]);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [0, 2]);
  assert.equal(pdfjs.documents.length, opened, '盤のために PDF を開き直さない（spec-2-5 確定事項G6）');
  assert.deepEqual(structuredClone(thumbs.sheetFor('mid', A4)), { width: 104, height: 147 }, '中の枠（104×147）に縦横比のまま収める');
  assert.deepEqual(structuredClone(thumbs.sheetFor('mid', { width: 842, height: 595 })), { width: 104, height: 73 }, '横長のページ');
});

test('上限を超えたページと、頼まれなくなったページは手放す（canvas と page.cleanup）', async (t) => {
  const { shell, pdfjs, thumbs, a } = await createThumbShell(t);
  thumbs.setTab(a);
  thumbs.want([0, 1, 2], { cap: 2 });
  await settle(shell);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [0, 1]);
  pdfjs.cleanups.length = 0;
  thumbs.want([4, 5], { cap: 2 });
  await settle(shell);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [4, 5]);
  assert.deepEqual([...pdfjs.cleanups].sort(), [1, 2]);
});

test('大きさを変えると全部手放し、次に頼まれたときに新しい大きさで描き直す', async (t) => {
  const { shell, pdfjs, thumbs, a } = await createThumbShell(t);
  thumbs.setTab(a);
  thumbs.want([0], { cap: 72 });
  await settle(shell);
  pdfjs.cleanups.length = 0;
  assert.equal(thumbs.setSize('large'), true);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), []);
  assert.deepEqual(pdfjs.cleanups, [1]);
  pdfjs.viewportCalls.length = 0;
  thumbs.want([0], { cap: 36 });
  await settle(shell);
  assert.deepEqual(drawnPages(pdfjs), [1]);
  assert.equal(thumbs.setSize('large'), false, '同じ大きさなら何もしない');
});

test('描いている途中に大きさを変えても、そのページは新しい大きさで描き直す（空の枠のまま残さない）', async (t) => {
  const { shell, thumbs, a } = await createThumbShell(t);
  thumbs.setTab(a);
  thumbs.want([0, 1], { cap: 72 });
  assert.equal(thumbs.getState().pending, 2, '2 枚とも描いている途中');
  thumbs.setSize('large');
  thumbs.want([0, 1], { cap: 36 });   // 画面が描き直しで同じページを頼み直す
  await settle(shell);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), [0, 1]);
});

test('帯を替えると全部手放す。同じ帯なら何もしない', async (t) => {
  const { shell, pdfjs, thumbs, a, b } = await createThumbShell(t);
  thumbs.setTab(a);
  thumbs.want([0, 1], { cap: 72 });
  await settle(shell);
  assert.equal(thumbs.setTab(a), false);
  pdfjs.cleanups.length = 0;
  assert.equal(thumbs.setTab(b), true);
  assert.deepEqual(structuredClone(thumbs.getState().drawn), []);
  assert.equal(pdfjs.cleanups.length, 2);
  assert.equal(thumbs.getState().tabId, b);
});

test('保存していない回転も描き、中身が変わった紙だけを描き直す（spec-2-5 確定事項G6）', async (t) => {
  const { shell, pdfjs, thumbs, b } = await createThumbShell(t);
  thumbs.setTab(b);
  thumbs.want([0, 1], { cap: 72 });
  await settle(shell);
  shell.SigK.pageEdit.rotate(90, [0]);
  pdfjs.viewportCalls.length = 0;
  thumbs.want([0, 1], { cap: 72 });
  await settle(shell);
  assert.deepEqual(drawnPages(pdfjs), [1], '回した 1 ページ目だけ描き直す');
  assert.ok(pdfjs.viewportCalls.some((call) => call.page === 1 && call.rotation === 90));
});

test('描けたページは onDrawn で知らせる', async (t) => {
  const { shell, thumbs, a } = await createThumbShell(t);
  const seen = [];
  thumbs.onDrawn((page) => seen.push(page));
  thumbs.setTab(a);
  thumbs.want([3], { cap: 72 });
  await settle(shell);
  assert.deepEqual(seen, [3]);
});
