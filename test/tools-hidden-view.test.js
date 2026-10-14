'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// ツールモードの間は、ツールの画面の下に隠れたページの表示を描かず、倍率とページ送りのキーも渡さない（spec-2-5 PR-2 の起草者の判断。
// 危ない所「メモリ」）。帯を押すたびにタブを映し直すので、隠れたページを描くと帯の分と二重にメモリを使う。

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

test('ツールモードでは倍率とページ送りのキーが効かず、Ctrl+Z は効く', async (t) => {
  const shell = await withTabs(t);
  const { SigK, document } = shell;
  SigK.pageEdit.rotate(90, [0]);
  const at = SigK.pageEdit.getHistoryState().at;
  SigK.shell.setMode(document, 'tools');
  await shell.flush();
  const zoom = SigK.viewer.getState().zoom;

  assert.equal(key(shell, { key: '+', ctrlKey: true }).defaultPrevented, false);
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
