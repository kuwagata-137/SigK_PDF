'use strict';

// フラット化の確認（spec-4-5 確定事項10・docs/04 第7章・.claude/CLAUDE.md 付則C）。

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

test('「焼き込む」は危険色で、既定のフォーカスはキャンセルに置く', async (t) => {
  const shell = await openShell(t);
  assert.equal(byId(shell, 'confirm-flatten-ok').classList.contains('danger'), true);
  assert.equal(byId(shell, 'confirm-flatten-ok').textContent, '焼き込む');
  assert.equal(byId(shell, 'confirm-flatten-cancel').classList.contains('danger'), false);
  const answer = shell.SigK.confirmFlatten.ask({ count: 3, name: 'a_フラット化.pdf', notes: 0 });
  assert.equal(shell.document.activeElement?.id, 'confirm-flatten-cancel');
  assert.equal(byId(shell, 'confirm-flatten').hasAttribute('open'), true);
  byId(shell, 'confirm-flatten-ok').click();
  assert.equal(await answer, true);
  assert.equal(shell.SigK.confirmFlatten.isOpen(), false);
});

test('件数と書き出す先を名指しし、ノートがあれば失うものも名指しする', async (t) => {
  const shell = await openShell(t);
  shell.SigK.confirmFlatten.ask({ count: 5, name: 'x.pdf', notes: 0 });
  assert.equal(byId(shell, 'confirm-flatten-text').textContent,
    '書き込み 5 件をページの内容として焼き込み、「x.pdf」に書き出します。書き出したファイルでは、これらの書き込みを選んだり直したりできません。元のファイルは変わりません。');
  assert.equal(byId(shell, 'confirm-flatten-notes').hidden, true);
  byId(shell, 'confirm-flatten-cancel').click();
  shell.SigK.confirmFlatten.ask({ count: 5, name: 'x.pdf', notes: 2 });
  assert.equal(byId(shell, 'confirm-flatten-notes').hidden, false);
  assert.equal(byId(shell, 'confirm-flatten-notes').textContent, 'ノート 2 件の本文と作成者は、書き出したファイルに残りません。');
});

test('キャンセル・Esc・閉じるは false。開いている間にもう一度聞けば同じ答えを待つ', async (t) => {
  const shell = await openShell(t);
  const first = shell.SigK.confirmFlatten.ask({ count: 1, name: 'x.pdf' });
  const again = shell.SigK.confirmFlatten.ask({ count: 1, name: 'x.pdf' });
  byId(shell, 'confirm-flatten-cancel').click();
  assert.equal(await first, false);
  assert.equal(await again, false);
  const escaped = shell.SigK.confirmFlatten.ask({ count: 1, name: 'x.pdf' });
  byId(shell, 'confirm-flatten').dispatchEvent(new shell.window.Event('cancel'));
  assert.equal(await escaped, false);
});
