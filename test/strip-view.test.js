'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// ツールモードの帯の画面の骨組み（spec-2-5 確定事項D1〜D7。見本 screenshots/strips2-merge.png・strips2-empty.png）。帯はタブを描くだけで、
// 並び・選択・未保存の印・閉じるはタブと食い違わない（危ない所 1）。描く処理は strip-thumbs.test.js。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const C = 'C:\\work\\議事録.pdf';

async function withShell(t, { paths = [A, B, C], ...options } = {}) {
  const files = Object.fromEntries([A, B, C].map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files, ...options });
  t.after(() => shell.cleanup());
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

const strips = (document) => [...document.querySelectorAll('#strips .strip')];
const namesOf = (document) => strips(document).map((node) => node.querySelector('.fname').textContent);
const button = (node, act) => node.querySelector(`.strip-btn[data-act="${act}"]`);
const disabled = (node) => node.getAttribute('aria-disabled') === 'true';

test('出すと、タブの並びのとおりに帯を並べ、選んでいるタブの帯に印を付ける', async (t) => {
  const { SigK, document } = await withShell(t);
  assert.equal(document.getElementById('strips-screen').hidden, true, '出すまでは隠れている');
  assert.equal(strips(document).length, 0, '隠れている間は組まない');

  SigK.strips.setShown(true);
  assert.equal(document.getElementById('strips-screen').hidden, false);
  assert.deepEqual(namesOf(document), ['会議資料.pdf', '見積書.pdf', '議事録.pdf']);
  const [first, second, third] = strips(document);
  assert.deepEqual(strips(document).map((node) => node.querySelector('.strip-no').textContent), ['1', '2', '3']);
  assert.match(first.querySelector('.count').textContent, /^\d+ ページ$/);
  assert.equal(third.classList.contains('sel'), true, '最後に開いたタブを選んでいる');
  assert.equal(first.classList.contains('sel'), false);
  assert.equal(disabled(button(first, 'up')), true);
  assert.equal(disabled(button(first, 'down')), false);
  assert.equal(disabled(button(third, 'down')), true);
  assert.equal(second.style.height, '188px');
  const pages = second.querySelectorAll('.strip-page');
  assert.equal(pages.length, SigK.tabs.peek(SigK.tabs.list()[1].id).sizes.length);
  assert.equal(pages[0].querySelector('.cap').textContent, '1');
  assert.equal(pages[0].querySelector('.sheet').style.height, '104px');
  assert.equal(document.getElementById('strip-drop').classList.contains('big'), false);
  assert.equal(document.querySelector('#strips').lastElementChild.id, 'strip-drop', '受け口はいちばん下');
});

test('タブを並べ替える・選ぶ・閉じる・編集すると、帯もそのとおりになる', async (t) => {
  const { SigK, document } = await withShell(t);
  SigK.strips.setShown(true);
  const [a, b, c] = SigK.tabs.list().map((tab) => tab.id);

  SigK.tabs.reorder([c, a, b]);
  assert.deepEqual(namesOf(document), ['議事録.pdf', '会議資料.pdf', '見積書.pdf']);
  assert.deepEqual(strips(document).map((node) => node.querySelector('.strip-no').textContent), ['1', '2', '3']);
  assert.equal(document.querySelector('#strips').lastElementChild.id, 'strip-drop');

  SigK.tabs.activate(b);
  assert.deepEqual(strips(document).map((node) => node.classList.contains('sel')), [false, false, true]);

  assert.equal(strips(document)[2].querySelector('.unsaved').hidden, true);
  SigK.pageEdit.rotate(90, [0]);
  assert.equal(strips(document)[2].querySelector('.unsaved').hidden, false, '保存していない変更あり');

  SigK.tabs.forceCloseTab(c);
  assert.deepEqual(namesOf(document), ['会議資料.pdf', '見積書.pdf']);
  assert.deepEqual([...SigK.strips.getState().ids], [a, b]);
});

test('隠れている間は組まず、出したときに今のタブに合わせる', async (t) => {
  const { SigK, document } = await withShell(t, { paths: [A] });
  SigK.strips.setShown(true);
  SigK.strips.setShown(false);
  await SigK.tabs.openPath(B);
  assert.equal(SigK.strips.getState().stale, true);
  assert.deepEqual(namesOf(document), ['会議資料.pdf']);
  SigK.strips.setShown(true);
  assert.deepEqual(namesOf(document), ['会議資料.pdf', '見積書.pdf']);
});

test('開けなかったタブの帯は名前を赤くし、理由を出し、フロッピーを押せない', async (t) => {
  const error = Object.assign(new Error('broken'), { name: 'InvalidPDFException' });
  const { SigK, document } = await withShell(t, { paths: [A], pdfjs: createPdfjsStub({ openError: error }) });
  SigK.strips.setShown(true);
  const [node] = strips(document);
  assert.equal(node.classList.contains('failed'), true);
  assert.match(node.querySelector('.strip-note').textContent, /壊れている/);
  assert.equal(node.querySelector('.strip-note').hidden, false);
  assert.equal(node.querySelector('.count').hidden, true);
  assert.equal(disabled(button(node, 'save')), true);
  assert.equal(node.querySelectorAll('.strip-page').length, 0);
});

test('帯が 1 本も無いときは大きな受け口に最近使ったファイルを 5 件まで出し、押すとタブで開く', async (t) => {
  const recent = Array.from({ length: 7 }, (_unused, index) => ({ path: `C:\\work\\r${index}.pdf`, name: `r${index}.pdf` }));
  recent[0] = { path: A, name: '会議資料.pdf' };
  recent[1] = { path: 'C:\\Users\\taro\\Documents\\会議\\書類\\r1.pdf', name: 'r1.pdf' };
  const { SigK, document, flush } = await withShell(t, { paths: [], recent });
  SigK.strips.setShown(true);
  const zone = document.getElementById('strip-drop');
  assert.equal(zone.classList.contains('big'), true);
  assert.equal(document.getElementById('strip-drop-text').textContent, 'PDF を落とすか［ファイルを選ぶ…］で選ぶと、ここにページの帯が並びます');
  const rows = [...document.querySelectorAll('#strip-drop-recent .row')];
  assert.equal(rows.length, 5);
  assert.equal(rows[0].querySelector('.p').textContent, 'C:\\work');
  assert.equal(rows[1].querySelector('.p').textContent, 'C:\\Users\\…\\書類', '深いフォルダーは途中を縮める（見本どおり）');
  assert.equal(rows[1].title, 'C:\\Users\\taro\\Documents\\会議\\書類\\r1.pdf');

  rows[0].click();
  await flush();
  assert.deepEqual(namesOf(document), ['会議資料.pdf']);
  assert.equal(zone.classList.contains('big'), false);
  assert.equal(document.getElementById('strip-drop-recent').hidden, true);
});

test('受け口の［ファイルを選ぶ…］は「開く PDF を選ぶ」で複数を選び、選んだ順にタブで開く', async (t) => {
  const { SigK, document, flush, openSourceCalls } = await withShell(t, { paths: [], openSourceResults: [{ paths: [C, A] }, { canceled: true }] });
  SigK.strips.setShown(true);
  document.getElementById('strip-drop-pick').click();
  await flush();
  assert.equal(openSourceCalls.length, 1);
  assert.deepEqual(namesOf(document), ['議事録.pdf', '会議資料.pdf']);
  assert.deepEqual([...SigK.tabs.list().map((tab) => tab.name)], ['議事録.pdf', '会議資料.pdf']);

  assert.equal(await SigK.stripDropZone.pick(), false, '取り消し');
  assert.equal(SigK.tabs.count(), 2);
});
