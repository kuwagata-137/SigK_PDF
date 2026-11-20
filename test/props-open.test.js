'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// プロパティパネルの開閉（spec-7-9 確定事項E1・E2。決定100 ⑤、質問 SH4「案A 設定表示時開閉」）。
// 表示する設定がある時（書き込みツールを選択した時・書き込みを選択した時）だけ開き、それ以外は閉じる。
// jsdom は CSS を解釈しないので、<html> の data-props と、表示域の追従（viewer.refit の呼び出し）で確かめる。

const A = 'C:\\work\\a.pdf';
const SQUARE = { id: '30R', subtype: 'Square', rect: [300, 300, 400, 380], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 4 }, opacity: 1 };

async function withAnnotMode(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: { 0: [SQUARE] } }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

const propsState = (shell) => shell.document.documentElement.getAttribute('data-props');

test('書き込みツールを何も選択していない時は閉じ、書き込みツールを選択すると開く', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  assert.equal(SigK.annotate.getTool(), null);
  assert.equal(propsState(shell), 'closed');
  SigK.annotate.setTool('shape');
  assert.equal(propsState(shell), 'open');
  SigK.annotate.setTool('eraser');
  assert.equal(propsState(shell), 'open', '消しゴム・トリミング・モザイクも書き込みツールなので開く');
  SigK.annotate.setTool(null);
  assert.equal(propsState(shell), 'closed');
});

test('［選択］［ハンド］の時は、書き込みを選択するまで閉じ、選択すると開き、解除すると閉じる', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  for (const tool of ['select', 'hand']) {
    SigK.annotate.setTool(tool);
    assert.equal(propsState(shell), 'closed', `${tool} で書き込みを選択していない`);
    SigK.annotate.select('30R');
    assert.equal(propsState(shell), 'open', `${tool} で書き込みを選択した`);
    SigK.annotate.select(null);
    assert.equal(propsState(shell), 'closed', `${tool} で選択を解除した`);
  }
});

test('開閉するたびに表示域を追従させ（倍率の計算し直し）、同じ状態のままなら何もしない', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  let refits = 0;
  const original = SigK.viewer.refit;
  SigK.viewer.refit = (...args) => {
    refits += 1;
    return original(...args);
  };
  t.after(() => {
    SigK.viewer.refit = original;
  });
  SigK.annotate.setTool('shape');
  assert.equal(refits, 1);
  SigK.annotate.setShapeKind('circle');
  assert.equal(refits, 1, '開いたままなら追従しない');
  SigK.annotate.setTool(null);
  assert.equal(refits, 2);
});
