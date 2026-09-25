'use strict';

// 起動確認 SIGK_SMOKE_LAUNCH の画面側スクリプト（spec-5-1 確定事項36）。
//
// 実機では main.js が executeJavaScript で流す。ここは「式として読めること」と、jsdom の画面で
// 評価して、報告の欄（モード・道具・タブ・結合と画像→PDF の行・分割の対象・帯・預かり）が
// 実際の内部 API から埋まることを見る（名前の打ち間違いは実機まで気づかないため）。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { launchScript } = require('../smoke-launch.js');
const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const IMG = 'C:\\photo\\a.png';

test('スクリプトは式として読め、待ち時間は 0 以上の整数に丸める', () => {
  for (const wait of [0, 900, 12.7, -5, 'x'])
    assert.doesNotThrow(() => new vm.Script(launchScript(wait)));
  assert.match(launchScript(12.7), /setTimeout\(resolve, 13\)/);
  assert.match(launchScript(-5), /setTimeout\(resolve, 0\)/);
  assert.match(launchScript('x'), /setTimeout\(resolve, 0\)/);
});

test('画面で評価すると、束を当てた後の様子を報告する', async (t) => {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }), [B]: makeSource({ path: B, name: 'b.pdf' }) },
    imageInfos: { [IMG]: { kind: 'png', width: 120, height: 80 } },
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK } = shell;
  await SigK.launch.handle({ intent: 'toPdf', paths: [IMG], batch: { id: 1, first: true } });
  await SigK.launch.handle({ intent: 'split', paths: [B], batch: { id: 2, first: true } });
  await SigK.launch.handle({ intent: 'merge', paths: [B], batch: { id: 3, first: true } });
  await SigK.launch.handle({ intent: 'merge', paths: [A], batch: { id: 3, first: false } });

  const report = structuredClone(await shell.window.eval(launchScript(0)));

  assert.equal(report.mode, 'tools');
  assert.equal(report.tool, 'merge');
  assert.equal(report.tabCount, 0);
  assert.deepEqual(report.names, []);
  assert.deepEqual(report.merge.map((row) => [row.name, row.batch, row.pageCount, row.blocked]),
    [['a.pdf', 3, 3, null], ['b.pdf', 3, 3, null]]);
  assert.deepEqual(report.convert.map((row) => [row.name, row.batch, row.kind]), [['a.png', 1, 'png']]);
  assert.deepEqual(report.split, { name: 'b.pdf', pageCount: 3, blocked: null });
  assert.equal(report.banner, 'ファイル名の順に並べました。エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。');
  assert.equal(report.pending, 0);
});

test('何も届いていなければ、空の報告になる', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  await shell.flush();

  const report = structuredClone(await shell.window.eval(launchScript(0)));

  assert.equal(report.mode, 'view');
  assert.equal(report.tabCount, 0);
  assert.deepEqual([report.merge, report.convert, report.split], [[], [], null]);
  assert.equal(report.openedName, null);
});
