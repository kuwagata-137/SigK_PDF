'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 道具の段の幅を測って隠す層（spec-4b-5b 確定事項25）。jsdom は幅を測れないので、測った値を渡すか、要素の幅を差し替えて見る。
// どこから隠すかの計算そのものは edit-bar-fit.test.js が見る。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ pdfjs: createPdfjsStub(), files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

// 段の子（道具と区切り線）。
function childrenOf(document) {
  return [...document.getElementById('edit-bar').children].filter((node) => node.matches('.edit-sep, .edit-item:not(.edit-more)'));
}

// 段の子を全部 48px（区切り線は 7px）とし、右端から hide 個が入らない幅の値を組む。
function measured(document, hide) {
  const children = childrenOf(document).map((node) => ({ width: node.classList.contains('edit-sep') ? 7 : 48, sep: node.classList.contains('edit-sep') }));
  const keep = children.length - hide;
  const span = children.slice(0, keep).reduce((sum, child, index) => sum + child.width + (index > 0 ? 5 : 0), 0);
  return { children, available: span + 5 + 48, gap: 5, padding: [0, 0], moreWidth: 48 };
}

test('入りきらない道具に隠す印を付けて「その他」を出し、入りきれば元に戻す', async (t) => {
  const { document, SigK } = await withShell(t);
  const overflow = SigK.editBarOverflow;
  const item = document.querySelector('#edit-bar .edit-more');
  assert.equal(item.hidden, true, 'jsdom では段の幅が 0 なので何も隠さない');
  assert.equal(overflow.fit(measured(document, 2)), true);
  const hidden = childrenOf(document).filter((node) => node.classList.contains(overflow.OVERFLOW));
  assert.deepEqual(hidden.map((node) => node.querySelector('.edit-name').textContent), ['消しゴム', 'ノート']);
  assert.equal(item.hidden, false);
  assert.deepEqual([...overflow.hiddenButtons().map((button) => button.dataset.tool)], ['eraser', 'note']);
  // 入りきる幅なら全部見せる。
  const all = measured(document, 0);
  assert.equal(overflow.fit({ ...all, available: 10000 }), false);
  assert.equal(childrenOf(document).some((node) => node.classList.contains(overflow.OVERFLOW)), false);
  assert.equal(item.hidden, true);
  assert.equal(overflow.hiddenButtons().length, 0);
});

test('区切り線のすぐ右の道具までを隠すと、区切り線も隠す', async (t) => {
  const { document, SigK } = await withShell(t);
  const overflow = SigK.editBarOverflow;
  // 右端の区切り線より右（ペン・マーカー・ノート）を隠す幅。区切り線は末尾に残らない。
  const children = childrenOf(document);
  const lastSep = children.map((node) => node.classList.contains('edit-sep')).lastIndexOf(true);
  overflow.fit(measured(document, children.length - lastSep));
  assert.equal(children[lastSep].classList.contains(overflow.OVERFLOW), true);
  assert.equal(children[lastSep - 1].classList.contains(overflow.OVERFLOW), false);
});

test('測るときは子の幅に左右の余白を足し、段の内側の余白と gap を引く（DOM から測る）', async (t) => {
  const { document, window, SigK } = await withShell(t);
  const bar = document.getElementById('edit-bar');
  const children = childrenOf(document);
  for (const node of [...children, bar.querySelector('.edit-more')])
    node.getBoundingClientRect = () => ({ width: node.classList.contains('edit-sep') ? 1 : 48, height: 50 });
  const realStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = (node) => {
    if (node === bar)
      return { columnGap: '5px', paddingLeft: '14px', paddingRight: '14px' };
    if (node.classList?.contains('edit-sep'))
      return { marginLeft: '3px', marginRight: '3px' };
    return realStyle(node);
  };
  t.after(() => { window.getComputedStyle = realStyle; });
  const total = children.reduce((sum, node, index) => sum + (node.classList.contains('edit-sep') ? 7 : 48) + (index > 0 ? 5 : 0), 0) + 28;
  Object.defineProperty(bar, 'clientWidth', { configurable: true, value: total });
  assert.equal(SigK.editBarOverflow.fit(), false, 'ちょうど入る');
  Object.defineProperty(bar, 'clientWidth', { configurable: true, value: total - 1 });
  assert.equal(SigK.editBarOverflow.fit(), true);
  // 1px 足りないと、ノート（48＋間 5）を隠しても「その他」（48＋間 5）を置くぶんで足りず、消しゴムも隠れる。
  assert.deepEqual([...SigK.editBarOverflow.hiddenButtons().map((button) => button.dataset.tool)], ['eraser', 'note']);
});

test('ResizeObserver があっても、窓の大きさが変われば測り直して開いている一覧を閉じる（高さだけが変わったとき。点検 8）', async (t) => {
  const { document, SigK } = await withShell(t);
  const listeners = {};
  const win = { ResizeObserver: class { observe() {} }, addEventListener: (type, fn) => { listeners[type] = fn; } };
  assert.equal(SigK.editBarOverflow.init(document, win), true);
  SigK.editBarOverflow.fit(measured(document, 2));
  document.getElementById('edit-more').click();
  assert.equal(SigK.editBarMore.isOpen(), true);
  assert.equal(typeof listeners.resize, 'function');
  listeners.resize();
  assert.equal(SigK.editBarMore.isOpen(), false);
});
