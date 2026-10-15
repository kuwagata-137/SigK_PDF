'use strict';

// 分割の ✂ の盤を選んでいる帯の中に広げる（spec-2-5 確定事項G1・G5・G7〜G9）。
//
// 盤の上の操作は split-board.test.js、対象と出力と実行の流れは tools-split.test.js が見ている。ここは、盤が帯の中へ入る・帯を
// 選び替えると移る・分割を離れると戻ること、帯の並びの変更に分け目がついていくこと、保存していない変更があるときの確認の窓を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const targetsFor = (names) => names.map((name) => `C:\\work\\${name}`);
const SPLIT_DONE = { ok: true, written: 3, targets: targetsFor(['a_001.pdf', 'a_002.pdf', 'a_003.pdf']), pages: [1, 1, 1] };

async function createStripShell(t, { paths = [A, B], sizes = [A4, A4, A4], ...options } = {}) {
  const files = { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) };
  const pdfjs = createPdfjsStub({ sizes });
  const shell = await createShell({ files, pdfjs, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  await settle(shell);
  return { shell, files, sizes };
}

async function settle(shell) {
  for (let round = 0; round < 8; round += 1)
    await shell.flush();
}

const plain = (value) => structuredClone(value);
const board = (shell) => shell.document.getElementById('split-strip-board');
const nodeOf = (shell, filePath) => shell.SigK.strips.rowNode(shell.SigK.tabs.findByPath(filePath).id);
const press = (shell, id) => shell.document.getElementById(id).click();
const parts = (shell) => plain(shell.SigK.toolsSplit.currentPlan().parts);

test('分割を選ぶと、盤は選んでいる帯の中に入り、帯を選び替えると移る。分割を離れると元の場所へ戻す（G1・G5）', async (t) => {
  const { shell } = await createStripShell(t);
  const { SigK } = shell;
  const height = `${SigK.stripLayout.STRIP_HEIGHT}px`;
  assert.equal(board(shell).parentNode, nodeOf(shell, B), '最後に開いた b.pdf の帯');
  assert.equal(board(shell).hidden, false);
  assert.equal(nodeOf(shell, B).classList.contains('board'), true, '帯の紙の列を隠す印');
  assert.equal(nodeOf(shell, B).style.height, '', '盤を広げた帯は中身の高さ');
  assert.equal(nodeOf(shell, A).style.height, height);

  SigK.tabs.activate(SigK.tabs.findByPath(A).id);
  await settle(shell);
  assert.equal(board(shell).parentNode, nodeOf(shell, A));
  assert.equal(nodeOf(shell, A).classList.contains('board'), true);
  assert.equal(nodeOf(shell, B).classList.contains('board'), false);
  assert.equal(nodeOf(shell, B).style.height, height, '前の帯は普通の帯の高さへ戻す');

  SigK.tools.select('merge');
  await settle(shell);
  assert.equal(board(shell).parentNode.id, 'strips-screen');
  assert.equal(board(shell).hidden, true);
  assert.equal(nodeOf(shell, A).classList.contains('board'), false);
});

test('盤を広げた帯の紙は帯の層に頼まない（盤の層が描く。G9）', async (t) => {
  const { shell } = await createStripShell(t);
  const { SigK } = shell;
  for (let round = 0; round < 40 && SigK.stripThumbs.getState().pending + SigK.stripThumbs.getState().queued > 0; round += 1)
    await shell.flush();
  const ids = new Set(SigK.stripThumbs.getState().keys.map((key) => key.split(':')[0]));
  assert.equal(ids.has(String(SigK.tabs.findByPath(A).id)), true, 'ほかの帯は帯の紙を描く');
  assert.equal(ids.has(String(SigK.tabs.findByPath(B).id)), false);
  assert.ok(SigK.splitThumbs.getState().drawn.length > 0, '盤の紙は盤の層が描く');
});

test('ページ編集で並びを変えると、分け目はページを追ってずれる（G8）', async (t) => {
  const { shell } = await createStripShell(t, { paths: [A] });
  const { SigK } = shell;
  SigK.toolsSplitEdit.cut(2);
  assert.deepEqual(parts(shell), [[0, 1], [2]]);
  SigK.pageEdit.remove([0]);
  await settle(shell);
  assert.deepEqual(parts(shell), [[0], [1]], '2 ページ目の後ろの分け目は、2 ページ目について 1 つ前へ');
  SigK.pageEdit.rotate(90, [0]);
  await settle(shell);
  assert.deepEqual(parts(shell), [[0], [1]], '回しても分け目は動かない');
});

test('並べ替え・削除・差し込みを保存していなければ、確認の窓の［保存せずに実行］は押せず、理由を出す（G7）', async (t) => {
  const { shell } = await createStripShell(t, { paths: [A] });
  const { SigK, document: doc } = shell;
  SigK.toolsSplitEdit.bulk('each');
  SigK.pageEdit.remove([0]);
  await settle(shell);
  const running = SigK.toolsSplit.run();
  await shell.flush();
  assert.equal(SigK.confirmUnsavedRun.isOpen(), true);
  const runAnyway = doc.getElementById('confirm-unsaved-run-run');
  assert.equal(runAnyway.getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('confirm-unsaved-run-note').textContent, SigK.toolsSplit.NOTE_ORDER);
  runAnyway.click();
  assert.equal(SigK.confirmUnsavedRun.isOpen(), true, '押せないボタンは何もしない');
  press(shell, 'confirm-unsaved-run-cancel');
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('回転だけなら［保存せずに実行］を押せ、ファイルに保存してあるページで分ける（G7）', async (t) => {
  const { shell } = await createStripShell(t, { paths: [A], taskResults: [SPLIT_DONE] });
  const { SigK, document: doc } = shell;
  SigK.toolsSplitEdit.bulk('each');
  SigK.pageEdit.rotate(90, [1]);
  const running = SigK.toolsSplit.run();
  await shell.flush();
  assert.equal(doc.getElementById('confirm-unsaved-run-run').hasAttribute('aria-disabled'), false);
  press(shell, 'confirm-unsaved-run-run');
  assert.equal((await running).ok, true);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec.kind)), ['split']);
  assert.deepEqual(plain(shell.taskCalls[0].spec.parts.map((part) => part.pages)), [[0], [1], [2]]);
  assert.equal(SigK.tabs.isDirty(SigK.tabs.activeId()), true, '回転は残る');
});

