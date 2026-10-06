'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/page-crop.js');
require('../renderer/page-boxes.js');
const boxes = globalThis.SigK.pageBoxes;

// 紙全体の大きさ（MediaBox）を読む口（spec-4b-6a 確定事項9・10）。ワーカーの口（pdfAPI.readBoxes）は偽物に差し替える。
// 読んだ結果はファイルのパス・大きさ・更新時刻を鍵に持つので、テストごとに別のファイルを使う。

const calls = [];
const answers = [];

globalThis.pdfAPI = {
  available: true,
  readBoxes: async (spec) => {
    calls.push(spec);
    const next = answers.shift();
    return typeof next === 'function' ? next(spec) : next;
  },
};

function fileOf(name, size = 100, mtimeMs = 1) {
  return { path: `C:\\work\\${name}.pdf`, size, mtimeMs };
}

test('load は開いているファイルの紙全体をワーカーに 1 回だけ読ませ、ページ順の箱を返す', async () => {
  const file = fileOf('once');
  answers.push({ ok: true, boxes: [[0, 0, 600, 800], [10, 20, 310, 420]] });
  assert.equal(boxes.statusOf(file), 'none');
  const first = boxes.load(file);
  assert.equal(boxes.statusOf(file), 'loading');
  assert.deepEqual(await first, [[0, 0, 600, 800], [10, 20, 310, 420]]);
  assert.deepEqual(await boxes.load(file), [[0, 0, 600, 800], [10, 20, 310, 420]]);
  assert.deepEqual(calls.filter((spec) => spec.source === file.path), [{ source: file.path, expect: { size: 100, mtimeMs: 1 } }]);
  assert.equal(boxes.statusOf(file), 'ready');
  assert.deepEqual(boxes.mediaBoxOf(file, 1), [10, 20, 310, 420]);
  assert.equal(boxes.mediaBoxOf(file, 5), null);
});

test('保存して大きさか更新時刻が変われば読み直す', async () => {
  answers.push({ ok: true, boxes: [[0, 0, 600, 800]] }, { ok: true, boxes: [[0, 0, 500, 700]] });
  await boxes.load(fileOf('saved', 100, 1));
  assert.deepEqual(await boxes.load(fileOf('saved', 120, 2)), [[0, 0, 500, 700]]);
  assert.deepEqual(boxes.mediaBoxOf(fileOf('saved', 100, 1), 0), [0, 0, 600, 800]);
  assert.equal(calls.filter((spec) => spec.source === fileOf('saved').path).length, 2);
});

test('読めなかった・口が投げた・パスが無いときは null で、紙全体は分からないまま読み直さない', async () => {
  const unreadable = fileOf('unreadable');
  answers.push({ ok: false, reason: 'unreadable' });
  assert.equal(await boxes.load(unreadable), null);
  assert.equal(boxes.statusOf(unreadable), 'failed');
  assert.equal(boxes.mediaBoxOf(unreadable, 0), null);
  assert.equal(await boxes.load(unreadable), null);
  assert.equal(calls.filter((spec) => spec.source === unreadable.path).length, 1);

  answers.push(() => { throw new Error('IPC が切れた'); });
  assert.equal(await boxes.load(fileOf('thrown')), null);
  assert.equal(await boxes.load(null), null);
  assert.equal(await boxes.load({ path: '' }), null);
  assert.equal(boxes.statusOf(null), 'none');
});
