'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、ページの右クリックメニューと削除確認画面の操作（spec-7-5。smoke-keys-page-menu.js）。本物の入力は実機でしか
// 動かないので、ここは送るマウスの並びと、画面側の式が式として読めること、jsdom の画面で評価して内部 API から埋まることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { run, OP_NAMES } = require('../smoke-keys.js');
const menu = require('../smoke-keys-page-menu.js');
const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

// debugger と executeJavaScript の代わり。送ったマウスを [type, button, buttons, modifiers] で控える。
function fakeWindow(point) {
  const sent = [];
  let attached = false;
  return {
    sent,
    webContents: {
      debugger: {
        attach: () => { attached = true; },
        detach: () => { attached = false; },
        isAttached: () => attached,
        sendCommand: async (name, params) => { sent.push([params.type, params.button, params.buttons, params.modifiers]); },
      },
      executeJavaScript: async () => point,
    },
  };
}

test('右クリックメニューの操作を登録し、画面側の式は式として読める', () => {
  for (const name of ['thumb-click', 'thumb-rclick', 'strip-rclick', 'menu-pick', 'page-state'])
    assert.ok(OP_NAMES.includes(name), name);
  assert.doesNotThrow(() => new vm.Script(menu.blankScript('thumbs')));
  assert.doesNotThrow(() => new vm.Script(menu.blankScript('strip', 1)));
  assert.doesNotThrow(() => new vm.Script(menu.stateScript));
});

test('右クリックは右ボタンを押して離し、項目とサムネイルのクリックは左ボタンで押して離す', async () => {
  const win = fakeWindow([100, 200]);
  const report = await run(win, 'thumb-rclick:0,menu-pick:copy,thumb-click:2:ctrl');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(win.sent, [
    ['mouseMoved', 'none', 0, 0], ['mousePressed', 'right', 2, 0], ['mouseReleased', 'right', 0, 0],
    ['mouseMoved', 'left', 0, 0], ['mousePressed', 'left', 1, 0], ['mouseReleased', 'left', 0, 0],
    ['mouseMoved', 'left', 0, 2], ['mousePressed', 'left', 1, 2], ['mouseReleased', 'left', 0, 2],
  ]);
});

test('相手が無い・番号が読めないときは止めて problems に書く', async () => {
  assert.match((await run(fakeWindow(null), 'thumb-rclick:3')).problems[0], /thumb-rclick:3: 3 番目のサムネイルが無い/);
  assert.match((await run(fakeWindow(null), 'strip-rclick:0:blank')).problems[0], /0 番目の帯のページの右の空きが無い/);
  assert.match((await run(fakeWindow(null), 'menu-pick:paste')).problems[0], /メニューの paste が無い/);
  assert.match((await run(fakeWindow([1, 2]), 'strip-rclick:a:0')).problems[0], /帯 を数として読めない/);
});

test('様子の控えに、メニュー・確認画面・ページ数・選択・コピーの有無がある', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  const state = structuredClone(await shell.window.eval(menu.stateScript));
  assert.equal(state.menu, null);
  assert.deepEqual(state.dialogs, []);
  assert.equal(typeof state.pageCount, 'number');
  assert.deepEqual(state.gridSelection, []);
  assert.deepEqual(state.stripSelection, []);
  assert.equal(state.clipboard, 0);
});
