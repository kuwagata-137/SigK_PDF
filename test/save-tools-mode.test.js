'use strict';

// ツールモードでの保存（2026-10-14 のユーザーの決定。spec-2-1 確定事項4・5 を改めた）。
//
// 今までは、ツールモードでは上書き保存も名前を付けて保存も効かなかった。保存は文書ではなく画面の話で、ツールの
// 画面には保存するものが無い、という考えだった。改めて、ツールモードでも選んでいるタブ（映しているタブ）を
// 保存できるようにした。ツールの実行中など、ほかの処理が走っている間に塞ぐのは今までどおり。
//
// あわせて、ツールモードで未保存のタブを閉じる・アプリを終えるときの確認で「保存」を選ぶと、保存の層が
// 「ツールモードでは保存できません。」と断るので、保存も閉じることもできなかった不具合も見張る。

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';

const okResult = (over = {}) => ({ ok: true, path: A, signature: { size: 2048, mtimeMs: 2000 }, ...over });

// a.pdf を開いてツールモードへ入った状態。edited なら、入る前にページを並べ替えて未保存にしておく。
async function inToolsMode(t, { edited = true, ...options } = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf', size: 1024, mtimeMs: 1000 }) }, ...options });
  t.after(() => shell.cleanup());
  const { SigK, document: doc } = shell;
  await SigK.tabs.openPath(A);
  await shell.flush();
  if (edited)
    SigK.viewer.applyPlan(SigK.pagePlan.movePages(SigK.viewer.getPlan(), [0], 2).plan);
  SigK.shell.setMode(doc, 'tools');
  return shell;
}

const modeOf = (shell) => shell.document.documentElement.getAttribute('data-mode');

// ---- 上書き保存・名前を付けて保存 ----

test('ツールモードでも［保存］は押せ、押すと映しているタブを上書き保存し、ツールモードのまま「保存しました。」を出す', async (t) => {
  const shell = await inToolsMode(t, { taskResults: [okResult()] });
  const button = shell.document.getElementById('btn-save');
  assert.equal(button.getAttribute('aria-disabled'), 'false');

  button.click();
  await shell.flush();

  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.taskCalls[0].spec.source, A);
  assert.equal(shell.taskCalls[0].spec.target, A);
  assert.equal(shell.SigK.viewer.isDirty(), false);
  assert.equal(shell.SigK.viewBanner.text(), '保存しました。');
  assert.equal(modeOf(shell), 'tools', '保存してもツールの画面を閉じない');
  assert.equal(shell.document.getElementById('tools-view').hidden, false);
});

test('ツールモードでもメニューの合図（Ctrl+S・Ctrl+Shift+S）で上書き保存と名前を付けて保存ができる', async (t) => {
  const shell = await inToolsMode(t, { taskResults: [okResult(), okResult({ path: B })], savePathResults: [{ path: B }] });
  const { SigK } = shell;

  shell.fireSaveRequest('save');
  await shell.flush();
  assert.equal(shell.taskCalls[0].spec.target, A);

  shell.fireSaveRequest('saveAs');
  await shell.flush();
  assert.equal(shell.taskCalls[1].spec.target, B);
  assert.equal(SigK.tabs.list().find((tab) => tab.active).path, B, 'タブは保存先へ移る（spec-1-6 確定事項26）');
  assert.equal(modeOf(shell), 'tools');
});

test('ツールバーの［名前を付けて保存］につなぐ口（SigK.save.saveAsActive）は、ツールモードでも保存先を聞いて書く', async (t) => {
  // 未保存でなくても名前を付けて保存はできる（spec-1-6 確定事項24）。
  const shell = await inToolsMode(t, { edited: false, taskResults: [okResult({ path: B })], savePathResults: [{ path: B }] });

  const result = await shell.SigK.save.saveAsActive();

  assert.equal(result.ok, true);
  assert.deepEqual(shell.savePathCalls[0], { defaultPath: A });
  assert.equal(shell.taskCalls[0].spec.source, A);
  assert.equal(shell.taskCalls[0].spec.target, B);
  assert.equal(shell.taskCalls[0].spec.makeBackup, false);
});

test('［名前を付けて保存］のボタン（btn-save-as）は、文書があればツールモードでも押せ、押すと保存先を聞く。文書が無ければ押せない', async (t) => {
  const shell = await inToolsMode(t, { edited: false, savePathResults: [{ canceled: true }] });
  const button = shell.document.getElementById('btn-save-as');
  assert.equal(button.getAttribute('aria-disabled'), 'false');

  button.click();
  await shell.flush();
  assert.equal(shell.savePathCalls.length, 1);
  assert.equal(shell.taskCalls.length, 0, '保存先を選ばなかったので書かない');

  shell.SigK.tabs.closeActive();
  await shell.flush();
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.click();
  await shell.flush();
  assert.equal(shell.savePathCalls.length, 1, '押せないときは保存先を聞かない');
});

