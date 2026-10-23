'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ツールモードの紙の倍率（docs/07 決定83。2026-10-23 のユーザーの判断）。ツールバーの［－］［＋］・Ctrl＋＋/－/0・帯の画面の上の
// Ctrl＋ホイールで、PDF の帯・分割の盤・「変換する画像」の帯の紙の大きさを 50〜300% で変える。閲覧の倍率とは別に持ち、起動している間だけ覚える。

function paths(count) {
  return Array.from({ length: count }, (_, index) => `C:\\work\\p${index + 1}.pdf`);
}

async function withTools(t, count = 2) {
  const list = paths(count);
  const files = Object.fromEntries(list.map((filePath) => [filePath, makeSource({ path: filePath })]));
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  for (const filePath of list)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  await shell.flush();
  return shell;
}

function click(shell, id) {
  shell.document.getElementById(id).dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
}

function key(shell, init) {
  const event = new shell.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  shell.document.body.dispatchEvent(event);
  return event;
}

function wheel(shell, { deltaY = -100, ctrl = true } = {}) {
  const event = new shell.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode: 0, ctrlKey: ctrl, clientX: 100, clientY: 100 });
  shell.document.getElementById('strips').dispatchEvent(event);
  return event;
}

const zoomText = (shell) => shell.document.getElementById('zoom-value').textContent;
const firstStrip = (shell) => shell.document.querySelector('#strips .strip');
const firstSheet = (shell) => firstStrip(shell).querySelector('.strip-page .sheet');

test('ツールモードの［＋］は帯の紙の倍率を上げ、閲覧の倍率は変えない。数字はモードごとの倍率を出す', async (t) => {
  const shell = await withTools(t);
  const { SigK, document } = shell;
  assert.equal(SigK.strips.isShown(), true);
  const viewerZoom = SigK.viewer.getState().zoom;
  assert.equal(zoomText(shell), '100%');

  click(shell, 'zoom-in');
  assert.equal(SigK.toolsZoom.get(), 1.25);
  assert.equal(zoomText(shell), '125%');
  assert.equal(SigK.viewer.getState().zoom, viewerZoom, '閲覧の倍率が変わった');

  SigK.shell.setMode(document, 'view');
  assert.equal(zoomText(shell), SigK.viewerLayout.formatZoom(viewerZoom), '閲覧に戻っても帯の倍率を出している');
  click(shell, 'zoom-in');
  assert.equal(SigK.toolsZoom.get(), 1.25, '閲覧の［＋］で帯の倍率が変わった');

  // 起動している間は覚えている。
  SigK.shell.setMode(document, 'tools');
  assert.equal(zoomText(shell), '125%');
});

