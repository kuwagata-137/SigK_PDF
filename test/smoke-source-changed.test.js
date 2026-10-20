'use strict';

// 起動確認 SIGK_SMOKE_SOURCE_CHANGED の手順（smoke-source-changed.js。spec-6-1 タスク C の C4）。本物は起動確認で通す。
// ここは偽の app と窓で、手順の順番（開く → 編集 → ふつうの保存 → 編集 → 書き換え → 保存）と、メモリの山の採り方を見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { run } = require('../smoke-source-changed.js');

function fakeApp(samples) {
  let index = 0;
  return { getAppMetrics: () => samples[Math.min(index++, samples.length - 1)] };
}

test('ふつうの保存と、書き換えてからの保存を順に通し、保存ごとのメモリの山（MB）を種類ごとに返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-smoke-changed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'a.pdf');
  const target = path.join(dir, 'b.pdf');
  fs.writeFileSync(source, '%PDF-1.7\n%%EOF\n');
  const calls = [];
  const sizesAtSave = [];
  const win = {
    webContents: {
      executeJavaScript: async (code) => {
        if (code.includes('openPath')) {
          calls.push('open');
          return undefined;
        }
        if (code.includes('pageEdit.rotate')) {
          calls.push('edit');
          return true;
        }
        calls.push('save');
        sizesAtSave.push(fs.statSync(target).size);
        return { ok: true, error: null, bytes: 10, ms: 5, confirmShown: calls.filter((call) => call === 'save').length === 2, banner: '保存しました。' };
      },
    },
  };
  const mb = (value) => value * 1024;
  const app = fakeApp([[{ type: 'Tab', memory: { workingSetSize: mb(100) } }, { type: 'Utility', memory: { workingSetSize: mb(50) } }],
    [{ type: 'Tab', memory: { workingSetSize: mb(300) } }, { type: 'Utility', memory: { workingSetSize: mb(20) } }]]);
  const report = await run({ app, win, source, target });
  assert.deepEqual(calls, ['open', 'edit', 'save', 'edit', 'save']);
  assert.ok(sizesAtSave[1] > sizesAtSave[0], '2 回目の保存の前にファイルを書き換える（大きさが変わる）');
  assert.equal(report.plain.confirmShown, false);
  assert.equal(report.changed.confirmShown, true);
  // 偽の app は採るたびに次の値を返す（1 回目の保存で 2 つとも採り、2 回目は 2 つ目だけ）。山は種類ごとと合計の最大。
  assert.equal(report.plain.peakMb, 320);
  assert.deepEqual(report.plain.peakByType, { Tab: 300, Utility: 50 });
  assert.equal(report.changed.peakMb, 320);
  assert.deepEqual(report.changed.peakByType, { Tab: 300, Utility: 20 });
});
