'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// プロパティパネルの開閉（spec-7-9 確定事項E1・E2。決定101 ⑤、質問 SH4「案A 設定表示時開閉」）。
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

// 版 1.5.0 の⑪（質問 ZM3「案A 重ね表示」）で、開閉のたびに倍率を計算し直す決まり（spec-7-9 確定事項E2）を改めた。
test('開閉するたびに、倍率は計算し直さず（refit を呼ばない）、ページの左右の位置だけを合わせる。同じ状態のままなら何もしない', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  const calls = { refit: 0, recenter: 0 };
  const original = { refit: SigK.viewer.refit, recenter: SigK.viewer.recenter };
  for (const name of ['refit', 'recenter']) {
    SigK.viewer[name] = (...args) => {
      calls[name] += 1;
      return original[name](...args);
    };
  }
  t.after(() => Object.assign(SigK.viewer, original));
  SigK.annotate.setTool('shape');
  assert.deepEqual(calls, { refit: 0, recenter: 1 });
  SigK.annotate.setShapeKind('circle');
  assert.deepEqual(calls, { refit: 0, recenter: 1 }, '開いたままなら何もしない');
  SigK.annotate.setTool(null);
  assert.deepEqual(calls, { refit: 0, recenter: 2 });
});

// 版 1.5.0 の⑪（質問 ZM3「案A 重ね表示」。docs/spec-7-11-view-font.md）。プロパティパネルの幅は、ページの並べ方と倍率の計算に入れない。
// jsdom はレイアウトしないので、表示域の幅（#view の clientWidth）とプロパティパネルの幅（#props の offsetWidth）を、data-props に合わせて差し替える。
function layoutLikeBrowser(shell, { full = 1000, panel = 260 } = {}) {
  const html = shell.document.documentElement;
  const open = () => html.getAttribute('data-mode') === 'annot' && html.getAttribute('data-props') === 'open';
  Object.defineProperty(shell.document.getElementById('view'), 'clientWidth', { get: () => (open() ? full - panel : full), configurable: true });
  Object.defineProperty(shell.document.getElementById('props'), 'offsetWidth', { get: () => (open() ? panel : 0), configurable: true });
}

const pagesBox = (shell) => {
  const pages = shell.document.getElementById('view-pages');
  return { margin: pages.style.marginLeft, width: pages.style.width };
};

test('プロパティパネルを開閉しても、［幅］の表示倍率とページの左右の位置を変えない（版 1.5.0 の⑪）', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  layoutLikeBrowser(shell);
  SigK.viewer.applyFit('width');
  const before = { zoom: SigK.viewer.getState().zoom, box: pagesBox(shell) };
  SigK.annotate.setTool('shape');
  assert.equal(propsState(shell), 'open');
  assert.deepEqual({ zoom: SigK.viewer.getState().zoom, box: pagesBox(shell) }, before, '開いた');
  assert.equal(SigK.viewer.getState().fit, 'width', '［幅］のまま');
  SigK.annotate.setTool(null);
  assert.deepEqual({ zoom: SigK.viewer.getState().zoom, box: pagesBox(shell) }, before, '閉じた');
});

test('表示倍率が数値の時も、プロパティパネルの開閉でページを左右に動かさない（版 1.5.0 の⑪）', async (t) => {
  const shell = await withAnnotMode(t);
  const { SigK } = shell;
  layoutLikeBrowser(shell);
  SigK.viewer.setZoom(0.5);
  const before = pagesBox(shell);
  const contentWidth = parseFloat(before.width);
  assert.equal(parseFloat(before.margin), Math.floor((1000 - contentWidth) / 2), '閉じた時の表示域の中央');
  SigK.annotate.setTool('shape');
  assert.deepEqual(pagesBox(shell), before, '開いても同じ位置（プロパティパネルを含めた幅の中央）');
  SigK.annotate.setTool(null);
  assert.deepEqual(pagesBox(shell), before);
});
