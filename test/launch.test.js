'use strict';

// 起動要求の受け口のテスト（spec-1-6 確定事項77・78）。
//
// 引数の解釈そのものは test/launch-args.test.js が見ている。ここは
// 「届いた要求で画面がどうなるか」と「取りこぼさない順番か」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// jsdom 側で作られた配列は Node 側の配列と realm が違う。素の値へ写して比べる。
const plain = (value) => structuredClone(value);

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function withShell(t) {
  const shell = await createShell({
    files: {
      [A]: makeSource({ path: A, name: 'a.pdf' }),
      [B]: makeSource({ path: B, name: 'b.pdf' }),
    },
  });
  t.after(() => shell.cleanup());
  return shell;
}

test('購読を始めてから ready を送る', async (t) => {
  const shell = await withShell(t);

  // 逆にすると取りこぼす（実測で7通中5通が消えた）。順番そのものが仕様である。
  assert.deepEqual(shell.shellCalls, ['onLaunch', 'ready']);
});

test('open の要求でタブが開く', async (t) => {
  const shell = await withShell(t);

  const opened = await shell.SigK.launch.handle({ intent: 'open', paths: [A, B] });

  assert.equal(opened, 2);
  assert.equal(shell.SigK.tabs.count(), 2);
  assert.deepEqual(plain(shell.SigK.tabs.list().map((tab) => tab.path)), [A, B]);
});

test('同じファイルが2回来ても、タブは1枚のままである', async (t) => {
  const shell = await withShell(t);

  await shell.SigK.launch.handle({ intent: 'open', paths: [A, A] });

  assert.equal(shell.SigK.tabs.count(), 1);
});

test('塊⑤ では open 以外を扱わない', async (t) => {
  const shell = await withShell(t);

  assert.equal(await shell.SigK.launch.handle({ intent: 'merge', paths: [A, B] }), 0);
  assert.equal(await shell.SigK.launch.handle(null), 0);
  assert.equal(await shell.SigK.launch.handle({ intent: 'open' }), 0);
  assert.equal(shell.SigK.tabs.count(), 0);
});

test('メインから届いた要求でも開く', async (t) => {
  const shell = await withShell(t);

  await Promise.all(shell.fireLaunch({ intent: 'open', paths: [A] }));

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.path, A);
});
