'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, A4 } = require('./harness.js');

// 帯のページを動かす・写す・新しい帯を作る層（spec-2-5 確定事項I2〜I5・I7・I8。PR-4 のタスク 3）。引いて落とす操作（タスク 4）は
// この層を呼ぶだけなので、ここでは層を直に呼ぶ。写しの PDF はワーカー（taskAPI.run）が作るので、タスク 1 の結果の形を返させる。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const C = 'C:\\work\\議事録.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const MOSAIC = 'モザイクを保存していないページは写せません。「会議資料.pdf」を上書き保存してから、もう一度ドラッグしてください。';

const copied = (pages = 2) => ({ ok: true, bytes: new Uint8Array(PDF), pages, sizes: Array.from({ length: pages }, () => ({ ...A4 })) });

async function withStrips(t, { taskResults = [], paths = [A, B, C] } = {}) {
  const files = Object.fromEntries([A, B, C].map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files, taskResults });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  await shell.flush();
  return shell;
}

const ids = (shell) => shell.SigK.tabs.list().map((tab) => tab.id);

// pdf.js と同じく、getDocument に渡したバイト列の中身を移して空にする（見落としやすい所 2。untitled-strip.test.js と同じ）。
function detachOnOpen(SigK) {
  const original = SigK.pdfjs.getDocument;
  SigK.pdfjs.getDocument = (params) => {
    const task = original(params);
    if (params?.data?.buffer !== undefined)
      structuredClone(params.data.buffer, { transfer: [params.data.buffer] });
    return task;
  };
}
const planOf = (shell, id) => structuredClone(shell.SigK.tabs.peek(id).plan);
const bannerText = (shell) => shell.SigK.viewBanner.text();

// 帯 1（会議資料）の 2・3 ページ目（index 1・2）を選んで、帯 1 に枠を付ける。
function pickInFirst(shell, pages = [1, 2]) {
  const [a] = ids(shell);
  shell.SigK.tabs.activate(a);
  const plan = shell.SigK.tabs.peek(a).plan;
  shell.SigK.stripSelection.click(a, pages[0], { plan });
  for (const page of pages.slice(1))
    shell.SigK.stripSelection.click(a, page, { ctrl: true, plan });
  return a;
}

test('同じ帯で動かすと並びが変わり、動かしたページを選んだまま。Ctrl+Z 1 回で戻る', async (t) => {
  const shell = await withStrips(t);
  const a = pickInFirst(shell, [0]);

  assert.equal(shell.SigK.pageTransfer.move([0], 3), true);
  assert.deepEqual(planOf(shell, a).map((page) => page.src), [1, 2, 0]);
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [2], '動かしたページを選んだまま');
  await shell.flush();
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [2], '帯を描き直しても外れない');

  shell.SigK.pageEdit.undo();
  assert.deepEqual(planOf(shell, a).map((page) => page.src), [0, 1, 2]);
});

test('選んだページの中に落とすと、並びも履歴も変えない', async (t) => {
  const shell = await withStrips(t);
  const a = pickInFirst(shell);
  const depth = shell.SigK.pageEdit.getHistoryState().depth;
  assert.equal(shell.SigK.pageTransfer.move([1, 2], 2), false);
  assert.deepEqual(planOf(shell, a).map((page) => page.src), [0, 1, 2]);
  assert.equal(shell.SigK.pageEdit.getHistoryState().depth, depth);
});

test('ほかの帯へ写すと写した先だけが変わり、枠と元の選択は残る（I7）', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(2)] });
  const a = pickInFirst(shell);
  const [, b] = ids(shell);
  detachOnOpen(shell.SigK);

  const result = await shell.SigK.pageTransfer.copyTo(b, [1, 2], 1);
  await shell.flush();

  assert.equal(result.ok, true);
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'copy-pages');
  assert.equal(spec.source, A);
  assert.deepEqual(structuredClone(spec.pages).map((page) => page.src), [1, 2]);
  const target = shell.SigK.tabs.peek(b);
  assert.deepEqual(structuredClone(target.plan).map((page) => page.src ?? `i${page.insert}`), [0, 'i0', 'i1', 1, 2]);
  assert.equal(typeof target.inserts[0].copy, 'string');
  assert.ok(target.inserts[0].bytes.length > 0, '保存に使うバイト列を持っている（pdf.js に渡す前に写してある）');
  assert.deepEqual(planOf(shell, a).map((page) => page.src), [0, 1, 2], '元の帯は変わらない');
  assert.equal(shell.SigK.tabs.activeId(), a, '枠は引き始めた帯のまま');
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [1, 2], '元の選択も残る');
  assert.equal(shell.SigK.tabs.isDirty(b), true);
  assert.equal(shell.SigK.tabs.isDirty(a), false);
  assert.equal(bannerText(shell), '2 ページを「見積書.pdf」に写しました。');
});

