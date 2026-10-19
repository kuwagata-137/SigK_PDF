'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, A4 } = require('./harness.js');

// ツールモードの帯のページを引いて落とす（spec-2-5 確定事項I1〜I4。PR-4 の起草者の判断 I-a〜I-e・I-l。見本 strips4-drag-copy・strips4-drag-new）。
// strip-drag.js（押し・引き・離す・取りやめ）と strip-drag-view.js（カーソルの絵・線・札・受け口）。落とした先の処理は page-transfer.test.js。
//
// jsdom は大きさを数えないので、帯（上端 0・198・396、高さ 188、紙の列は 40px 下・左端 10）と受け口（600〜700）の箱を差し替える。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const C = 'C:\\work\\議事録.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const copied = (pages = 1) => ({ ok: true, bytes: new Uint8Array(PDF), pages, sizes: Array.from({ length: pages }, () => ({ ...A4 })) });

async function withStrips(t, { taskResults = [] } = {}) {
  const files = Object.fromEntries([A, B, C].map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files, taskResults });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of [A, B, C])
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  await shell.flush();
  placeStrips(shell);
  return shell;
}

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top });
const stripNodes = (shell) => [...shell.document.querySelectorAll('#strips .strip')];
const cellOf = (shell, n, p) => stripNodes(shell)[n].querySelectorAll('.strip-page')[p];
const ids = (shell) => shell.SigK.tabs.list().map((tab) => tab.id);
const srcs = (shell, id) => structuredClone(shell.SigK.tabs.peek(id).plan).map((page) => page.src ?? `i${page.insert}`);
const lineOf = (shell) => shell.document.querySelector('#strips .strip-drop-line');

function placeStrips(shell) {
  const strips = shell.document.getElementById('strips');
  strips.getBoundingClientRect = () => rect(0, 0, 820, 800);
  stripNodes(shell).forEach((node, index) => {
    node.getBoundingClientRect = () => rect(0, index * 198, 800, 188);
    node.querySelector('.strip-pages').getBoundingClientRect = () => rect(10, index * 198 + 40, 780, 140);
  });
  shell.document.getElementById('strip-drop').getBoundingClientRect = () => rect(0, 600, 800, 100);
}

// n 番目の帯の p 番目の紙の真ん中（画面の座標）。
function centerOf(shell, n, p) {
  const line = shell.SigK.stripLayout.row(shell.SigK.tabs.peek(ids(shell)[n]).sizes);
  return { x: 10 + line.lefts[p] + line.widths[p] / 2, y: n * 198 + 100 };
}

function press(shell, n, p) {
  const point = centerOf(shell, n, p);
  shell.firePointer(cellOf(shell, n, p), 'pointerdown', point);
  return point;
}

const move = (shell, x, y) => shell.firePointer(shell.document, 'pointermove', { x, y });
const release = (shell, x, y) => shell.firePointer(shell.document, 'pointerup', { x, y });

// 押して、6px 動かして引き始め、(x, y) まで動かす。
function dragTo(shell, n, p, x, y) {
  const start = press(shell, n, p);
  move(shell, start.x + 6, start.y);
  move(shell, x, y);
}

test('5px 動かすまでは引き始めない', async (t) => {
  const shell = await withStrips(t);
  const start = press(shell, 0, 1);
  move(shell, start.x + 3, start.y);
  assert.equal(shell.SigK.stripDrag.isDragging(), false);
  move(shell, start.x + 6, start.y);
  assert.equal(shell.SigK.stripDrag.isDragging(), true);
});

test('選んでいないページから引くと、そのページだけを選び直し、その帯に枠を移して引く（I-a）', async (t) => {
  const shell = await withStrips(t);
  const [a, , c] = ids(shell);
  assert.equal(shell.SigK.tabs.activeId(), c);
  shell.SigK.stripSelection.click(a, 0, { plan: shell.SigK.tabs.peek(a).plan });
  const start = press(shell, 0, 2);
  move(shell, start.x + 6, start.y);
  assert.equal(shell.SigK.tabs.activeId(), a);
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [2]);
});

test('同じ帯の中で離すと動かし、離したあとの click では選び直さない', async (t) => {
  const shell = await withStrips(t);
  const [a] = ids(shell);
  const end = centerOf(shell, 0, 2);
  dragTo(shell, 0, 0, end.x + 5, end.y);
  release(shell, end.x + 5, end.y);
  shell.document.getElementById('strips').dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, clientX: end.x, clientY: end.y }));
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [1, 2, 0]);
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(a)), [2], '動かしたページを選んだまま');
});

