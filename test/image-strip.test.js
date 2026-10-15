'use strict';

// 「変換する画像」の帯（spec-2-5 確定事項H4・H5・H7。見本 screenshots/strips3-convert.png）。
//
// 足す・外す・注意の行・実行中に外せないことは test/tools-convert.test.js、引いて並べ替える細かいところは test/image-strip-drag.test.js。
// ここは「いつ・どこに出すか」「サムネイルの絵」「同時に頼む本数」「枠の行き来」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const DIR = 'C:\\photo';
const A = `${DIR}\\a.png`;
const B = `${DIR}\\b.jpg`;
const C = `${DIR}\\c.png`;
const D = `${DIR}\\d.png`;
const SCAN = `${DIR}\\scan.tif`;
const PDF = `${DIR}\\x.pdf`;

const INFOS = {
  [A]: { kind: 'png', width: 1200, height: 800 },
  [B]: { kind: 'jpeg', width: 600, height: 900 },
  [C]: { kind: 'png', width: 64, height: 64 },
  [D]: { kind: 'png', width: 64, height: 64 },
  [SCAN]: { kind: 'tiff', width: 1200, height: 800, frames: [{ width: 1200, height: 800 }, { width: 600, height: 900 }, { width: 64, height: 64 }] },
};

async function createImageShell(t, { open = [PDF], ...options } = {}) {
  const shell = await createShell({ ...options, files: { [PDF]: makeSource({ path: PDF }) }, imageInfos: INFOS });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of open)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');
  return shell;
}

function gated() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

const host = (shell) => shell.document.getElementById('image-strip');
const items = (shell) => [...shell.document.querySelectorAll('#image-strip .img-item')];
const pdfStrip = (shell) => shell.document.querySelector('#strips .strip');
const framed = (node) => node.classList.contains('sel');
const click = (shell, node) => node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const URL_A = 'data:image/png;base64,QQ==';

test('画像の帯は、ツールモードで画像→PDF を選んでいて画像が 1 枚以上あるときだけ、PDF の帯と受け口の間に出す（H4）', async (t) => {
  const shell = await createImageShell(t);
  const { SigK, document: doc } = shell;
  assert.equal(host(shell).hidden, true, '画像が無い');
  await SigK.toolsConvert.addPaths([A, B]);
  assert.equal(host(shell).hidden, false);
  assert.equal(doc.getElementById('image-strip-count').textContent, '2 枚（左から順にページになります）');
  assert.equal(host(shell).parentElement.id, 'strips');
  assert.equal(host(shell).nextElementSibling.id, 'strip-drop', '受け口の前');
  assert.equal(pdfStrip(shell).compareDocumentPosition(host(shell)) & shell.window.Node.DOCUMENT_POSITION_FOLLOWING, shell.window.Node.DOCUMENT_POSITION_FOLLOWING, 'PDF の帯の後ろ');
  assert.equal(host(shell).classList.contains('strip'), false, 'タブではないので帯の数え上げに入れない');

  SigK.tools.select('merge');
  assert.equal(host(shell).hidden, true, 'ほかのツール');
  assert.equal(SigK.toolsConvert.rows().length, 2, '画像は覚えたまま');
  SigK.tools.select('convert');
  assert.equal(host(shell).hidden, false);
  SigK.shell.setMode(doc, 'view');
  assert.equal(SigK.imageStrip.isShown(), false, '閲覧モード');
});

test('サムネイルは届いた画像から絵にし、届くまでと作れない画像は形式の名前、TIFF には「N ページ」の札を付ける（H5）', async (t) => {
  const slow = gated();
  const shell = await createImageShell(t, { imageThumbnails: { [A]: slow.promise, [B]: { error: '作れません' } } });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, SCAN]);
  await shell.flush();

  assert.equal(items(shell)[0].querySelector('img'), null, 'まだ届いていない');
  assert.equal(items(shell)[0].querySelector('.img-kind').textContent, 'PNG');
  assert.equal(items(shell)[1].querySelector('img'), null);
  assert.equal(items(shell)[1].querySelector('.img-kind').textContent, 'JPEG', '作れない画像');
  assert.equal(items(shell)[2].querySelector('.img-thumb img').getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.equal(items(shell)[2].querySelector('.img-pages').textContent, '3 ページ');
  assert.equal(items(shell)[2].querySelector('.cap').textContent, 'scan.tif');

  const other = items(shell)[2];
  slow.release({ ok: true, url: URL_A, width: 192, height: 128 });
  await shell.flush();
  assert.equal(items(shell)[0].querySelector('.img-thumb img').getAttribute('src'), URL_A);
  assert.equal(items(shell)[2], other, '届いた画像の枠だけを差し替え、帯ごと描き直さない');
});

test('サムネイルは同時に 2 本まで頼み、帯から外した画像の絵は捨てる（H5）', async (t) => {
  const gates = Object.fromEntries([A, B, C, D].map((filePath) => [filePath, gated()]));
  const shell = await createImageShell(t, { imageThumbnails: Object.fromEntries(Object.entries(gates).map(([key, gate]) => [key, gate.promise])) });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, C, D]);
  await shell.flush();
  assert.deepEqual(structuredClone(shell.thumbnailCalls), [A, B]);
  assert.equal(SigK.imageThumbs.getState().pending, SigK.imageThumbs.PARALLEL);

  gates[A].release({ ok: true, url: URL_A, width: 192, height: 128 });
  await shell.flush();
  assert.deepEqual(structuredClone(shell.thumbnailCalls), [A, B, C], '1 本終わったら次を頼む');
  assert.equal(SigK.imageThumbs.get(A).url, URL_A);

  SigK.toolsConvert.remove(SigK.toolsConvert.rows()[0].id);
  assert.equal(SigK.imageThumbs.get(A), null, '外した画像の絵は捨てる');
  SigK.toolsConvert.remove(SigK.toolsConvert.rows()[0].id);
  gates[B].release({ ok: true, url: URL_A, width: 192, height: 128 });
  await shell.flush();
  assert.equal(SigK.imageThumbs.get(B), null, '作っている間に外した画像は覚えない');
});

