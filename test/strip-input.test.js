'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 帯を押す処理（spec-2-5 確定事項D3〜D6・D9・D10）。どれもタブの関数を呼ぶので、帯とタブが食い違わない（危ない所 1）。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';

async function withStrips(t, options = {}) {
  const files = Object.fromEntries([A, B, C].map((filePath) => [filePath, makeSource({ path: filePath, mtimeMs: 1000 })]));
  const shell = await createShell({ files, ...options });
  t.after(() => shell.cleanup());
  for (const filePath of [A, B, C])
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.strips.setShown(true);
  await shell.flush();
  return shell;
}

const strip = (document, index) => document.querySelectorAll('#strips .strip')[index];
const names = (SigK) => [...SigK.tabs.list().map((tab) => tab.name)];
const click = (shell, node, init = {}) => node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

test('帯を押すとそのタブを選び、［↑］［↓］で帯とタブの並びが一緒に変わる', async (t) => {
  const shell = await withStrips(t);
  const { SigK, document } = shell;
  click(shell, strip(document, 0).querySelector('.fname'));
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list()[0].id);
  assert.equal(strip(document, 0).classList.contains('sel'), true);

  click(shell, strip(document, 0).querySelector('[data-act="down"]'));
  assert.deepEqual(names(SigK), ['b.pdf', 'a.pdf', 'c.pdf']);
  assert.equal(strip(document, 1).querySelector('.fname').textContent, 'a.pdf');
  assert.equal(strip(document, 1).classList.contains('sel'), true, '選んでいる帯は動いた先でも選んだまま');

  click(shell, strip(document, 2).querySelector('[data-act="up"]'));
  assert.deepEqual(names(SigK), ['b.pdf', 'c.pdf', 'a.pdf']);
  click(shell, strip(document, 0).querySelector('[data-act="up"]'));
  assert.deepEqual(names(SigK), ['b.pdf', 'c.pdf', 'a.pdf'], '先頭の［↑］は押せない');
});

test('［×］はタブを閉じ、フロッピーは変更があるときだけそのタブを上書き保存する', async (t) => {
  const ok = { ok: true, path: B, signature: { size: 2048, mtimeMs: 2000 } };
  const shell = await withStrips(t, { taskResults: [ok] });
  const { SigK, document, flush } = shell;
  const [a, b] = SigK.tabs.list().map((tab) => tab.id);

  click(shell, strip(document, 0).querySelector('[data-act="save"]'));
  await flush();
  assert.equal(shell.taskCalls.length, 0, '変更が無ければ何もしない');
  assert.notEqual(SigK.tabs.activeId(), a, '選びもしない');

  SigK.tabs.activate(b);
  SigK.pageEdit.rotate(90, [0]);
  SigK.tabs.activate(a);
  click(shell, strip(document, 1).querySelector('[data-act="save"]'));
  await flush();
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.taskCalls[0].spec.target, B);
  assert.equal(SigK.tabs.activeId(), b, '保存した帯を選んだまま');
  assert.equal(SigK.tabs.isDirty(b), false);

  click(shell, strip(document, 2).querySelector('[data-act="close"]'));
  assert.deepEqual(names(SigK), ['a.pdf', 'b.pdf']);
  assert.equal(document.querySelectorAll('#strips .strip').length, 2);
});

test('ページを押すとタブを選んでページを選び、Shift・Ctrl で広げる。Esc と並びの変化で外れる', async (t) => {
  const shell = await withStrips(t);
  const { SigK, document } = shell;
  const [a] = SigK.tabs.list().map((tab) => tab.id);
  const pages = () => [...strip(document, 0).querySelectorAll('.strip-page')];
  const picked = () => pages().map((cell) => cell.classList.contains('picked'));

  click(shell, pages()[0].querySelector('.sheet'));
  assert.equal(SigK.tabs.activeId(), a);
  assert.deepEqual(picked(), [true, false, false]);
  click(shell, pages()[2], { shiftKey: true });
  assert.deepEqual(picked(), [true, true, true]);
  click(shell, pages()[1], { ctrlKey: true });
  assert.deepEqual(picked(), [true, false, true]);

  const esc = new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(esc);
  assert.equal(esc.defaultPrevented, true);
  assert.deepEqual(picked(), [false, false, false]);

  click(shell, pages()[1]);
  SigK.pageEdit.rotate(90, [1]);
  assert.deepEqual(picked(), [false, false, false], '並びが変わったら外れる');
  assert.deepEqual([...SigK.stripSelection.get(a)], []);
});

// 帯の紙・ボタンの押しは既定の動きを止めるのでフォーカスが移らず、右の欄のチェックボックスなどに残ったフォーカスに Esc が届いていた
// （起動確認の 3 回目で見つけた）。押したら、残ったフォーカスを外す。
test('右の欄の欄にフォーカスがあっても、帯の紙を押すとフォーカスが外れ、Esc で紙の選択が外れる', async (t) => {
  const shell = await withStrips(t);
  const { document } = shell;
  shell.SigK.tools.select('merge');
  const box = document.querySelector('#merge-list .merge-pick .cbox');
  box.focus();
  assert.equal(document.activeElement, box);
  const cell = strip(document, 0).querySelectorAll('.strip-page')[1];
  const down = new shell.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  cell.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  click(shell, cell);
  assert.notEqual(document.activeElement, box, 'フォーカスを外す');
  const esc = new shell.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(esc);
  assert.deepEqual([...shell.SigK.stripSelection.get(shell.SigK.tabs.list()[0].id)], []);
});

test('ページをダブルクリックすると、閲覧モードでそのページを開く', async (t) => {
  const shell = await withStrips(t);
  const { SigK, document } = shell;
  const cell = strip(document, 1).querySelectorAll('.strip-page')[2];
  cell.dispatchEvent(new shell.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(document.documentElement.getAttribute('data-mode'), 'view');
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list()[1].id);
  assert.equal(SigK.viewer.getState().current, 2);
});

test('開いている途中と、保存・ツールの実行の途中は、帯を押しても効かない', async (t) => {
  const shell = await withStrips(t);
  const { SigK, document, window } = shell;
  const active = SigK.tabs.activeId();
  window.SigK.save.isBusy = () => true;
  click(shell, strip(document, 0).querySelector('.fname'));
  click(shell, strip(document, 0).querySelector('[data-act="down"]'));
  assert.equal(SigK.tabs.activeId(), active);
  assert.deepEqual(names(SigK), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.equal(SigK.stripInput.isLocked(), true);
});

// ツールは確認の窓・保存先の窓・出力先の確かめの間も実行中と数える。その間に帯を替えると、確かめた帯と違う帯を書く（点検の直し）。
for (const name of ['toolsMerge', 'toolsToImage', 'toolsWatermark', 'toolsFlatten']) {
  test(`帯の画面を使うツール（${name}）の実行の途中は、帯を押しても効かない`, async (t) => {
    const shell = await withStrips(t);
    const { SigK, document, window } = shell;
    const active = SigK.tabs.activeId();
    window.SigK[name].isRunning = () => true;
    click(shell, strip(document, 0).querySelector('.fname'));
    assert.equal(SigK.tabs.activeId(), active);
    assert.equal(SigK.stripInput.isLocked(), true);
  });
}
