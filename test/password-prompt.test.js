'use strict';

// パスワード付き PDF を開く経路のテスト（spec-1-6 確定事項66〜71）。
//
// pdf.js が `loadingTask.onPassword` を呼んでくるところから、開けた／取りやめた
// あとの画面までを見る。**開いたあと保存だけができない**（確定事項70）ことも
// ここで確かめる。閲覧も編集もできてしまうので、押して初めて知るのでは遅い。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\secret.pdf';

async function withLockedShell(t, { password = 'user1', ...options } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ password }),
    files: { [A]: makeSource({ path: A, name: 'secret.pdf' }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  return shell;
}

// パスワードを打って「開く」を押す。
function answer(shell, value) {
  shell.document.getElementById('password-prompt-input').value = value;
  shell.document.getElementById('password-prompt-ok').click();
}

test('パスワードを聞かれ、正しければ開ける', async (t) => {
  const shell = await withLockedShell(t);

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();

  assert.equal(shell.SigK.passwordPrompt.isOpen(), true);
  assert.match(shell.document.getElementById('password-prompt-text').textContent, /secret\.pdf/);
  assert.equal(shell.document.getElementById('password-prompt-error').hidden, true, '1回目は「違います」を出さない');

  answer(shell, 'user1');
  assert.equal(await opening, true);
  await shell.flush();

  assert.equal(shell.SigK.viewer.getState().open, true);
  assert.equal(shell.SigK.tabs.count(), 1);
});

test('間違えたら、違うと言って何度でも聞き直す', async (t) => {
  const shell = await withLockedShell(t);

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();

  answer(shell, 'ちがう');
  await shell.flush();
  assert.equal(shell.SigK.passwordPrompt.isOpen(), true, '回数制限は設けない（確定事項67）');
  assert.equal(shell.document.getElementById('password-prompt-error').hidden, false);

  answer(shell, 'これもちがう');
  await shell.flush();
  assert.equal(shell.SigK.passwordPrompt.isOpen(), true);

  answer(shell, 'user1');
  assert.equal(await opening, true);
  assert.deepEqual(shell.pdfjs.passwordAttempts, ['ちがう', 'これもちがう', 'user1']);
});

test('空のまま押しても、聞き直すだけである', async (t) => {
  const shell = await withLockedShell(t);

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();

  answer(shell, '');
  await shell.flush();
  assert.equal(shell.SigK.passwordPrompt.isOpen(), true);
  assert.deepEqual(shell.pdfjs.passwordAttempts, [], 'pdf.js へは渡さない');

  answer(shell, 'user1');
  assert.equal(await opening, true);
});

test('取りやめたら、タブを作らずに元へ戻す', async (t) => {
  const shell = await withLockedShell(t);

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.document.getElementById('password-prompt-cancel').click();

  assert.equal(await opening, false);
  await shell.flush();
  // 失敗ではないので、理由を出す場所（タブ）は要らない（確定事項68）。
  assert.equal(shell.SigK.tabs.count(), 0);
  assert.equal(shell.SigK.viewer.getState().open, false);
});

test('取りやめても、前に開いていたタブはそのまま残る', async (t) => {
  const B = 'C:\\work\\plain.pdf';
  // 1本目は素通しで開き、2本目でパスワードを聞かれるようにする。
  const shell = await createShell({
    files: {
      [B]: makeSource({ path: B, name: 'plain.pdf' }),
      [A]: makeSource({ path: A, name: 'secret.pdf' }),
    },
  });
  t.after(() => shell.cleanup());

  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  // ここから先だけパスワードを聞くようにする。
  const original = shell.window.SigK.pdfjs.getDocument;
  shell.window.SigK.pdfjs.getDocument = () => {
    const task = { onPassword: null };
    task.promise = new Promise((_resolve, reject) => {
      queueMicrotask(() => task.onPassword((value) => reject(value), 1));
    });
    return task;
  };

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.document.getElementById('password-prompt-cancel').click();
  assert.equal(await opening, false);
  await shell.flush();
  shell.window.SigK.pdfjs.getDocument = original;

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().open, true, '前の文書が映ったままである');
  assert.equal(shell.SigK.viewer.getState().file.path, B);
});

test('パスワードは覚えない', async (t) => {
  const shell = await withLockedShell(t);

  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();
  answer(shell, 'user1');
  await opening;
  await shell.flush();

  // 入力欄に残さない（確定事項69）。設定にも書かない。
  assert.equal(shell.document.getElementById('password-prompt-input').value, '');
  assert.equal(shell.uiCalls.some((call) => JSON.stringify(call).includes('user1')), false);
});

// ---- 開いたあと（確定事項70） ----

async function openLocked(t) {
  const shell = await withLockedShell(t);
  const opening = shell.SigK.tabs.openPath(A);
  await shell.flush();
  answer(shell, 'user1');
  await opening;
  await shell.flush();
  return shell;
}

test('開いたあと、閲覧とページ編集はできる', async (t) => {
  const shell = await openLocked(t);

  assert.equal(shell.SigK.viewer.getState().pageCount, 3);
  assert.equal(shell.SigK.pageEdit.rotate(90, [0]), true, '回せる');
  assert.equal(shell.SigK.viewer.isDirty(), true);
});

test('保存だけができない', async (t) => {
  const shell = await openLocked(t);
  shell.SigK.pageEdit.rotate(90, [0]);

  const saved = await shell.SigK.save.saveActive();
  assert.match(saved.error, /パスワードで保護された/);
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された/);
  // ワーカーを起こさない。押す前から分かっていることである。
  assert.equal(shell.taskCalls.length, 0);

  const savedAs = await shell.SigK.save.saveAsActive();
  assert.match(savedAs.error, /パスワードで保護された/);
  assert.equal(shell.savePathCalls.length, 0, '保存先も聞かない');
});

test('ページモードへ入った時点で、保存できないことを伝える', async (t) => {
  const shell = await openLocked(t);

  shell.SigK.shell.setMode(shell.document, 'pages');

  // 並べ替えたあとで初めて知るのでは遅い（確定事項70）。
  assert.match(shell.SigK.viewBanner.text(), /パスワードで保護された/);
});

test('パスワードのいらない文書では、何も出さない', async (t) => {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'plain.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();

  assert.equal(shell.SigK.passwordPrompt.isOpen(), false);
  assert.equal(shell.SigK.save.unsaveableReason(), null);
  shell.SigK.shell.setMode(shell.document, 'pages');
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});
