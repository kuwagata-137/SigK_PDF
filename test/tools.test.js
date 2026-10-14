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
  // サイドパネルはツール一覧が使う。「文書を開くと…」の案内は出さない。
  assert.equal(doc.getElementById('thumbs-empty').hidden, true);
  // 一覧は「結合」「分割」「画像→PDF」「PDF→画像」「透かし」「フラット化」で、入った時点では結合が選ばれている
  // （確定事項1・3、spec-2-2 確定事項39、spec-3-1 確定事項34、spec-3-3 確定事項28、spec-4-5 確定事項1）。
  const items = [...doc.querySelectorAll('#tools-list .tool-item')];
  assert.deepEqual(items.map((item) => item.dataset.tool), ['merge', 'split', 'convert', 'toImage', 'watermark', 'flatten']);
  assert.equal(items[0].classList.contains('active'), true);
  assert.equal(SigK.tools.selected(), 'merge');
  assert.equal(SigK.tools.panelFor('merge').hidden, false);
  assert.equal(SigK.tools.panelFor('split').hidden, true);
  // 結合は帯の画面と右の欄。タブの列は隠す（spec-2-5 確定事項B3・D11・E1）。
  assert.equal(SigK.tools.panelFor('merge').parentElement.id, 'tool-pane');
  assert.equal(doc.getElementById('tool-pane').hidden, false);
  assert.equal(doc.getElementById('strips-screen').hidden, false);
  assert.equal(doc.documentElement.getAttribute('data-tool-screen'), 'strips');
  assert.equal(SigK.tools.panelFor('convert').hidden, true);
  assert.equal(SigK.tools.panelFor('toImage').hidden, true);

  // 分割を選ぶと作業画面が入れ替わる。
  items[1].click();
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(items[1].classList.contains('active'), true);
  assert.equal(SigK.tools.panelFor('split').hidden, false);
  assert.equal(SigK.tools.panelFor('merge').hidden, true);
  // 分割は PR-3 まで今の画面のまま。帯も右の欄も出さず、タブの列も出す（決定80 ㉚）。
  assert.equal(doc.getElementById('tool-pane').hidden, true);
  assert.equal(doc.getElementById('strips-screen').hidden, true);
  assert.equal(doc.documentElement.hasAttribute('data-tool-screen'), false);

  // 画像→PDF も同じように切り替わる。
  items[2].click();
  assert.equal(SigK.tools.selected(), 'convert');
  assert.equal(items[2].classList.contains('active'), true);
  assert.equal(SigK.tools.panelFor('convert').hidden, false);
  assert.equal(SigK.tools.panelFor('split').hidden, true);

  // PDF→画像も同じように切り替わる。
  items[3].click();
  assert.equal(SigK.tools.selected(), 'toImage');
  assert.equal(items[3].classList.contains('active'), true);
  assert.equal(SigK.tools.panelFor('toImage').hidden, false);
  assert.equal(SigK.tools.panelFor('convert').hidden, true);
  SigK.tools.select('merge');

  SigK.shell.setMode(doc, 'view');
  assert.equal(SigK.tools.isToolsMode(), false);
  assert.equal(doc.getElementById('tools-list').hidden, true);
  assert.equal(doc.getElementById('tools-view').hidden, true);
  assert.equal(doc.getElementById('tool-pane').hidden, true);
  assert.equal(doc.documentElement.hasAttribute('data-tool-screen'), false, '閲覧ではタブの列を出す');
  assert.equal(doc.getElementById('thumbs-empty').hidden, false);
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

// ツールモードでの保存（確定事項4・5 を 2026-10-14 に改め、ツールモードでも保存できるようにした）は
// test/save-tools-mode.test.js が見る。

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
