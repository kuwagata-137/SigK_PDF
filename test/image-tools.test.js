'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 画像のタブで使えない道具（spec-7-1 確定事項C1〜C3）と、画像のタブを対象にしないツール（確定事項A8）・紙全体を読まない口（確定事項A7）。

const PNG = 'C:\\work\\shot.png';
const PDF = 'C:\\work\\a.pdf';
const BLOCKED = ['highlight', 'underline', 'strikeout', 'note'];

async function withTabs(t, options = {}) {
  const shell = await createShell({
    files: {
      [PNG]: { ...makeSource({ path: PNG }), image: { kind: 'png', frames: [{ width: 300, height: 200 }] } },
      [PDF]: makeSource({ path: PDF }),
    },
    pdfjs: createPdfjsStub({ sizes: [{ width: 300, height: 200 }] }),
    ...options,
  });
  t.after(() => shell.cleanup());
  return shell;
}

const button = (shell, tool) => shell.document.querySelector(`#edit-bar .edit-tool[data-tool="${tool}"]`);

test('画像のタブでは 4 つの道具を灰色にし、吹き出しを理由の文に替える。PDF のタブへ移ると戻す', async (t) => {
  const shell = await withTabs(t);
  await shell.SigK.tabs.openPath(PNG);
  await shell.flush();
  for (const tool of BLOCKED) {
    assert.equal(button(shell, tool).getAttribute('aria-disabled'), 'true', tool);
    assert.equal(button(shell, tool).dataset.tip, `edit.${tool}.image`, tool);
  }
  assert.equal(button(shell, 'pen').getAttribute('aria-disabled'), null, 'ほかの道具は使える');
  assert.equal(shell.SigK.tipContent.resolve(button(shell, 'highlight')).desc, '画像には選べる文字が無いので、使えません。');
  assert.equal(shell.SigK.tipContent.resolve(button(shell, 'note')).desc, '画像に保存すると付箋の本文が残らないので、画像では使えません。');

  await shell.SigK.tabs.openPath(PDF);
  await shell.flush();
  for (const tool of BLOCKED) {
    assert.equal(button(shell, tool).getAttribute('aria-disabled'), null, tool);
    assert.equal(button(shell, tool).dataset.tip, `edit.${tool}`, tool);
  }
});

test('画像のタブでは、灰色の道具を押しても持たず、setTool でも持たない', async (t) => {
  const shell = await withTabs(t);
  await shell.SigK.tabs.openPath(PNG);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  button(shell, 'highlight').click();
  assert.equal(shell.SigK.annotate.getTool(), null);
  shell.SigK.annotate.setTool('note');
  assert.equal(shell.SigK.annotate.getTool(), null);
  button(shell, 'pen').click();
  assert.equal(shell.SigK.annotate.getTool(), 'pen');
});

test('使えない道具を持ったまま画像のタブへ移ると、道具を離す', async (t) => {
  const shell = await withTabs(t);
  await shell.SigK.tabs.openPath(PDF);
  await shell.flush();
  shell.SigK.annotate.setTool('underline');
  assert.equal(shell.SigK.annotate.getTool(), 'underline');
  await shell.SigK.tabs.openPath(PNG);
  await shell.flush();
  assert.equal(shell.SigK.annotate.getTool(), null);
});

test('画像のタブは 1 本を対象にするツールの対象にならず、理由を出す（確定事項A8）', async (t) => {
  const shell = await withTabs(t);
  await shell.SigK.tabs.openPath(PNG);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  await shell.flush();
  assert.equal(shell.document.getElementById('tools-view').textContent.includes('「shot.png」は画像なので、PDF として保存すると使えます。'), true);
  shell.SigK.tools.select('merge');
  await shell.flush();
  const row = shell.SigK.toolsMerge.rows().find((entry) => entry.path === PNG);
  assert.equal(row.blocked, '画像なので、PDF として保存すると結合に使えます');
});

test('画像のタブでトリミングの道具を持っても、紙全体を読む口を呼ばない（確定事項A7）', async (t) => {
  const shell = await withTabs(t);
  await shell.SigK.tabs.openPath(PNG);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  shell.SigK.annotate.setTool('trim');
  await shell.flush();
  assert.equal(shell.boxesCalls.length, 0);
});