test('［上書き保存してから実行］は、保存したあとのファイルのページで分ける（G7・G8）', async (t) => {
  const saved = { ok: true, path: A, signature: { size: 2048, mtimeMs: 2000 } };
  const done = { ok: true, written: 2, targets: targetsFor(['a_001.pdf', 'a_002.pdf']), pages: [1, 1] };
  const { shell, files, sizes } = await createStripShell(t, { paths: [A], taskResults: [saved, done] });
  const { SigK } = shell;
  SigK.toolsSplitEdit.bulk('each');
  SigK.pageEdit.remove([0]);
  await settle(shell);
  assert.deepEqual(parts(shell), [[0], [1]]);
  const running = SigK.toolsSplit.run();
  await shell.flush();
  // 上書き保存したファイルは 2 ページで、大きさと更新日時は保存の返事のとおり（開き直すと偽物の pdf.js が 2 ページの文書を返す）。
  sizes.splice(0, 1);
  files[A] = makeSource({ path: A, mtimeMs: 2000 });
  press(shell, 'confirm-unsaved-run-save');
  const result = await running;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec.kind)), ['save', 'split']);
  const spec = shell.taskCalls[1].spec;
  assert.deepEqual(plain(spec.parts.map((part) => part.pages)), [[0], [1]], '保存したファイルの 1・2 ページ目');
  assert.deepEqual(plain(spec.expectSource), { size: 2048, mtimeMs: 2000 });
  assert.equal(SigK.tabs.isDirty(SigK.tabs.activeId()), false);
});

// 計画で承認した G-d（spec-2-5 確定事項G9）のとおり、帯の上端が見えていても送る。960×600 の窓では、盤を広げた帯の上端が窓の下の端近くに
// 見えたまま盤のページが見えなかった（2026-10-15 の起動確認で見つけた。前は上端が見えていないときだけ送っていた）。
test('盤を広げる帯を替えたときは、その帯の上端が見えていても、帯の上端まで帯の画面を送る（G9）', async (t) => {
  const { shell } = await createStripShell(t);
  const { SigK, document: doc } = shell;
  const strips = doc.getElementById('strips');
  Object.defineProperty(strips, 'clientHeight', { configurable: true, value: 600 });
  strips.getBoundingClientRect = () => ({ top: 100, bottom: 700, left: 0, right: 800, width: 800, height: 600 });
  strips.scrollTop = 0;
  nodeOf(shell, A).getBoundingClientRect = () => ({ top: 300, bottom: 500, left: 0, right: 800, width: 800, height: 200 });

  SigK.tabs.activate(SigK.tabs.findByPath(A).id);
  await settle(shell);
  assert.equal(board(shell).parentNode, nodeOf(shell, A));
  assert.equal(strips.scrollTop, 200 - SigK.stripLayout.COLUMN_PAD, 'a.pdf の帯の上端（帯の画面の中で 200px）から余白の分だけ上');
});

// 送る時点で盤の器の高さが前の帯の盤のまま（か 0）だと、帯の画面の中身が短く、送る量が切られる（2026-10-15 の起動確認で、1280×800 では
// 送られず、960×600 では途中までしか送られなかった）。盤を描いて高さを決めてから送る。
test('盤を広げる帯を替えたときは、移った先の盤の高さを決めてから帯の画面を送る（G9）', async (t) => {
  const { shell } = await createStripShell(t);
  const { SigK, document: doc } = shell;
  press(shell, 'split-each');
  await settle(shell);
  const canvas = doc.getElementById('split-board-canvas');
  const heightOfB = canvas.style.height;
  const strips = doc.getElementById('strips');
  let value = 0;
  let heightAtScroll = null;
  Object.defineProperty(strips, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (next) => {
      heightAtScroll ??= canvas.style.height;
      value = next;
    },
  });

  SigK.tabs.activate(SigK.tabs.findByPath(A).id);
  await settle(shell);
  assert.notEqual(heightAtScroll, null, '帯の画面を送った');
  assert.equal(heightAtScroll, `${SigK.splitBoardView.layout().totalHeight}px`, 'a.pdf の盤の高さで送る');
  assert.notEqual(heightAtScroll, heightOfB, 'b.pdf（1 ページずつ）の盤の高さのままではない');
});
