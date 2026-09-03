'use strict';

// ツールモードの枠組み（spec-2-1 確定事項1〜7）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

test('ツールモードに入ると、一覧と結合の作業画面が出て、閲覧へ戻すと消える', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const { document: doc, SigK } = shell;

  assert.equal(doc.getElementById('tools-list').hidden, true);
  assert.equal(doc.getElementById('tools-view').hidden, true);

  SigK.shell.setMode(doc, 'tools');
  assert.equal(SigK.tools.isToolsMode(), true);
  assert.equal(doc.getElementById('tools-list').hidden, false);
  assert.equal(doc.getElementById('tools-view').hidden, false);
  assert.equal(doc.getElementById('side-title').textContent, 'ツール');
  // 塊① の一覧は「結合」だけで、入った時点で選ばれている（確定事項1・3）。
  const items = [...doc.querySelectorAll('#tools-list .tool-item')];
  assert.deepEqual(items.map((item) => item.dataset.tool), ['merge']);
  assert.equal(items[0].classList.contains('active'), true);
  assert.equal(SigK.tools.selected(), 'merge');
  assert.equal(SigK.tools.panelFor('merge').hidden, false);

  SigK.shell.setMode(doc, 'view');
  assert.equal(SigK.tools.isToolsMode(), false);
  assert.equal(doc.getElementById('tools-list').hidden, true);
  assert.equal(doc.getElementById('tools-view').hidden, true);
});

test('文書を開いたままツールモードへ入り、戻ると文書はそのまま見える', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) } });
  t.after(() => shell.cleanup());
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);

  SigK.shell.setMode(doc, 'tools');
  // ページビューは隠すだけで捨てない（確定事項2）。
  assert.equal(SigK.viewer.getState().open, true);
  assert.equal(doc.getElementById('view-pages').hidden, false);

  SigK.shell.setMode(doc, 'view');
  assert.equal(SigK.viewer.getState().open, true);
  assert.equal(SigK.viewer.getState().pageCount, 3);
});

test('ツールモードでは保存ボタンも Ctrl+S も効かない', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) } });
  t.after(() => shell.cleanup());
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);
  const save = doc.getElementById('btn-save');
  assert.equal(save.getAttribute('aria-disabled'), 'false');

  SigK.shell.setMode(doc, 'tools');
  assert.equal(save.getAttribute('aria-disabled'), 'true');
  assert.equal((await SigK.save.saveActive()).error, 'ツールモードでは保存できません。');
  assert.equal((await SigK.save.saveAsActive()).error, 'ツールモードでは保存できません。');
  assert.equal(shell.savePathCalls.length, 0);

  SigK.shell.setMode(doc, 'view');
  assert.equal(save.getAttribute('aria-disabled'), 'false');
});

test('起動時に tools で復元されたら、そのまま結合画面を出す', async (t) => {
  const shell = await createShell({ ui: { mode: 'tools', sidePanel: { open: true, width: 240 } } });
  t.after(() => shell.cleanup());
  await shell.flush();
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(shell.document.getElementById('tools-view').hidden, false);
  assert.equal(shell.SigK.tools.selected(), 'merge');
});

test('文書を開いていなくてもツールモードに入れる', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  assert.equal(shell.SigK.shell.setMode(shell.document, 'tools'), true);
  assert.equal(shell.SigK.viewer.getState().open, false);
  assert.equal(shell.document.getElementById('tools-view').hidden, false);
});
