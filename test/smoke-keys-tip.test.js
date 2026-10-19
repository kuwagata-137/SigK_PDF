'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、説明の吹き出し（spec-2-5 第 J 章）を確かめる口。カーソルを当てる操作 hover・strip-hover
// （smoke-keys-strips.js）と、様子の控えの tip の欄（smoke-keys-page.js）。本物の入力は実機でしか動かないので、
// ここは送るコマンドの形と、jsdom の画面で控えの欄が埋まることを見る（smoke-keys.test.js と同じ考え）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, OP_NAMES } = require('../smoke-keys.js');
const page = require('../smoke-keys-page.js');
const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

// debugger と executeJavaScript の代わり。送ったマウスと、座標を測るのに流した式を控える。point が null なら「無い」と答える。
function fakeWindow(point) {
  const sent = [];
  const scripts = [];
  let attached = false;
  return {
    sent,
    scripts,
    webContents: {
      debugger: {
        attach: () => { attached = true; },
        detach: () => { attached = false; },
        isAttached: () => attached,
        sendCommand: async (name, params) => { sent.push([name, params.type, params.x, params.y, params.button, params.buttons]); },
      },
      executeJavaScript: async (code) => { scripts.push(code); return point; },
    },
  };
}

test('hover・strip-hover は要素の真ん中へ mouseMoved だけを送る（押さない）', async () => {
  for (const name of ['hover', 'strip-hover'])
    assert.ok(OP_NAMES.includes(name), name);
  const win = fakeWindow([120, 34]);
  const report = await run(win, 'hover:btn-save,strip-hover:0:save');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.applied, ['hover:btn-save', 'strip-hover:0:save']);
  assert.deepEqual(win.sent, [
    ['Input.dispatchMouseEvent', 'mouseMoved', 120, 34, 'none', 0],
    ['Input.dispatchMouseEvent', 'mouseMoved', 120, 34, 'none', 0],
  ], 'button は none（left のままだと、Chromium は左ボタンを押したまま動かしたと受け取り、pointerover の buttons が 1 になる）');
  assert.match(win.scripts[0], /querySelectorAll\("\[id=\\"btn-save\\"\]"\)\[0\]/);
  assert.match(win.scripts[1], /querySelectorAll\("#strips \.strip"\)\[0\]/);
  assert.match(win.scripts[1], /\.strip-btn\[data-act=\\"save\\"\]/);
});

test('hover・strip-hover は相手が無い・番号が読めないと止めて problems に書く', async () => {
  assert.match((await run(fakeWindow(null), 'hover:btn-nothing')).problems[0], /hover:btn-nothing: 要素 btn-nothing が無い/);
  assert.match((await run(fakeWindow(null), 'strip-hover:2:save')).problems[0], /strip-hover:2:save: 2 番目の帯の save が無い/);
  assert.match((await run(fakeWindow([1, 1]), 'strip-hover:a:save')).problems[0], /帯 を数として読めない/);
});

test('様子の控えの tip に、説明の吹き出しが出ているか・鍵・名前・全文が入る', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  const state = async () => structuredClone(await shell.window.eval(page.stateScript)).tip;
  assert.deepEqual(await state(), { shown: false, key: null, name: null, text: null, side: null, popover: null, box: null });

  shell.SigK.tip.DELAY_MS = 30;
  const save = shell.document.getElementById('btn-save');
  save.dispatchEvent(new shell.window.PointerEvent('pointerover', { bubbles: true, buttons: 0, pointerType: 'mouse' }));
  await new Promise((resolve) => shell.window.setTimeout(resolve, 60));
  const shown = await state();
  assert.equal(shown.shown, true);
  assert.equal(shown.key, 'bar.save');
  assert.equal(shown.name, '上書き保存');
  assert.match(shown.text, /^上書き保存開いているファイルに、今の変更を書き込みます。.*キー: Ctrl\+S$/);
  assert.equal(shown.side, 'below');
  assert.deepEqual(shown.box, [0, 0, 0, 0], 'jsdom は寸法を持たないので 0（実機は矩形）');
});
