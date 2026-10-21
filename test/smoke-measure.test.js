'use strict';

// 起動確認 SIGK_SMOKE_MEASURE の手順（smoke-measure.js。spec-6-1 タスク D の D5）。本物は起動確認で通す。
// ここは偽の app と窓で、安全装置（空きメモリが少なければ開かない）と、固まったときの印を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { run, withHangGuard } = require('../smoke-measure.js');

const app = { getAppMetrics: () => [{ type: 'Tab', memory: { workingSetSize: 2048 } }] };

test('パソコンの空きメモリが下限を切っていたら、開かずに止めて理由を残す', async () => {
  const opened = [];
  const win = { webContents: { executeJavaScript: async (code) => { opened.push(code); return { opened: true, ms: 1, pages: 1 }; } } };
  const report = await run({ app, win, paths: ['a.pdf', 'b.pdf'], minFreeMb: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(opened, []);
  assert.match(report.stopped, /1 本目から開かなかった/);
  assert.equal(report.baseline.appMb, 2);
});

test('開くたびに時間とメモリを残し、開けなかった（画面の処理が落ちた）ら、そこで止める', async () => {
  let calls = 0;
  const win = { webContents: { executeJavaScript: async () => {
    calls += 1;
    if (calls === 2)
      throw new Error('Render frame was disposed');
    return { opened: true, ms: 5, pages: 3 };
  } } };
  const report = await run({ app, win, paths: ['a.pdf', 'b.pdf', 'c.pdf'], minFreeMb: 0 });
  assert.equal(report.opens.length, 2);
  assert.equal(report.opens[0].pages, 3);
  assert.equal(report.opens[1].failed, 'Render frame was disposed');
});

test('返事が時間の上限より長く無ければ、固まった印を返す', async () => {
  assert.deepEqual(await withHangGuard(new Promise(() => {}), 20), { hung: true });
  assert.equal(await withHangGuard(Promise.resolve('ok'), 20), 'ok');
});

test('上書き保存は、最後のファイルが一時フォルダの下の写しのときだけ（ユーザーの実ファイルを上書きしない。付則C）', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const { isTemporary } = require('../smoke-measure.js');
  assert.equal(isTemporary(path.join(os.tmpdir(), 'copy', 'big.pdf')), true);
  assert.equal(isTemporary(path.join(os.homedir(), 'Documents', 'big.pdf')), false);
  const win = { webContents: { executeJavaScript: async () => ({ opened: true, ms: 1, pages: 1 }) } };
  const report = await run({ app, win, paths: [path.join(os.homedir(), 'Documents', 'big.pdf')], save: true, minFreeMb: 0 });
  assert.match(report.save.skipped, /一時フォルダの下に無い/);
});
