'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// フルスクリーンモード（版 1.5.0 の①。質問 FS1「案A」。docs/spec-7-11-view-font.md）。ツールバーなどを隠してページだけを表示し、
// ウインドウを画面全体に広げる（メインの windowAPI.setFullScreen）。ツールバーの［見開き］の右の［フルスクリーン］ボタンか F11 キーで
// 入り、Esc キー（今の Esc の働きを先に行う）か F11 キーで戻る。jsdom は CSS を解釈しないので、<html> の data-fullscreen で確かめる。

const A = 'C:\\work\\a.pdf';

async function withShell(t, mode = 'view') {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, mode);
  return shell;
}

function key(shell, name) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  shell.document.body.dispatchEvent(event);
  return event;
}

const state = (shell) => shell.document.documentElement.getAttribute('data-fullscreen');
const button = (shell) => shell.document.getElementById('btn-fullscreen');
const hint = (shell) => shell.document.querySelector('.fullscreen-hint');

test('F11 キーで入り、もう一度 F11 キーで戻る。入る時と戻る時にウインドウのフルスクリーンを切り替える', async (t) => {
  const shell = await withShell(t);
  assert.equal(state(shell), null);
  const event = key(shell, 'F11');
  assert.equal(event.defaultPrevented, true);
  assert.equal(state(shell), 'on');
  assert.equal(shell.SigK.fullscreenMode.isOn(), true);
  assert.deepEqual(shell.fullScreenCalls, [true]);
  key(shell, 'F11');
  assert.equal(state(shell), null);
  assert.deepEqual(shell.fullScreenCalls, [true, false]);
});

test('入った時に、終了の操作の案内を表示する', async (t) => {
  const shell = await withShell(t);
  key(shell, 'F11');
  assert.equal(hint(shell)?.textContent, 'Esc キーか F11 キーを押すと、フルスクリーンモードを終了します');
  key(shell, 'F11');
  assert.equal(hint(shell), null, '戻ったら案内を消す');
});

test('［フルスクリーン］ボタンは［見開き］の右にあり、クリックで入る', async (t) => {
  const shell = await withShell(t);
  const node = button(shell);
  assert.equal(node.previousElementSibling.id, 'btn-facing');
  assert.equal(node.getAttribute('aria-label'), 'フルスクリーン');
  assert.equal(node.getAttribute('data-tip'), 'bar.fullscreen');
  assert.equal(node.getAttribute('aria-disabled'), null);
  node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(state(shell), 'on');
});

test('ツールモードと、文書を開いていない時は、ボタンを押せず F11 キーでも入らない', async (t) => {
  const shell = await withShell(t, 'tools');
  assert.equal(button(shell).getAttribute('aria-disabled'), 'true');
  key(shell, 'F11');
  assert.equal(state(shell), null);
  const empty = await createShell({});
  t.after(() => empty.cleanup());
  assert.equal(empty.document.getElementById('btn-fullscreen').getAttribute('aria-disabled'), 'true');
  key(empty, 'F11');
  assert.equal(empty.document.documentElement.getAttribute('data-fullscreen'), null);
});

test('閲覧・ページ編集・編集モードで入れる', async (t) => {
  for (const mode of ['view', 'pages', 'annot']) {
    const shell = await withShell(t, mode);
    key(shell, 'F11');
    assert.equal(state(shell), 'on', mode);
  }
});

test('Esc キーは今の働きを先に行い、何も無い時にフルスクリーンモードを終了する（閲覧の［ハンド］は 1 回目で［選択］に戻る）', async (t) => {
  const shell = await withShell(t);
  shell.SigK.pointerMode.press('hand');
  key(shell, 'F11');
  key(shell, 'Escape');
  assert.equal(shell.SigK.pointerMode.get(), 'select');
  assert.equal(state(shell), 'on', '1 回目はハンドを選択に戻すだけ');
  key(shell, 'Escape');
  assert.equal(state(shell), null);
  assert.deepEqual(shell.fullScreenCalls, [true, false]);
});

test('編集モードでは、Esc キーは書き込みツールの選択の解除を先に行う', async (t) => {
  const shell = await withShell(t, 'annot');
  shell.SigK.annotate.setTool('pen');
  key(shell, 'F11');
  key(shell, 'Escape');
  assert.equal(shell.SigK.annotate.getTool(), null);
  assert.equal(state(shell), 'on');
  key(shell, 'Escape');
  assert.equal(state(shell), null);
});

test('フルスクリーンモードのまま、ツールモードに切り替えたら終了する', async (t) => {
  const shell = await withShell(t);
  key(shell, 'F11');
  shell.SigK.shell.setMode(shell.document, 'tools');
  assert.equal(state(shell), null);
  assert.deepEqual(shell.fullScreenCalls, [true, false]);
});

test('Windows の操作などでウインドウのフルスクリーンが解除されたら、フルスクリーンモードも終了する（メインへは送り返さない）', async (t) => {
  const shell = await withShell(t);
  key(shell, 'F11');
  shell.fireFullScreenChanged(false);
  assert.equal(state(shell), null);
  assert.deepEqual(shell.fullScreenCalls, [true]);
});

test('入る時と戻る時に、表示域の大きさに合わせて表示倍率とページの位置を計算し直す', async (t) => {
  const shell = await withShell(t);
  let refits = 0;
  const original = shell.SigK.viewer.refit;
  shell.SigK.viewer.refit = (...args) => {
    refits += 1;
    return original(...args);
  };
  t.after(() => {
    shell.SigK.viewer.refit = original;
  });
  key(shell, 'F11');
  assert.equal(refits, 1);
  key(shell, 'F11');
  assert.equal(refits, 2);
});
