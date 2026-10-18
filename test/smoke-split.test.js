'use strict';

// 起動確認の分割の台本（spec-2-2b 確定事項K1・K2）。台本は実機で回すものだが、jsdom の画面でも評価して、
// 操作の列が盤に効き、控えの形がそろっていることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { setupScript, runScript } = require('../smoke-split.js');
const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

test('台本はどの指定でも式として読める', () => {
  assert.doesNotThrow(() => new vm.Script(setupScript({ source: A })));
  assert.doesNotThrow(() => new vm.Script(setupScript({ source: A, ops: 'each,select:2-3,skip,state,size:large', outDir: 'C:\\out', rule: 'pages' })));
  for (const cancel of [false, true])
    assert.doesNotThrow(() => new vm.Script(runScript({ cancel })));
});

test('操作の列が盤に効き、その時点の控えと最後の控えを返す', async (t) => {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: 12 }, () => A4) }),
    files: { [A]: makeSource({ path: A }) },
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  const result = await shell.window.eval(setupScript({ source: A, ops: 'at:5+9,cut:3,select:9-11,skip,state,undo,nothing', outDir: 'C:\\out' }));
  assert.deepEqual(structuredClone(result.applied), ['at:5+9', 'cut:3', 'select:9-11', 'skip', 'undo', 'unknown:nothing']);
  assert.equal(result.mode, 'tools');
  assert.equal(result.selected, 'split');
  assert.deepEqual(structuredClone(result.states[0].parts), [2, 2, 4, 1]);
  assert.equal(result.states[0].summary, '9・10・11 ページ目を書き出さずに、残りの 9 ページを 4 つのファイルに分けます。');
  assert.deepEqual(structuredClone(result.final.parts), [2, 2, 4, 4], '最後の undo で書き出さない印が戻る');
  assert.deepEqual(structuredClone(result.targets), ['C:\\out\\a_001.pdf', 'C:\\out\\a_002.pdf', 'C:\\out\\a_003.pdf', 'C:\\out\\a_004.pdf']);
  // PDF は帯で開き、その帯の中に盤を広げる（spec-2-5 確定事項G1・G13）。
  assert.equal(result.final.strips, 1);
  assert.deepEqual(structuredClone({ ...result.final.host, height: undefined }), { name: 'a.pdf', inStrip: true, board: true, height: undefined });
});
