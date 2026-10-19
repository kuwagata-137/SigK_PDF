'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 写しのバイト列を持つ差し込みと、名前の無い帯（新しい帯）（spec-2-5 確定事項I4・I5・I7。PR-4 のタスク 2）。
//
// 写しはファイルにしないので、画面がバイト列を持ち、保存のときにワーカーへ copies として渡す。pdf.js は渡したバイト列の中身を自分の
// ワーカーへ移して空にするので、保存に使う分は先に写しておく（見落としやすい所 2）。名前の無い帯は、初めから保存していない印が付き、
// 上書き保存は名前を付けて保存へ回る。

const A = 'C:\\work\\会議資料.pdf';
const B = 'C:\\work\\見積書.pdf';
const SAVED = 'C:\\work\\新しい PDF 1.pdf';
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

async function withShell(t, options = {}) {
  const files = { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [SAVED]: makeSource({ path: SAVED }) };
  const shell = await createShell({ files, ...options });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

// pdf.js と同じく、getDocument に渡したバイト列の中身を移して空にする。
function detachOnOpen(SigK) {
  const original = SigK.pdfjs.getDocument;
  SigK.pdfjs.getDocument = (params) => {
    const task = original(params);
    if (params?.data?.buffer !== undefined)
      structuredClone(params.data.buffer, { transfer: [params.data.buffer] });
    return task;
  };
}

async function openUntitled(shell, { name = '新しい PDF 1', folder = 'C:\\work' } = {}) {
  detachOnOpen(shell.SigK);
  const opened = await shell.SigK.tabs.openSource({ ok: true, path: null, name, bytes: new Uint8Array(PDF), copy: 'c1', untitled: true, folder });
  await shell.flush();
  return opened;
}

test('名前の無い帯は、初めから保存していない印が付き、閉じるときに聞く', async (t) => {
  const shell = await withShell(t);
  assert.equal(await openUntitled(shell), true);
  const tab = shell.SigK.tabs.list().find((entry) => entry.active);
  assert.equal(tab.path, null);
  assert.equal(tab.name, '新しい PDF 1');
  assert.equal(shell.SigK.tabs.isDirty(tab.id), true);

  await shell.SigK.tabs.openPath(A);
  assert.equal(shell.SigK.tabs.isDirty(tab.id), true, '映していなくても保存していない');

  shell.SigK.tabs.closeTab(tab.id);
  await shell.flush();
  assert.equal(shell.document.querySelector('dialog[open]')?.id, 'confirm-discard', '閉じる前に聞く');
});

test('上書き保存は名前を付けて保存へ回り、既定はそのフォルダの「新しい PDF 1.pdf」。元の中身はバイト列で渡る', async (t) => {
  const shell = await withShell(t, {
    savePathResults: [{ path: SAVED }],
    taskResults: [{ ok: true, path: SAVED, signature: { size: 9, mtimeMs: 9 } }],
  });
  await openUntitled(shell);
  const id = shell.SigK.tabs.activeId();

  const result = await shell.SigK.save.saveActive();
  await shell.flush();

  assert.equal(result.ok, true);
  assert.equal(shell.savePathCalls.length, 1, '名前を付けて保存の窓を出す');
  assert.equal(shell.savePathCalls[0].defaultPath, 'C:\\work\\新しい PDF 1.pdf');
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.source, null);
  assert.equal(spec.sourceCopy, 'c1');
  assert.ok(spec.copies.c1.length > 0, 'pdf.js に渡す前に写しておいたバイト列が渡る');
  assert.equal(spec.target, SAVED);
  const tab = shell.SigK.tabs.list().find((entry) => entry.id === id);
  assert.equal(tab.path, SAVED);
  assert.equal(tab.name, '新しい PDF 1.pdf');
  assert.equal(shell.SigK.tabs.isDirty(id), false, '保存すると普通の帯になる');
});

test('名前の無い帯の帯のフロッピーも、名前を付けて保存の窓を出す', async (t) => {
  const shell = await withShell(t);
  await openUntitled(shell);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  await shell.flush();
  shell.document.querySelector('#strips .strip .strip-btn[data-act="save"]').click();
  await shell.flush();
  assert.equal(shell.savePathCalls.length, 1);
  assert.equal(shell.savePathCalls[0].defaultPath, 'C:\\work\\新しい PDF 1.pdf');
});

