'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ツールモードの間は、ツールの画面の下に隠れたページの表示を描かず、隠れた表示の倍率とページ送りのキーも渡さない（spec-2-5 PR-2 の
// 起草者の判断。危ない所「メモリ」）。帯を押すたびにタブを映し直すので、隠れたページを描くと帯の分と二重にメモリを使う。
// 2026-10-23 から、ツールモードの Ctrl＋＋/－/0 は帯の紙の倍率を変える（docs/07 決定83。tools-zoom.test.js）。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

async function withTabs(t) {
  const files = { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) };
  const shell = await createShell({ files });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  return shell;
}

// jsdom の窓で作った配列は node の配列と別物なので、写してから比べる。
const rendered = (SigK) => [...SigK.viewer.getState().rendered];

function key(shell, init) {
  const event = new shell.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  shell.document.body.dispatchEvent(event);
  return event;
}

test('ツールモードでは描いたページを手放し、タブを替えても描かない。モードを抜けると描き直す', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  assert.ok(rendered(SigK).length > 0, '閲覧では描いている');

  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  assert.deepEqual(rendered(SigK), []);

  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  assert.deepEqual(rendered(SigK), [], '帯を押して映し直しても描かない');

  SigK.shell.setMode(document, 'view');
  await shell.flush();
  assert.ok(rendered(SigK).length > 0, '閲覧へ戻ると描く');
});

test('ツールモードでは隠れた表示の倍率とページ送りのキーが効かず（Ctrl＋＋ は帯の紙の倍率へ）、Ctrl+Z は効く', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  SigK.pageEdit.rotate(90, [0]);
  const at = SigK.pageEdit.getHistoryState().at;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  const zoom = SigK.viewer.getState().zoom;

  assert.equal(key(shell, { key: '+', ctrlKey: true }).defaultPrevented, true);
  assert.equal(SigK.toolsZoom.get(), 1.25, 'Ctrl＋＋ で帯の紙の倍率が上がらない');
  assert.equal(key(shell, { key: 'PageDown' }).defaultPrevented, false);
  assert.equal(key(shell, { key: 'End' }).defaultPrevented, false);
  assert.equal(SigK.viewer.getState().zoom, zoom);
  assert.equal(SigK.viewer.getState().current, 0);

  assert.equal(key(shell, { key: 'z', ctrlKey: true }).defaultPrevented, true);
  assert.equal(SigK.pageEdit.getHistoryState().at, at - 1);

  // 閲覧へ戻れば効く。
  SigK.shell.setMode(document, 'view');
  assert.equal(key(shell, { key: '+', ctrlKey: true }).defaultPrevented, true);
  assert.notEqual(SigK.viewer.getState().zoom, zoom);
});

// ツールモードでは隠れたページの表示に効くだけのページ送り・［幅］［全体］［見開き］を灰色にする（ユーザーの判断 2026-10-23。docs/07 決定83）。
const HIDDEN_VIEW_CONTROLS = ['pager', 'btn-fit-width', 'btn-fit-page', 'btn-facing'];

function click(shell, id) {
  shell.document.getElementById(id).dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
}

test('ツールモードではページ送り・［幅］［全体］［見開き］が灰色で、押しても何も変わらない。閲覧へ戻ると押せる', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  const before = { ...SigK.viewer.getState() };

  for (const id of HIDDEN_VIEW_CONTROLS)
    assert.equal(document.getElementById(id).getAttribute('aria-disabled'), 'true', `#${id} が押せる`);
  assert.equal(document.getElementById('page-current').disabled, true, 'ページ番号の欄に打てる');
  for (const id of ['page-next', 'btn-fit-page', 'btn-fit-width', 'btn-facing'])
    click(shell, id);
  const after = SigK.viewer.getState();
  assert.equal(after.current, before.current);
  assert.equal(after.fit, before.fit);
  assert.equal(after.facing, before.facing);
  assert.equal(after.zoom, before.zoom);

  SigK.shell.setMode(document, 'view');
  for (const id of HIDDEN_VIEW_CONTROLS)
    assert.equal(document.getElementById(id).hasAttribute('aria-disabled'), false, `#${id} が押せないまま`);
  assert.equal(document.getElementById('page-current').disabled, false);
  click(shell, 'page-next');
  assert.equal(SigK.viewer.getState().current, 1);
});

test('ツールモードで灰色にしても、［見開き］の押している印は残す（［選択］［ハンド］と同じ）', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  SigK.shell.setPageLayout(document, 'facing');
  SigK.shell.setMode(document, 'tools');
  await shell.flush();

  const facing = document.getElementById('btn-facing');
  assert.equal(facing.getAttribute('aria-disabled'), 'true');
  assert.equal(facing.classList.contains('active'), true);
});

test('ツールモードで帯を押して映すタブを替えても、灰色のまま', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  SigK.shell.setMode(document, 'tools');
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();

  for (const id of HIDDEN_VIEW_CONTROLS)
    assert.equal(document.getElementById(id).getAttribute('aria-disabled'), 'true', `#${id} が押せる`);
});