test('段は 50・67・75・100・125・150・175・200・250・300%。端で止まり、Ctrl＋0 で 100% に戻る', async (t) => {
  const shell = await withTools(t);
  const { SigK } = shell;
  assert.deepEqual([...SigK.toolsZoom.STEPS], [0.5, 0.67, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);

  for (let index = 0; index < 12; index += 1)
    click(shell, 'zoom-in');
  assert.equal(SigK.toolsZoom.get(), 3);
  assert.equal(zoomText(shell), '300%');

  for (let index = 0; index < 12; index += 1)
    click(shell, 'zoom-out');
  assert.equal(SigK.toolsZoom.get(), 0.5);

  assert.equal(key(shell, { key: '0', ctrlKey: true }).defaultPrevented, true);
  assert.equal(SigK.toolsZoom.get(), 1);
  assert.equal(key(shell, { key: '-', ctrlKey: true }).defaultPrevented, true);
  assert.equal(SigK.toolsZoom.get(), 0.75);
  assert.equal(key(shell, { key: '=', ctrlKey: true }).defaultPrevented, true);
  assert.equal(SigK.toolsZoom.get(), 1);
});

test('帯の画面の上の Ctrl＋ホイールで変わり、素のホイールは帯の画面を送る（止めない）', async (t) => {
  const shell = await withTools(t);
  const { SigK } = shell;

  const plain = wheel(shell, { ctrl: false });
  assert.equal(plain.defaultPrevented, false);
  assert.equal(SigK.toolsZoom.get(), 1);

  const up = wheel(shell, { deltaY: -100 });
  assert.equal(up.defaultPrevented, true);
  assert.equal(SigK.toolsZoom.get(), 1.25);
});

test('帯が 1 本も無いときは［－］［＋］も灰色で、押しても変わらない。帯ができると押せる', async (t) => {
  const late = 'C:\\work\\late.pdf';
  const shell = await createShell({ files: { [late]: makeSource({ path: late }) } });
  t.after(() => shell.cleanup());
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();

  assert.equal(document.getElementById('zoom').getAttribute('aria-disabled'), 'true');
  click(shell, 'zoom-in');
  assert.equal(key(shell, { key: '+', ctrlKey: true }).defaultPrevented, false);
  assert.equal(SigK.toolsZoom.get(), 1);

  await SigK.tabs.openPath(late);
  await shell.flush();
  assert.equal(document.getElementById('zoom').hasAttribute('aria-disabled'), false, '帯ができても灰色のまま');
  click(shell, 'zoom-in');
  assert.equal(SigK.toolsZoom.get(), 1.25);
});

test('倍率どおりに PDF の帯の紙と帯の高さが変わる（見出しの高さは変えない）', async (t) => {
  const shell = await withTools(t);
  const { SigK } = shell;
  const layout = SigK.stripLayout;
  assert.equal(firstSheet(shell).style.height, '104px');
  assert.equal(firstStrip(shell).style.height, `${layout.STRIP_HEIGHT}px`);

  SigK.toolsZoom.set(2);
  await shell.flush();
  assert.equal(firstSheet(shell).style.height, '208px');
  assert.equal(firstStrip(shell).style.height, `${layout.stripHeight(2)}px`);
  assert.equal(layout.stripHeight(2) - layout.STRIP_HEIGHT, 104, '紙のほかの寸法まで変わった');

  SigK.toolsZoom.set(0.5);
  await shell.flush();
  assert.equal(firstSheet(shell).style.height, '52px');
});

test('描く枚数の上限は面積で数える（100% で 160 枚、200% で 40 枚、300% で 18 枚、50% で 640 枚）', async (t) => {
  const shell = await withTools(t);
  const layout = shell.SigK.stripLayout;
  assert.deepEqual([1, 2, 3, 0.5].map((zoom) => layout.limit(zoom)), [160, 40, 18, 640]);

  // 帯の絵も、今の倍率の上限までしか持たない。
  shell.SigK.toolsZoom.set(3);
  const items = Array.from({ length: 30 }, (_, page) => ({ strip: 0, page, tabId: shell.SigK.tabs.list()[0].id, near: false }));
  shell.SigK.stripThumbs.want(items);
  const state = shell.SigK.stripThumbs.getState();
  assert.ok(state.drawn + state.pending + state.queued <= 18, `上限を超えて持った: ${JSON.stringify(state)}`);
});

test('いちばん上を見ているときに倍率を変えても、1 本目の帯の上の余白ごと、いちばん上のまま', async (t) => {
  const shell = await withTools(t, 3);
  const strips = shell.document.getElementById('strips');
  assert.equal(strips.scrollTop, 0);
  click(shell, 'zoom-in');
  click(shell, 'zoom-in');
  assert.equal(strips.scrollTop, 0, '1 本目の帯の見出しが上に隠れた');
});

test('倍率を変えても、左上に見えていた帯と、帯の中の横の場所を保つ', async (t) => {
  const shell = await withTools(t, 6);
  const { SigK, document } = shell;
  const strips = document.getElementById('strips');
  const layout = SigK.stripLayout;
  const tops = layout.tops(SigK.strips.heights());
  strips.scrollTop = tops[3];
  const pages = firstStrip(shell).querySelector('.strip-pages');
  pages.scrollLeft = 50;
  const before = SigK.strips.lineOf(SigK.tabs.list()[0].id).total;

  click(shell, 'zoom-in');
  click(shell, 'zoom-in');

  const after = layout.tops(SigK.strips.heights());
  assert.equal(strips.scrollTop, after[3], '左上に見えていた 4 本目の帯がずれた');
  const total = SigK.strips.lineOf(SigK.tabs.list()[0].id).total;
  assert.ok(total > before);
  assert.ok(Math.abs(pages.scrollLeft - 50 * total / before) < 1, `横の場所がずれた: ${pages.scrollLeft}`);
});