test('名前の無い帯を保存すると、結合のチェックが入る', async (t) => {
  const shell = await withShell(t, {
    savePathResults: [{ path: SAVED }],
    taskResults: [{ ok: true, path: SAVED, signature: { size: 9, mtimeMs: 9 } }],
  });
  await shell.SigK.tabs.openPath(A);
  await openUntitled(shell);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('merge');
  await shell.flush();
  assert.deepEqual(structuredClone(shell.SigK.toolsMerge.rows().map((row) => row.checked)), [true, false], '保存するまでは入れられない');

  await shell.SigK.save.saveActive();
  await shell.flush();
  assert.deepEqual(structuredClone(shell.SigK.toolsMerge.rows().map((row) => row.checked)), [true, true]);
});

test('写しを差し込んだタブを上書き保存すると、写しのバイト列が copies で渡る', async (t) => {
  const shell = await withShell(t, { taskResults: [{ ok: true, path: A, signature: { size: 9, mtimeMs: 9 } }] });
  await shell.SigK.tabs.openPath(A);
  const { viewer, pageEdit } = shell.SigK;
  const doc = await shell.SigK.pdfjs.getDocument({ data: new Uint8Array(PDF) }).promise;
  const [number] = viewer.addInserts([{ path: null, copy: 'k7', bytes: new Uint8Array(PDF), page: 0, size: { width: 595, height: 842 }, doc }]);
  pageEdit.commit([...viewer.getPlan(), { insert: number, rotate: 0 }], { after: [] });

  await shell.SigK.save.saveActive();
  await shell.flush();

  const { spec } = shell.taskCalls[0];
  assert.deepEqual(structuredClone(spec.inserts), [{ copy: 'k7', page: 0, size: { width: 595, height: 842 } }]);
  assert.deepEqual(Object.keys(spec.copies), ['k7']);
  assert.equal(spec.copies.k7.length, PDF.length);
});

test('withActive は一時的に別のタブを映して記録し、元のタブへ戻す', async (t) => {
  const shell = await withShell(t);
  await shell.SigK.tabs.openPath(A);
  await shell.SigK.tabs.openPath(B);
  const [a, b] = shell.SigK.tabs.list().map((tab) => tab.id);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  await shell.flush();
  assert.equal(shell.SigK.splitStrip.hostId(), b);

  const name = shell.SigK.tabs.withActive(a, () => {
    shell.SigK.pageEdit.rotate(90, [0]);
    return shell.SigK.viewer.getState().file.name;
  });

  assert.equal(name, '会議資料.pdf', '関数を呼ぶ間は a を映している');
  assert.equal(shell.SigK.tabs.activeId(), b, '元のタブへ戻る');
  assert.equal(shell.SigK.splitStrip.hostId(), b, '✂ の盤は元の帯のまま');
  assert.equal(shell.SigK.tabs.isDirty(a), true, 'a に記録した');
  assert.equal(shell.SigK.tabs.isDirty(b), false);
});

test('名前の無い帯からページを抽出すると、元の中身はバイト列で渡り、既定の名前はそのフォルダの「新しい PDF 1_抽出.pdf」（点検の指摘 3）', async (t) => {
  const OUT = 'C:\\work\\新しい PDF 1_抽出.pdf';
  const shell = await withShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, backup: null, pages: 1, bytes: 900 }],
  });
  await openUntitled(shell);
  shell.SigK.shell.setMode(shell.document, 'pages');
  shell.SigK.pageGrid.setSelection([0]);
  const promise = shell.SigK.extract.run();
  await shell.flush();
  shell.document.getElementById('confirm-extract-ok').click();
  const result = await promise;

  assert.equal(result.ok, true);
  assert.equal(shell.savePathCalls[0].defaultPath, OUT);
  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'extract');
  assert.equal(spec.source, null);
  assert.equal(spec.sourceCopy, 'c1');
  assert.ok(spec.copies.c1.length > 0);
  assert.equal(spec.expectSource, null, 'パスの無い帯は、元のファイルの書き換わりを照らさない');
});