test('引いている間、カーソルに絵と「N ページ」の札、落とす先に線と札、受け口に新しい帯の文を出す（I-c）', async (t) => {
  const shell = await withStrips(t);
  const { document } = shell;
  dragTo(shell, 0, 1, centerOf(shell, 1, 0).x + 50, 300);
  assert.equal(document.querySelector('.strip-drag-ghost .badge').textContent, '1 ページ');
  assert.equal(cellOf(shell, 0, 1).classList.contains('dragging'), true, '引いている紙は薄く');
  assert.equal(lineOf(shell).closest('.strip'), stripNodes(shell)[1]);
  assert.equal(lineOf(shell).textContent, 'ここに 1 ページを写します');

  move(shell, 12, 100);
  assert.equal(lineOf(shell).closest('.strip'), stripNodes(shell)[0]);
  assert.equal(lineOf(shell).textContent, 'ここへ 1 ページを動かします');

  move(shell, 100, 650);
  assert.equal(lineOf(shell), null);
  assert.equal(document.getElementById('strip-drop').classList.contains('hot'), true);
  assert.equal(document.getElementById('strip-drop-text').textContent, 'ここに落とすと、選んだ 1 ページで新しい PDF の帯ができます');

  release(shell, 100, 650);
  assert.equal(document.querySelector('.strip-drag-ghost'), null);
  assert.equal(document.getElementById('strip-drop').classList.contains('hot'), false);
  assert.equal(document.getElementById('strip-drop-text').textContent, 'PDF をここへ落とすと、開いて帯に足します');
});

test('ほかの帯へ離すと写し、受け口へ離すと新しい帯を作る', async (t) => {
  const shell = await withStrips(t, { taskResults: [copied(1), copied(1)] });
  const [a, b] = ids(shell);
  dragTo(shell, 0, 1, 12, 300);
  release(shell, 12, 300);
  await shell.flush();
  assert.deepEqual(srcs(shell, b), ['i0', 0, 1, 2]);
  assert.equal(shell.SigK.tabs.activeId(), a);

  placeStrips(shell);
  dragTo(shell, 0, 1, 100, 650);
  release(shell, 100, 650);
  await shell.flush();
  assert.equal(shell.SigK.tabs.list().at(-1).name, '新しい PDF 1');
});

test('帯と帯の間で離すと何も変えない', async (t) => {
  const shell = await withStrips(t);
  const [a, b] = ids(shell);
  dragTo(shell, 0, 1, 100, 192);
  assert.equal(shell.SigK.stripDrag.isDragging(), true);
  assert.equal(lineOf(shell), null);
  release(shell, 100, 192);
  await shell.flush();
  assert.deepEqual(srcs(shell, a), [0, 1, 2]);
  assert.deepEqual(srcs(shell, b), [0, 1, 2]);
  assert.equal(shell.taskCalls.length, 0);
});

for (const [name, stop] of [
  ['Esc', (shell) => shell.document.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))],
  ['pointercancel', (shell) => shell.firePointer(shell.document, 'pointercancel', {})],
  ['窓の blur', (shell) => shell.window.dispatchEvent(new shell.window.Event('blur'))],
]) {
  test(`${name} で、何も変えずにやめる（I-e）`, async (t) => {
    const shell = await withStrips(t);
    const [a] = ids(shell);
    const end = centerOf(shell, 0, 2);
    dragTo(shell, 0, 0, end.x + 5, end.y);
    assert.notEqual(lineOf(shell), null, '引いている');
    stop(shell);
    assert.equal(shell.SigK.stripDrag.isDragging(), false);
    assert.equal(lineOf(shell), null);
    assert.equal(shell.document.querySelector('.strip-drag-ghost'), null);
    release(shell, end.x + 5, end.y);
    await shell.flush();
    assert.deepEqual(srcs(shell, a), [0, 1, 2]);
  });
}

test('保存の途中などは引けない（I-l）', async (t) => {
  const shell = await withStrips(t);
  const free = press(shell, 0, 1);
  move(shell, free.x + 20, free.y);
  assert.equal(shell.SigK.stripDrag.isDragging(), true, '保存していなければ引ける');
  shell.SigK.stripDrag.cancel();
  shell.window.taskAPI.run = () => new Promise(() => {});
  shell.SigK.save.saveActive();
  assert.equal(shell.SigK.stripInput.isLocked(), true);
  const start = press(shell, 0, 1);
  move(shell, start.x + 20, start.y);
  assert.equal(shell.SigK.stripDrag.isDragging(), false);
});

test('保存していないモザイクのあるページは、ほかの帯の上で線を出さずに札を出し、離すと通知バーで断る（I-d・I8）', async (t) => {
  const shell = await withStrips(t);
  const [a] = ids(shell);
  shell.SigK.tabs.activate(a);
  const plan = shell.SigK.viewer.getPlan();
  plan[1] = { ...plan[1], mosaic: [{ box: [0, 0, 10, 10], block: 8 }] };
  shell.SigK.pageEdit.commit(plan, { after: [] });
  await shell.flush();
  placeStrips(shell);
  dragTo(shell, 0, 1, 12, 300);
  assert.equal(lineOf(shell), null);
  assert.equal(shell.document.querySelector('.strip-drag-refusal').textContent, 'モザイクを保存していないページは写せません。');
  release(shell, 12, 300);
  await shell.flush();
  assert.match(shell.SigK.viewBanner.text(), /^モザイクを保存していないページは写せません。「会議資料.pdf」を上書き保存してから/);
  assert.equal(shell.taskCalls.length, 0);
});