test('ツールモードでも、ほかの処理（ツールの実行など）が走っている間は、保存も名前を付けて保存もできない', async (t) => {
  const shell = await inToolsMode(t);
  const { SigK, document: doc } = shell;
  const saveAs = doc.getElementById('btn-save-as');
  let release = null;
  const running = SigK.save.runLocal({ label: '画像に', run: () => new Promise((resolve) => { release = () => resolve({ ok: true }); }) });
  await shell.flush();

  assert.equal(doc.getElementById('btn-save').getAttribute('aria-disabled'), 'true');
  assert.equal(saveAs.getAttribute('aria-disabled'), 'true');
  assert.match((await SigK.save.saveActive()).error, /いま画像にしています/);
  assert.match((await SigK.save.saveAsActive()).error, /いま画像にしています/);
  assert.equal(shell.savePathCalls.length, 0);

  release();
  await running;
  assert.equal(doc.getElementById('btn-save').getAttribute('aria-disabled'), 'false');
  assert.equal(saveAs.getAttribute('aria-disabled'), 'false');
});

// jsdom は shell.css を読まないので、重なりの順は index.html の並びと z-index の文字で見張る。
test('保存の帯（#view-banner）は、ツールの画面（#tools-view）より上に出る', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'renderer', 'shell.css'), 'utf8');
  const zOf = (selector) => Number(new RegExp(`${selector}\\{[^}]*z-index:(\\d+)`).exec(css)?.[1]);

  assert.ok(html.indexOf('id="view-banner"') > html.indexOf('id="tools-view"'), '帯はツールの画面より後ろに書く');
  assert.ok(zOf('#view-banner') > zOf('#tools-view'), `帯の z-index（${zOf('#view-banner')}）がツールの画面（${zOf('#tools-view')}）以下`);
});

// ---- 閉じる・終えるときの確認（不具合の直し） ----

test('ツールモードで未保存のタブを閉じ、確認で「保存」を選ぶと、保存してから閉じる', async (t) => {
  const shell = await inToolsMode(t, { taskResults: [okResult()] });
  const { SigK, document: doc } = shell;

  const closing = SigK.tabs.closeTab(SigK.tabs.activeId());
  await shell.flush();
  doc.getElementById('confirm-discard-save').click();

  assert.equal(await closing, true);
  await shell.flush();
  assert.equal(shell.taskCalls.length, 1);
  assert.equal(shell.taskCalls[0].spec.source, A);
  assert.equal(SigK.tabs.count(), 0, '保存できたので閉じる');
});

test('ツールモードでアプリを終えるとき、確認で「保存」を選ぶと、保存してから終了を通す', async (t) => {
  const shell = await inToolsMode(t, { taskResults: [okResult()] });

  const asking = shell.fireCloseRequest();
  await shell.flush();
  shell.document.getElementById('confirm-discard-save').click();
  await asking;

  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(shell.closeAnswers, [true]);
});

test('ツールモードでタブを閉じる確認は、「キャンセル」なら閉じず、「保存しない」なら保存せずに閉じる（今までどおり）', async (t) => {
  const shell = await inToolsMode(t);
  const { SigK, document: doc } = shell;

  const canceled = SigK.tabs.closeTab(SigK.tabs.activeId());
  await shell.flush();
  doc.getElementById('confirm-discard-cancel').click();
  assert.equal(await canceled, false);
  assert.equal(SigK.tabs.count(), 1);
  assert.equal(SigK.viewer.isDirty(), true, '編集は残る');

  const discarded = SigK.tabs.closeTab(SigK.tabs.activeId());
  await shell.flush();
  doc.getElementById('confirm-discard-discard').click();
  assert.equal(await discarded, true);
  assert.equal(SigK.tabs.count(), 0);
  assert.equal(shell.taskCalls.length, 0);
});

test('ツールモードでアプリを終える確認は、「キャンセル」なら終了を取りやめ、「保存しない」なら保存せずに通す（今までどおり）', async (t) => {
  const shell = await inToolsMode(t);

  const canceled = shell.fireCloseRequest();
  await shell.flush();
  shell.document.getElementById('confirm-discard-cancel').click();
  await canceled;

  const discarded = shell.fireCloseRequest();
  await shell.flush();
  shell.document.getElementById('confirm-discard-discard').click();
  await discarded;

  assert.deepEqual(shell.closeAnswers, [false, true]);
  assert.equal(shell.taskCalls.length, 0);
});