test('画像を足すと画像の帯に枠が付き、PDF の帯を押すと枠はそちらへ移り、画像の帯を押すと戻る。映しているタブは替わらない（H7）', async (t) => {
  const shell = await createImageShell(t);
  const { SigK } = shell;
  const tabId = SigK.tabs.activeId();
  assert.equal(framed(pdfStrip(shell)), true);

  await SigK.toolsConvert.addPaths([A]);
  assert.equal(framed(host(shell)), true);
  assert.equal(framed(pdfStrip(shell)), false);

  click(shell, pdfStrip(shell).querySelector('.fname'));
  assert.equal(framed(host(shell)), false);
  assert.equal(framed(pdfStrip(shell)), true);

  const down = new shell.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  items(shell)[0].dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, '押してもフォーカスを移さない');
  click(shell, items(shell)[0]);
  assert.equal(framed(host(shell)), true);
  assert.equal(framed(pdfStrip(shell)), false);
  assert.equal(SigK.tabs.activeId(), tabId);

  SigK.tools.select('merge');
  assert.equal(framed(pdfStrip(shell)), true, '画像の帯を隠したら PDF の帯に枠を戻す');
});

// 点検で見つかった（2026-10-15）。外したときの描き直しは画像の帯を隠すだけで、PDF の帯の枠を付け直さなかった。
test('画像をすべて外して画像の帯が消えたら、PDF の帯に枠を戻す（見出しの［×］でも、最後の 1 枚の［×］でも）', async (t) => {
  const shell = await createImageShell(t);
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  assert.equal(framed(pdfStrip(shell)), false);
  doc.getElementById('image-strip-clear').click();
  assert.equal(host(shell).hidden, true);
  assert.equal(framed(pdfStrip(shell)), true, '見出しの［×］');

  await SigK.toolsConvert.addPaths([A]);
  assert.equal(framed(pdfStrip(shell)), false);
  items(shell)[0].querySelector('.img-x').click();
  assert.equal(host(shell).hidden, true);
  assert.equal(framed(pdfStrip(shell)), true, '最後の 1 枚の［×］');
});

// 点検で見つかった（2026-10-15）。サムネイルは見えている画像（と左右 2 枚）だけ頼むが、前は帯の幅が変わっても頼み直さず、
// 窓を広げて新しく見えた画像は、横にスクロールするまで形式の名前の紙のままだった。
const MANY = Array.from({ length: 14 }, (_, index) => `${DIR}\\p${String(index).padStart(2, '0')}.png`);
const MANY_INFOS = Object.fromEntries(MANY.map((filePath) => [filePath, { kind: 'png', width: 640, height: 480 }]));

async function createWideShell(t) {
  const shell = await createShell({ files: { [PDF]: makeSource({ path: PDF }) }, imageInfos: MANY_INFOS });
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.SigK.tabs.openPath(PDF);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');
  // jsdom は幅を数えないので、画像を並べる所の幅を差し替える（はじめは 4 枚分）。
  const strip = { width: shell.SigK.imageStrip.ITEM_STEP * 4 };
  Object.defineProperty(shell.document.getElementById('image-strip-items'), 'clientWidth', { configurable: true, get: () => strip.width });
  return { shell, strip };
}

const requested = (shell) => new Set(shell.thumbnailCalls);
const imageNo = (from, to) => MANY.slice(from, to);

test('窓を広げて帯の幅が変わったら、新しく見えた画像のサムネイルを頼む（左右 2 枚の先読みも）', async (t) => {
  const { shell, strip } = await createWideShell(t);
  await shell.SigK.toolsConvert.addPaths(MANY);
  await shell.flush();
  assert.deepEqual([...requested(shell)].sort(), imageNo(0, 6), '4 枚分の幅と先読みの 2 枚');

  strip.width = shell.SigK.imageStrip.ITEM_STEP * 10;
  shell.window.dispatchEvent(new shell.window.Event('resize'));
  await shell.flush();
  assert.deepEqual([...requested(shell)].sort(), imageNo(0, 12));
});

test('左のツールの一覧を閉じて帯の幅だけが広がったときも、画像を並べる所の大きさの変化で頼む（ResizeObserver）', async (t) => {
  const { shell, strip } = await createWideShell(t);
  const watchers = [];
  shell.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { watchers.push({ target, callback: this.callback }); }
  };
  await shell.SigK.toolsConvert.addPaths(MANY);
  await shell.flush();
  assert.deepEqual(watchers.map((entry) => entry.target.id), ['image-strip-items'], '画像の帯を初めて出したときに 1 つだけ見張る');

  strip.width = shell.SigK.imageStrip.ITEM_STEP * 10;
  for (const { callback } of watchers)
    callback([]);
  await shell.flush();
  assert.deepEqual([...requested(shell)].sort(), imageNo(0, 12));

  await shell.SigK.toolsConvert.addPaths([MANY[0]]);
  assert.equal(watchers.length, 1, '描き直しても見張りを増やさない');
});
