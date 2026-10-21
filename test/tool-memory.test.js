'use strict';

// ツールで選んだ値と最後に使ったツールを覚える（renderer/tool-memory.js。spec-6-1 タスク E の確定事項E-7・E-8。決定81 ⑦）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

const REMEMBERED = {
  watermark: { text: '控え', color: '#d92c2c', position: 'top-right' },
  toImage: { format: 'jpeg', dpi: 300 },
  convert: { paper: 'a3', margin: 'none' },
  split: { rule: 'pages' },
  flatten: { kinds: ['markup', 'note'] },
};

async function withShell(t, options = {}) {
  const shell = await createShell(options);
  t.after(() => shell.cleanup());
  await shell.flush();
  await shell.flush();
  return shell;
}

test('起動したとき、覚えた値を各ツールに当てる（ページの範囲などは覚えていない）', async (t) => {
  const shell = await withShell(t, { preferences: { toolValues: REMEMBERED } });
  const { SigK } = shell;
  assert.equal(SigK.toolsWatermark.settings().text, '控え');
  assert.equal(SigK.toolsWatermark.settings().color, '#d92c2c');
  assert.equal(SigK.toolsWatermark.settings().position, 'top-right');
  assert.equal(SigK.toolsWatermark.settings().pageMode, 'all', '範囲は既定のまま');
  assert.deepEqual({ format: SigK.toolsToImage.settings().format, dpi: SigK.toolsToImage.settings().dpi }, { format: 'jpeg', dpi: 300 });
  assert.equal(SigK.toolsConvert.settings().paper, 'a3');
  assert.equal(SigK.toolsConvert.settings().margin, 'none');
  assert.equal(SigK.toolsSplit.settings().rule, 'pages');
  assert.deepEqual([...SigK.toolsFlatten.choices().kinds].sort(), ['markup', 'note']);
});

// 点検の直し I-1。帯が替わったときに種類を戻す先は、全部ではなく覚えた種類（spec-2-5 確定事項E5-5 の改訂）。
test('フラット化: PDF を開いて帯が対象になっても覚えた種類のままで、右の欄を押しても全部で上書きしない', async (t) => {
  const A = 'C:\\work\\a.pdf';
  const { makeSource } = require('./harness.js');
  const shell = await withShell(t, { preferences: { toolValues: { flatten: { kinds: ['markup', 'note'] } } }, files: { [A]: makeSource({ path: A }) } });
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('flatten');
  await SigK.tabs.openPath(A);
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
  assert.deepEqual([...SigK.toolsFlatten.choices().kinds].sort(), ['markup', 'note']);
  document.getElementById('tool-pane').dispatchEvent(new shell.window.Event('click', { bubbles: true }));
  await SigK.toolMemory.savePending();
  assert.equal(shell.preferencesCalls.some((call) => call.toolValues?.flatten !== undefined), false);
});

test('フラット化: 「覚える」を外していたら、帯が替わったときの種類は全部に戻す（前のまま）', async (t) => {
  const A = 'C:\\work\\a.pdf';
  const { makeSource } = require('./harness.js');
  const shell = await withShell(t, { preferences: { toolValues: { flatten: { kinds: ['markup'] } }, rememberToolValues: false }, files: { [A]: makeSource({ path: A }) } });
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('flatten');
  await SigK.tabs.openPath(A);
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
  assert.deepEqual([...SigK.toolsFlatten.choices().kinds].sort(), ['markup', 'note', 'other', 'shape', 'text']);
});

test('「ツールで選んだ値を覚える」を外していたら、覚えた値を当てない', async (t) => {
  const shell = await withShell(t, { preferences: { toolValues: REMEMBERED, rememberToolValues: false } });
  assert.equal(shell.SigK.toolsWatermark.settings().text, '社外秘');
  assert.equal(shell.SigK.toolsSplit.settings().rule, 'seq');
});

test('右の欄で値を変えたら、そのツールの覚える値を書く（替わったツールだけ）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('watermark');
  const text = document.getElementById('wm-text');
  text.value = '部外秘';
  text.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  await SigK.toolMemory.savePending();
  const written = shell.preferencesCalls.filter((call) => call.toolValues !== undefined);
  assert.equal(written.length, 1);
  assert.deepEqual(Object.keys(written[0].toolValues), ['watermark']);
  assert.equal(written[0].toolValues.watermark.text, '部外秘');
  assert.equal(shell.savedPreferences().toolValues.watermark.text, '部外秘');
});

test('「覚える」を外していたら、右の欄で値を変えても書かない', async (t) => {
  const shell = await withShell(t, { preferences: { rememberToolValues: false } });
  shell.SigK.toolsSplit.setRule('pages');
  assert.equal(await shell.SigK.toolMemory.savePending(), false);
  assert.equal(shell.preferencesCalls.some((call) => call.toolValues !== undefined), false);
});

test('最後に使ったツールを覚え、起動したときに選んでおく', async (t) => {
  const first = await withShell(t);
  first.SigK.tools.select('toImage');
  await first.flush();
  assert.equal(first.savedPreferences().lastTool, 'toImage');
  const next = await withShell(t, { preferences: { lastTool: 'toImage' } });
  assert.equal(next.SigK.tools.selected(), 'toImage');
});

// 点検の直し M-2。前回のモードを戻すとき（tools.refresh）に今のツールを出し直すのは、ユーザーが選んだとは数えない。
test('前回のモードがツールのまま起動しても、最後に使ったツールを選んでおく', async (t) => {
  const shell = await withShell(t, { ui: { mode: 'tools', pageLayout: 'single', viewPointer: 'select', sidePanel: { open: true, width: 240 } }, preferences: { lastTool: 'toImage' } });
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(shell.SigK.tools.selected(), 'toImage');
});

test('右クリックの「PDF を分割」から起きたときは、最後のツールより、そちらを先にする', async (t) => {
  const A = 'C:\\work\\a.pdf';
  const { makeSource } = require('./harness.js');
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
    preferences: { lastTool: 'toImage' },
    launchOnReady: [{ intent: 'split', paths: [A], batch: { id: 1, first: true } }],
  });
  t.after(() => shell.cleanup());
  await shell.launchSettled();
  await shell.flush();
  await shell.flush();
  assert.equal(shell.SigK.tools.selected(), 'split');
});

test('「最後に使ったツールを覚える」を外していたら、選んでおかず、書きもしない', async (t) => {
  const shell = await withShell(t, { preferences: { lastTool: 'toImage', rememberLastTool: false } });
  assert.equal(shell.SigK.tools.selected(), 'merge');
  shell.SigK.tools.select('split');
  await shell.flush();
  assert.equal(shell.preferencesCalls.some((call) => call.lastTool !== undefined), false);
});
