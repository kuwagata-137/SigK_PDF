'use strict';

// モザイクを入れて保存する前の確認（spec-4b-6b 確定事項18。.claude/CLAUDE.md 付則C）。保存の流れの中での出方は mosaic-save.test.js。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

async function openShell(t) {
  const shell = await createShell({});
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const byId = (shell, id) => shell.document.getElementById(id);

test('「置き換えて保存」は危険色で、既定のフォーカスはキャンセル。了承で true', async (t) => {
  const shell = await openShell(t);
  assert.equal(byId(shell, 'confirm-mosaic-ok').textContent, '置き換えて保存');
  assert.equal(byId(shell, 'confirm-mosaic-ok').classList.contains('danger'), true);
  const answer = shell.SigK.confirmMosaic.ask({ mode: 'overwrite', count: 1, pages: '1 ページ目', name: 'a.pdf' });
  assert.equal(shell.document.activeElement?.id, 'confirm-mosaic-cancel');
  assert.equal(byId(shell, 'confirm-mosaic').hasAttribute('open'), true);
  byId(shell, 'confirm-mosaic-ok').click();
  assert.equal(await answer, true);
  assert.equal(shell.SigK.confirmMosaic.isOpen(), false);
});

test('上書きと名前を付けて保存で文面を替え、名前を付けて保存では控えの一文を出さない', async (t) => {
  const shell = await openShell(t);
  shell.SigK.confirmMosaic.ask({ mode: 'overwrite', count: 2, pages: '1・3 ページ目', name: 'a.pdf' });
  assert.equal(byId(shell, 'confirm-mosaic-text').textContent, 'モザイクを入れた 2 ページ（1・3 ページ目）を、丸ごと画像に置き換えて「a.pdf」に上書き保存します。');
  assert.equal(byId(shell, 'confirm-mosaic-loss').textContent, 'そのページの文字は検索・選択・コピーできなくなり、モザイクの下の内容は元に戻せません。書き込みは書き込みのまま残ります。');
  assert.equal(byId(shell, 'confirm-mosaic-backup').textContent, '元の内容が残らないよう、このときは控えのファイル（.bak）を作りません。前に作った控えがあれば消します。');
  assert.equal(byId(shell, 'confirm-mosaic-backup').hidden, false);
  byId(shell, 'confirm-mosaic-cancel').click();
  shell.SigK.confirmMosaic.ask({ mode: 'saveAs', count: 1, pages: '2 ページ目', name: 'b.pdf', sourceName: 'a.pdf' });
  assert.equal(byId(shell, 'confirm-mosaic-text').textContent, 'モザイクを入れた 1 ページ（2 ページ目）を、丸ごと画像に置き換えて「b.pdf」に保存します。元のファイル「a.pdf」は変わりません。');
  assert.equal(byId(shell, 'confirm-mosaic-loss').textContent, '保存したファイルでは、そのページの文字は検索・選択・コピーできず、モザイクの下の内容は元に戻せません。書き込みは書き込みのまま残ります。');
  assert.equal(byId(shell, 'confirm-mosaic-backup').hidden, true);
});

test('キャンセル・Esc は false。開いている間にもう一度聞けば同じ答えを待つ', async (t) => {
  const shell = await openShell(t);
  const first = shell.SigK.confirmMosaic.ask({ mode: 'overwrite', count: 1, pages: '1 ページ目', name: 'a.pdf' });
  const again = shell.SigK.confirmMosaic.ask({ mode: 'overwrite', count: 1, pages: '1 ページ目', name: 'a.pdf' });
  byId(shell, 'confirm-mosaic-cancel').click();
  assert.equal(await first, false);
  assert.equal(await again, false);
  const escaped = shell.SigK.confirmMosaic.ask({ mode: 'overwrite', count: 1, pages: '1 ページ目', name: 'a.pdf' });
  byId(shell, 'confirm-mosaic').dispatchEvent(new shell.window.Event('cancel'));
  assert.equal(await escaped, false);
});
