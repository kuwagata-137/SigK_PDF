'use strict';

// 起動確認 SIGK_SMOKE_KEYS の、アプリの窓のフォーカスを外す・戻す操作 blur-window・focus-window（smoke-keys-window.js）。
// Alt+Tab でアプリに戻ったときに説明の吹き出しが出ないかを、窓を出した起動確認で確かめるために足した（docs/07 決定81 ③）。
// 本物の窓は実機でしか動かないので、ここは BrowserWindow の代わりで、呼ぶ順と控えの形を見る（smoke-keys-tip.test.js と同じ考え）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, OP_NAMES } = require('../smoke-keys.js');

// BrowserWindow の代わり。呼んだメソッドを控える。focusWorks が偽なら、focus() を呼んでも活性に戻らない
// （Windows が、後ろにいるアプリが自分の窓を前に出すことを制限している場合）。blurWorks が偽なら、blur() を呼んでも外れない
// （2026-10-20 の実測で 2 回目から起きた）。restore() は活性に戻す。
function fakeWindow({ focusWorks = true, blurWorks = true, page = { hasFocus: true, active: 'act-rotate-right', focusIns: ['act-rotate-right'] } } = {}) {
  const calls = [];
  const scripts = [];
  let focused = true;
  let attached = false;
  return {
    calls,
    scripts,
    blur: () => { calls.push('blur'); if (blurWorks) focused = false; },
    focus: () => { calls.push('focus'); if (focusWorks) focused = true; },
    minimize: () => { calls.push('minimize'); focused = false; },
    restore: () => { calls.push('restore'); focused = true; },
    isFocused: () => focused,
    webContents: {
      debugger: {
        attach: () => { attached = true; },
        detach: () => { attached = false; },
        isAttached: () => attached,
        sendCommand: async () => {},
      },
      executeJavaScript: async (code) => { scripts.push(code); return page; },
    },
  };
}

test('blur-window・focus-window は操作の一覧にある', () => {
  for (const name of ['blur-window', 'focus-window'])
    assert.ok(OP_NAMES.includes(name), name);
});

test('blur-window は focusin の控えを仕掛けてから窓のフォーカスを外し、外れたかを控える', async () => {
  const win = fakeWindow();
  const report = await run(win, 'blur-window');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(win.calls, ['blur']);
  assert.match(win.scripts[0], /__sigkSmokeFocusIns/, '外す前に、ページへ focusin の控えを仕掛ける');
  assert.match(win.scripts[0], /addEventListener\('focusin'/);
  assert.deepEqual(report.states, [{ at: 0, window: { op: 'blur', focused: false } }]);
});

test('blur() で外れなければ、止めて problems に書く（外れたことにして次の操作へ進まない）', async () => {
  const win = fakeWindow({ blurWorks: false });
  const report = await run(win, 'blur-window,state');
  assert.match(report.problems[0], /blur-window: アプリの窓のフォーカスが外れない/);
  assert.deepEqual(win.calls, ['blur']);
  assert.deepEqual(report.applied, []);
});

test('focus-window は focus() で戻し、戻った後の focusin・活性の要素・hasFocus を控える', async () => {
  const win = fakeWindow();
  const report = await run(win, 'blur-window,focus-window');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(win.calls, ['blur', 'focus']);
  assert.deepEqual(report.states[1], {
    at: 1,
    window: { op: 'focus', via: 'focus', focused: true, hasFocus: true, active: 'act-rotate-right', focusIns: ['act-rotate-right'] },
  });
});

test('focus() で活性に戻らないときは minimize() → restore() で戻し、via にそう書く', async () => {
  const win = fakeWindow({ focusWorks: false });
  const report = await run(win, 'blur-window,focus-window');
  assert.deepEqual(report.problems, []);
  assert.deepEqual(win.calls, ['blur', 'focus', 'minimize', 'restore']);
  assert.equal(report.states[1].window.via, 'restore');
  assert.equal(report.states[1].window.focused, true);
});

test('restore() でも戻らなければ、止めて problems に書く（黙って次の操作へ進まない）', async () => {
  const win = fakeWindow({ focusWorks: false });
  win.restore = () => { win.calls.push('restore'); };
  const report = await run(win, 'blur-window,focus-window,state');
  assert.match(report.problems[0], /focus-window: アプリの窓が活性に戻らない/);
  assert.deepEqual(report.applied, ['blur-window']);
});
