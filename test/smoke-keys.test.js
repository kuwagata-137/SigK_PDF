'use strict';

// 起動確認 SIGK_SMOKE_KEYS（spec-4b-7a 確定事項J）。本物の入力を流すところ（debugger）は実機でしか動かないので、
// ここは操作列とキーの読み取り、画面側の式が式として読めること、jsdom の画面で評価して内部 API から埋まることを見る
// （名前の打ち間違いは実機まで気づかないため）。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { keyEvent, parseSpec, pointOf, OP_NAMES } = require('../smoke-keys.js');
const page = require('../smoke-keys-page.js');
const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

test('操作列は , で区切り、空の項目を飛ばし、: の後ろを引数にする', () => {
  const steps = parseSpec(' esc, key:Delete,,press:0:100x700,type:a:b ');
  assert.deepEqual(steps.map((step) => [step.raw, step.name, step.args]), [
    ['esc', 'esc', []],
    ['key:Delete', 'key', ['Delete']],
    ['press:0:100x700', 'press', ['0', '100x700']],
    ['type:a:b', 'type', ['a', 'b']],
  ]);
  assert.deepEqual(parseSpec(undefined), []);
  assert.deepEqual(pointOf('100x700'), [100, 700]);
});

test('キーの名前を Input.dispatchKeyEvent の引数にする（Ctrl・Shift・Alt と - を読む）', () => {
  assert.deepEqual(keyEvent('Escape'), { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, modifiers: 0 });
  assert.deepEqual([keyEvent('ctrl+-').key, keyEvent('ctrl+-').code, keyEvent('ctrl+-').modifiers], ['-', 'Minus', 2]);
  assert.equal(keyEvent('-').modifiers, 0);
  assert.equal(keyEvent('shift+ctrl+z').modifiers, 10);
  assert.equal(keyEvent('alt+Delete').modifiers, 1);
  assert.equal(keyEvent('F13'), null);
});

test('操作の名前は main 側と画面側で重ならない', () => {
  assert.deepEqual(OP_NAMES.filter((name) => page.ACTION_NAMES.includes(name)), []);
  assert.equal(page.actionScript('nothing', ''), null);
});

test('画面側の式はどれも式として読める', () => {
  const scripts = [
    page.pointScript(0, 100, 700), page.boxScript('props-opacity-range'), page.thumbScript(2),
    page.shapeScript('square', 0, [100, 700], [300, 600]), page.stateScript,
    ...page.ACTION_NAMES.map((name) => page.actionScript(name, name === 'select-pages' ? '0-1' : '1')),
  ];
  for (const script of scripts)
    assert.doesNotThrow(() => new vm.Script(script), script);
});

test('画面で評価すると、図形を描き、検索バー・ページの選択・倍率を変え、様子を内部 API から控える', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  const run = async (script) => structuredClone(await shell.window.eval(script));

  await run(page.actionScript('mode', 'annot'));
  assert.equal(await run(page.shapeScript('square', 0, [100, 700], [300, 600])), 1);
  assert.equal(Array.isArray(await run(page.pointScript(0, 100, 700))), true);
  await run(page.actionScript('find', 'あいう'));
  await run(page.actionScript('zoom', '0.1'));
  let state = await run(page.stateScript);
  assert.equal(state.mode, 'annot');
  assert.equal(state.annotCount, 1);
  assert.equal(state.annotSelected, 1);
  assert.equal(state.find, true);
  assert.equal(state.focus, 'find-input');
  assert.equal(state.zoom, '10%');
  assert.deepEqual(state.dialogs, []);
  assert.equal(state.print.result, null);

  await run(page.actionScript('mode', 'pages'));
  await run(page.actionScript('select-pages', '0-1'));
  await run(page.actionScript('dialog', 'info'));
  state = await run(page.stateScript);
  assert.equal(state.pageSelected, 2);
  assert.deepEqual(state.dialogs, ['doc-info']);
});
