'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ツールモードの Ctrl+A（spec-2-5 確定事項I9。決定80 ㊶）。strip-keys.js。
// 枠の帯の全部のページを選ぶ。✂ の盤が出ているときは盤の全部のページ。文字を打つ欄の中では欄の全選択。帯が無ければ何もせず、既定の動き
// （画面の文字がまとめて選ばれる）も止める。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';

async function withTools(t, { paths = [A, B], tool = 'merge' } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) } });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
  await shell.flush();
  return shell;
}

function selectAll(shell, target = shell.document.body) {
  const event = new shell.window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

test('Ctrl+A は枠の帯の全部のページを選ぶ', async (t) => {
  const shell = await withTools(t);
  const b = shell.SigK.tabs.activeId();
  const event = selectAll(shell);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(b)), [0, 1, 2]);
  assert.equal(shell.document.querySelectorAll('#strips .strip.sel .strip-page.picked').length, 3);
});

test('✂ の盤が出ているときは、盤の全部のページを選ぶ', async (t) => {
  const shell = await withTools(t, { tool: 'split' });
  selectAll(shell);
  assert.deepEqual(structuredClone(shell.SigK.splitSelection.range(shell.SigK.toolsSplitEdit.selection())), { from: 0, to: 2 });
});

test('文字を打つ欄の中では、欄の文字の全選択に任せる', async (t) => {
  const shell = await withTools(t);
  const b = shell.SigK.tabs.activeId();
  const field = shell.document.querySelector('#merge-list input[type="text"], #merge-list input:not([type])');
  assert.ok(field, '結合の範囲の欄がある');
  field.focus();
  const event = selectAll(shell, field);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(structuredClone(shell.SigK.stripSelection.get(b)), []);
});

test('帯が 1 本も無ければ何もせず、画面の文字がまとめて選ばれる既定の動きも止める', async (t) => {
  const shell = await withTools(t, { paths: [] });
  const event = selectAll(shell);
  assert.equal(event.defaultPrevented, true);
});