test('受け口へ落とすと「新しい PDF 1」「新しい PDF 2」ができて、枠が新しい帯へ移る（I7・I-h）', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(2), copied(1)] });
  const a = pickInFirst(shell);

  const first = await shell.SigK.pageTransfer.toNewStrip([1, 2]);
  await shell.flush();
  assert.equal(first.ok, true);
  const created = shell.SigK.tabs.list().at(-1);
  assert.equal(created.name, '新しい PDF 1');
  assert.equal(created.path, null);
  assert.equal(shell.SigK.tabs.activeId(), created.id, '枠は新しい帯へ');
  assert.equal(shell.SigK.tabs.isDirty(created.id), true);
  assert.equal(shell.SigK.viewer.getState().file.folder, 'C:\\work', '保存の窓の既定は引き始めた帯のフォルダ');
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [1, 2], '引き始めた帯の選択は残る');
  assert.equal(bannerText(shell), '2 ページで、新しい帯「新しい PDF 1」を作りました。', '進み具合の文を残さない');

  shell.SigK.tabs.activate(a);
  await shell.SigK.pageTransfer.toNewStrip([1]);
  await shell.flush();
  assert.equal(shell.SigK.tabs.list().at(-1).name, '新しい PDF 2');
});

test('保存していないモザイクを含むと、写さずに通知バーで断る（I8）。同じ帯の中では動かせる', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(2)] });
  const a = pickInFirst(shell);
  const plan = shell.SigK.viewer.getPlan();
  plan[1] = { ...plan[1], mosaic: [{ box: [0, 0, 10, 10], block: 8 }] };
  shell.SigK.pageEdit.commit(plan, { after: [] });
  const [, b] = ids(shell);
  shell.SigK.stripSelection.click(a, 1, { plan: shell.SigK.tabs.peek(a).plan });

  assert.equal(shell.SigK.pageTransfer.refusalFor({ indices: [1], target: { kind: 'copy', tabId: b } }), MOSAIC);
  const copiedResult = await shell.SigK.pageTransfer.copyTo(b, [1], 0);
  assert.equal(copiedResult.refused, MOSAIC);
  const created = await shell.SigK.pageTransfer.toNewStrip([1]);
  assert.equal(created.refused, MOSAIC);
  assert.equal(bannerText(shell), MOSAIC);
  assert.equal(shell.taskCalls.length, 0, '写しを作らない');
  assert.equal(shell.SigK.tabs.count(), 3);
  assert.equal(shell.SigK.pageTransfer.refusalFor({ indices: [1], target: { kind: 'move' } }), null);
  assert.equal(shell.SigK.pageTransfer.move([1], 0), true);
});

test('パスワード付きの帯・開けなかった帯へは写さない', async (t) => {
  const shell = await withStrips(t);
  pickInFirst(shell);
  const [, b, c] = ids(shell);
  shell.SigK.tabs.peek(b).file.encrypted = true;
  assert.equal(shell.SigK.pageTransfer.refusalFor({ indices: [1], target: { kind: 'copy', tabId: b } }), 'パスワード付きの PDF には写せません。');
  shell.SigK.tabs.forceCloseTab(c);
  assert.equal(shell.SigK.pageTransfer.refusalFor({ indices: [1], target: { kind: 'copy', tabId: c } }), '開けなかった PDF には写せません。');
});

test('帯が 20 本なら新しい帯を作らない', async (t) => {
  const shell = await withStrips(t);
  pickInFirst(shell);
  for (let index = shell.SigK.tabs.count(); index < shell.SigK.tabs.MAX_TABS; index += 1) {
    const filePath = `C:\\work\\追加${index}.pdf`;
    shell.files[filePath] = makeSource({ path: filePath });
    await shell.SigK.tabs.openPath(filePath);
  }
  pickInFirst(shell);
  const result = await shell.SigK.pageTransfer.toNewStrip([1]);
  assert.equal(result.refused, '帯が 20 本あるので、新しい帯を作れません。使わない帯を閉じてください。');
  assert.equal(shell.taskCalls.length, 0);
});

test('写しを作っている途中に写す先が閉じられたら、どの帯にも入れない（見落としやすい所 1）', async (t) => {
  const shell = await withStrips(t, { taskResults: [] });
  const a = pickInFirst(shell);
  const [, b, c] = ids(shell);
  let finish;
  shell.window.taskAPI.run = (taskId, spec) => new Promise((resolve) => { finish = () => resolve(copied(2)); });

  const pending = shell.SigK.pageTransfer.copyTo(b, [1, 2], 0);
  await shell.flush();
  shell.SigK.tabs.forceCloseTab(b);
  finish();
  const result = await pending;
  await shell.flush();

  assert.equal(result.canceled, true);
  assert.deepEqual(planOf(shell, a).map((page) => page.src), [0, 1, 2]);
  assert.deepEqual(planOf(shell, c).map((page) => page.src), [0, 1, 2]);
  // 進み具合の文（［中止］付き）を残さない。開いた写しの文書は畳む（点検の指摘 5）。
  assert.equal(bannerText(shell), '写す先の帯が閉じられたので、ページを写すのをやめました。');
  assert.equal(shell.SigK.pdfjs.documents.at(-1).destroyed, true);
});

test('写しを用意している間は通知バーに「ページの写しを用意しています」、中止したら「ページを写すのを中止しました。」', async (t) => {
  const shell = await withStrips(t);
  pickInFirst(shell);
  const [, b] = ids(shell);
  let finish;
  shell.window.taskAPI.run = () => new Promise((resolve) => { finish = () => resolve({ canceled: true }); });
  const pending = shell.SigK.pageTransfer.copyTo(b, [1], 0);
  await shell.flush();
  assert.match(bannerText(shell), /^ページの写しを用意しています/);
  finish();
  assert.equal((await pending).canceled, true);
  assert.equal(bannerText(shell), 'ページを写すのを中止しました。');
});
