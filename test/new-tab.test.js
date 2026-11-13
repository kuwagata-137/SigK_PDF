'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource, makeDroppedFile, makeDataTransfer } = require('./harness.js');

// 空のタブ（タブバーの「＋」）と、空のタブでのクリップボードの画像の貼り付け（spec-7-8 確定事項NT1〜NT12）。
// クリップボードは clipboardAPI の代わり（harness の clipboardResults）を使い、ユーザーのクリップボードに触れない（NT12）。

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';
const SIZE = { width: 300, height: 200 };
const BLANK_TIP = 'ファイルを開くか、Ctrl+V でクリップボードの画像を貼り付けるための空のタブです。';
const HINT = 'クリップボードの画像は、Ctrl+V で貼り付けられます。PDF と画像のファイルは、ここにドロップしても開けます。';

// クリップボードの画像を PDF に組み立てた結果（clipboard-image.js の戻り値の形）。
function pasted({ kind = 'png', size = 77 } = {}) {
  return { ok: true, path: null, name: null, size, mtimeMs: null, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), image: { kind, frames: [SIZE] } };
}

function imageSource(filePath, kind) {
  return { ...makeSource({ path: filePath, size: 789, mtimeMs: 1000 }), image: { kind, frames: [SIZE] } };
}

async function withShell(t, { files = {}, ...options } = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [C]: makeSource({ path: C }), ...files },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const byId = (shell, id) => shell.document.getElementById(id);
const names = (shell) => [...shell.document.querySelectorAll('#tabbar .tab .name')].map((node) => node.textContent);
const activeName = (shell) => shell.document.querySelector('#tabbar .tab.active .name')?.textContent ?? null;
const activeNode = (shell) => shell.document.querySelector('#tabbar .tab.active');
const click = (shell, node) => node.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const plus = (shell) => click(shell, shell.document.querySelector('#tabbar .tab-add'));
const tipOf = (shell, node) => structuredClone(shell.SigK.tipContent.resolve(node));

function key(shell, name, init = {}, target = shell.document.body) {
  const event = new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

// 条件が満たされるまで、画面の処理を進める（読み込み・貼り付けの非同期の終わりを待つ）。
async function until(shell, predicate) {
  for (let i = 0; i < 20 && !predicate(); i += 1)
    await shell.flush();
  assert.ok(predicate(), '待っても条件が満たされない');
}

// 空のタブの位置を真ん中にした並び（a.pdf・新しいタブ・b.pdf）で、空のタブを映す。
async function blankBetween(shell) {
  await shell.SigK.tabs.openPath(A);
  plus(shell);
  shell.SigK.tabs.activate(shell.SigK.tabs.list()[0].id);
  await shell.SigK.tabs.openPath(B);
  plus(shell);
  await shell.flush();
  assert.deepEqual(names(shell), ['a.pdf', '新しいタブ', 'b.pdf']);
  assert.equal(shell.SigK.tabs.isBlankActive(), true);
}

// ---- 空のタブを開く（NT1・NT2・NT5・NT11） ----

test('「＋」をクリックすると空のタブ（新しいタブ）を開いて映し、中央に［ファイルを開く］と案内文、その下に最近使ったファイルを表示する（NT1・NT2）', async (t) => {
  const shell = await withShell(t, { recent: [{ path: C, name: 'c.pdf', openedAt: null }] });
  const { SigK, document } = shell;
  await SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(byId(shell, 'newtab').hidden, true, '文書を映している間は表示しない');
  assert.equal(byId(shell, 'view-recent').hidden, true);

  plus(shell);
  await shell.flush();
  assert.deepEqual(names(shell), ['b.pdf', '新しいタブ']);
  assert.equal(activeName(shell), '新しいタブ');
  assert.equal(SigK.tabs.isBlankActive(), true);
  assert.equal(SigK.tabs.blankId(), SigK.tabs.activeId());
  assert.equal(SigK.viewer.getState().open, false, '空のタブは文書を持たない');
  assert.equal(document.title, `新しいタブ — ${SigK.tabs.TITLE}`);
  assert.equal(activeNode(shell).classList.contains('blank'), true);
  assert.equal(activeNode(shell).querySelector('.dirty'), null, '空のタブは保存していない変更を持たない');
  assert.deepEqual(tipOf(shell, activeNode(shell)), { name: '新しいタブ', desc: BLANK_TIP });

  // 画面: ［ファイルを開く］・案内文（2 行）・最近使ったファイル。「文書が開かれていません」は表示しない。
  assert.equal(byId(shell, 'view-empty').hidden, false);
  assert.equal(byId(shell, 'newtab').hidden, false);
  assert.equal(byId(shell, 'view-message').hidden, true);
  const open = byId(shell, 'newtab-open');
  assert.equal(open.tagName, 'BUTTON');
  assert.equal(open.textContent, 'ファイルを開く');
  assert.equal(open.querySelector('svg')?.getAttribute('width'), '20', 'アイコンは 20px');
  assert.deepEqual(tipOf(shell, open), { name: 'ファイルを開く', desc: 'PDF か画像のファイルを選択して、このタブで開きます。', keys: ['Ctrl+O'] });
  assert.equal(byId(shell, 'newtab-hint').textContent, HINT);
  assert.equal(byId(shell, 'newtab-hint').querySelectorAll('br').length, 1, '案内文は 2 行');
  assert.equal(byId(shell, 'view-recent').hidden, false, '最近使ったファイルの一覧を表示する（NT2 の案B）');
  assert.deepEqual([...document.querySelectorAll('#view-recent .recent-name')].map((node) => node.textContent), ['b.pdf', 'c.pdf']);

  // 帯・ツール・終了の確認が使う一覧には入れず、上限の数には入れる（NT10）。
  assert.deepEqual(structuredClone(SigK.tabs.list().map((tab) => tab.name)), ['b.pdf']);
  assert.equal(SigK.tabs.count(), 2);
  assert.equal(SigK.tabs.isDirty(SigK.tabs.activeId()), false);
  assert.equal(SigK.tabs.findByPath(null), null);

  // ほかのタブへ移ると、空のタブの画面を下げる。
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  assert.equal(byId(shell, 'newtab').hidden, true);
  assert.equal(byId(shell, 'view-message').hidden, false);
  assert.equal(byId(shell, 'view-recent').hidden, true);
});

test('閲覧・ページ編集・編集のどのモードでも「＋」で空のタブを開く。空のタブは 1 枚だけで、あれば切り替える（NT1・NT5）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  await SigK.tabs.openPath(A);
  for (const mode of ['view', 'pages', 'annot']) {
    SigK.shell.setMode(document, mode);
    SigK.tabs.activate(SigK.tabs.list()[0].id);
    plus(shell);
    await shell.flush();
    assert.equal(SigK.tabs.isBlankActive(), true, mode);
    assert.equal(byId(shell, 'newtab').hidden, false, mode);
    assert.deepEqual(names(shell), ['a.pdf', '新しいタブ'], mode);
    // 空のタブを映したまま、もう一度押しても増えない。
    plus(shell);
    assert.deepEqual(names(shell), ['a.pdf', '新しいタブ'], mode);
    assert.equal(SigK.tabs.openBlankTab(), true);
    assert.equal(SigK.tabs.count(), 2, mode);
  }
});

test('空のタブを閉じる時は確認しない。Ctrl+Tab で巡回し、Ctrl+W と × で閉じる（NT10）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  plus(shell);
  await shell.flush();
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf', '新しいタブ']);

  key(shell, 'Tab', { ctrlKey: true });
  await shell.flush();
  assert.equal(activeName(shell), 'a.pdf', '右端の次は先頭');
  key(shell, 'Tab', { ctrlKey: true, shiftKey: true });
  await shell.flush();
  assert.equal(activeName(shell), '新しいタブ');

  key(shell, 'w', { ctrlKey: true });
  await shell.flush();
  assert.equal(shell.document.querySelector('dialog[open]'), null, '確認画面を表示しない');
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);
  assert.equal(activeName(shell), 'b.pdf', '右端を閉じたので左隣');

  plus(shell);
  click(shell, shell.document.querySelector('#tabbar .tab.blank .x'));
  await shell.flush();
  assert.equal(shell.document.querySelector('dialog[open]'), null);
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf']);

  // 最後の 1 枚が空のタブなら、閉じると「文書が開かれていません」の画面に戻る。
  SigK.tabs.forceCloseTab(SigK.tabs.list()[0].id);
  SigK.tabs.forceCloseTab(SigK.tabs.list()[0].id);
  plus(shell);
  SigK.tabs.closeActive();
  await shell.flush();
  assert.equal(SigK.tabs.count(), 0);
  assert.equal(byId(shell, 'newtab').hidden, true);
  assert.equal(byId(shell, 'view-message').hidden, false);
  assert.equal(byId(shell, 'view-message').textContent, SigK.viewer.EMPTY_MESSAGE);
});

test('空のタブも上限の 20 枚に数える。空のタブを映していれば、20 枚でもファイルを開け、空のタブと置き換わる（NT4・NT10）', async (t) => {
  const files = {};
  for (let i = 0; i < 22; i += 1)
    files[`C:\\work\\${i}.pdf`] = makeSource({ path: `C:\\work\\${i}.pdf` });
  const shell = await withShell(t, { files });
  const { SigK } = shell;
  for (let i = 0; i < SigK.tabs.MAX_TABS - 1; i += 1)
    await SigK.tabs.openPath(`C:\\work\\${i}.pdf`);
  plus(shell);
  assert.equal(SigK.tabs.count(), SigK.tabs.MAX_TABS);
  assert.equal(SigK.tabs.isFull(), false, '映している空のタブは置き換わるので数えない');

  // 空のタブを映していないときは、20 枚で断る。
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  assert.equal(SigK.tabs.isFull(), true);
  assert.equal(await SigK.tabs.openPath('C:\\work\\19.pdf'), false);
  assert.match(SigK.viewBanner.text(), /タブが多すぎるので/);

  // 空のタブを映していれば開け、空のタブがそのファイルのタブに変わる。
  plus(shell);
  assert.equal(await SigK.tabs.openPath('C:\\work\\19.pdf'), true);
  assert.equal(SigK.tabs.count(), SigK.tabs.MAX_TABS);
  assert.equal(SigK.tabs.blankId(), null);
  assert.equal(names(shell).at(-1), '19.pdf');

  // 20 枚が全部ファイルのタブなら、「＋」も断る。
  assert.equal(SigK.tabs.openBlankTab(), false);
  assert.equal(SigK.tabs.blankId(), null);
  assert.match(SigK.viewBanner.text(), /タブが多すぎるので/);
});

test('帯の並べ替え（reorder）は空のタブを除いた id の並びを受け、空のタブの位置を保つ（NT10）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  await blankBetween(shell);
  const [a, b] = SigK.tabs.list().map((tab) => tab.id);
  assert.equal(SigK.tabs.reorder([b, a]), true);
  assert.deepEqual(names(shell), ['b.pdf', '新しいタブ', 'a.pdf']);
  assert.equal(SigK.tabs.isBlankActive(), true, '映しているタブは変えない');
  assert.equal(SigK.tabs.reorder([b, a, SigK.tabs.blankId()]), false, '空のタブの id は受けない');
  assert.equal(SigK.tabs.reorder([b, a]), false, '同じ並びなら何もしない');
});

test('ツールモードでは空のタブを帯にしない。空のタブを映したまま切り替えても落ちず、選択中の帯は無い（NT10）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  await SigK.tabs.openPath(A);
  plus(shell);
  await shell.flush();

  SigK.shell.setMode(document, 'tools');
  SigK.tools.select('merge');
  await shell.flush();
  const strips = [...document.querySelectorAll('#strips .strip')];
  assert.deepEqual(strips.map((node) => node.querySelector('.fname').textContent), ['a.pdf']);
  assert.equal(strips.some((node) => node.classList.contains('sel')), false, '選択中の帯は無い');
  assert.deepEqual(structuredClone(SigK.toolsMerge.rows().map((row) => row.name)), ['a.pdf']);
  SigK.tools.select('split');
  await shell.flush();
  assert.equal(SigK.toolsSplit.source(), null, '分割の対象は無い');

  // 帯をクリックすると、その帯（タブ）へ移る。閲覧モードへ戻ると、その帯の文書を映す。
  SigK.tools.select('merge');
  click(shell, document.querySelector('#strips .strip .strip-head'));
  await shell.flush();
  SigK.shell.setMode(document, 'view');
  await shell.flush();
  assert.equal(activeName(shell), 'a.pdf');

  // 閲覧モードで空のタブへ戻ると、空のタブの画面を表示する。
  plus(shell);
  await shell.flush();
  assert.equal(byId(shell, 'newtab').hidden, false);
});

// ---- 空のタブの位置で開く（NT3・NT4） ----

test('［ファイルを開く］はツールバーの［開く］と同じダイアログを開き、選んだファイルを空のタブの位置で開く（NT3・NT4）', async (t) => {
  const shell = await withShell(t, { openResults: [makeSource({ path: C })] });
  const { SigK } = shell;
  await blankBetween(shell);

  click(shell, byId(shell, 'newtab-open'));
  await until(shell, () => names(shell).includes('c.pdf'));
  assert.deepEqual(names(shell), ['a.pdf', 'c.pdf', 'b.pdf']);
  assert.equal(activeName(shell), 'c.pdf');
  assert.equal(SigK.tabs.blankId(), null, '空のタブは c.pdf のタブに変わった');
  assert.equal(byId(shell, 'newtab').hidden, true);
  assert.equal(SigK.viewer.getState().file.path, C);
});

test('最近使ったファイルのクリックでも、空のタブの位置で開く（NT2・NT4）', async (t) => {
  const shell = await withShell(t, { recent: [{ path: C, name: 'c.pdf', openedAt: null }] });
  await blankBetween(shell);
  click(shell, shell.document.querySelector('#view-recent .recent-item[data-path="C:\\\\work\\\\c.pdf"]'));
  await until(shell, () => names(shell).includes('c.pdf'));
  assert.deepEqual(names(shell), ['a.pdf', 'c.pdf', 'b.pdf']);
});

test('ドロップで続けて 2 つ開くと、1 つ目を空のタブの位置で開き、2 つ目は右端に追加する（NT4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  await SigK.tabs.openPath(A);
  plus(shell);
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  plus(shell);
  await shell.flush();
  assert.deepEqual(names(shell), ['a.pdf', '新しいタブ']);

  const drop = new shell.window.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = makeDataTransfer([makeDroppedFile('b.pdf', B), makeDroppedFile('c.pdf', C)]);
  shell.document.dispatchEvent(drop);
  await until(shell, () => names(shell).length === 3);
  assert.deepEqual(names(shell), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.equal(activeName(shell), 'c.pdf');
});

test('空のタブで読み込めない種類のファイルをドロップしたら、理由を通知バーに表示する（空のタブの画面は文言欄を隠しているため）', async (t) => {
  const shell = await withShell(t);
  plus(shell);
  const drop = new shell.window.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = makeDataTransfer([makeDroppedFile('メモ.txt', 'C:\\work\\メモ.txt')]);
  shell.document.dispatchEvent(drop);
  await shell.flush();
  assert.match(shell.SigK.viewBanner.text(), /PDF でも画像でもないので/);
  assert.equal(shell.SigK.tabs.isBlankActive(), true);
});

test('起動の引数（エクスプローラーから開く）でも、空のタブの位置で開く（NT4）', async (t) => {
  const shell = await withShell(t);
  await blankBetween(shell);
  await Promise.all(shell.fireLaunch({ intent: 'open', paths: [C], batch: { id: 1, first: true } }));
  await until(shell, () => names(shell).includes('c.pdf'));
  assert.deepEqual(names(shell), ['a.pdf', 'c.pdf', 'b.pdf']);
});

test('すでにタブで開いているファイルを開くと、そのタブへ切り替え、空のタブは残る（NT4）', async (t) => {
  const shell = await withShell(t);
  const { SigK } = shell;
  await blankBetween(shell);
  assert.equal(await SigK.tabs.openPath(A), true);
  assert.equal(activeName(shell), 'a.pdf');
  assert.deepEqual(names(shell), ['a.pdf', '新しいタブ', 'b.pdf']);
});

test('開けなかったファイルのタブも空のタブの位置にでき、理由を表示する。読めなかったファイルの理由は通知バーに表示する（NT4）', async (t) => {
  const error = Object.assign(new Error('broken'), { name: 'InvalidPDFException' });
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ openError: error }) });
  const { SigK } = shell;
  plus(shell);
  assert.equal(await SigK.tabs.openPath('C:\\work\\消えた.pdf'), false);
  assert.equal(SigK.viewBanner.text(), '読み込み結果が用意されていません。', '空のタブの画面は文言欄を隠しているので、通知バーに表示する');
  assert.equal(SigK.tabs.isBlankActive(), true, 'タブは作らない（今までどおり）');

  assert.equal(await SigK.tabs.openPath(A), false);
  assert.deepEqual(names(shell), ['a.pdf']);
  assert.equal(activeNode(shell).classList.contains('failed'), true);
  assert.equal(byId(shell, 'newtab').hidden, true);
  assert.equal(byId(shell, 'view-message').hidden, false);
  assert.match(byId(shell, 'view-message').textContent, /壊れている/);
});

test('パスワードの入力をキャンセルしたら、空のタブに戻る（NT4）', async (t) => {
  const shell = await withShell(t, { pdfjs: createPdfjsStub({ password: 'user1' }) });
  const { SigK } = shell;
  plus(shell);
  const opening = SigK.tabs.openPath(A);
  await until(shell, () => SigK.passwordPrompt.isOpen());
  assert.equal(byId(shell, 'newtab').hidden, true, '読み込んでいる間は空のタブの画面を下げる');
  byId(shell, 'password-prompt-cancel').click();
  assert.equal(await opening, false);
  await shell.flush();
  assert.equal(SigK.tabs.isBlankActive(), true);
  assert.deepEqual(names(shell), ['新しいタブ']);
  assert.equal(byId(shell, 'newtab').hidden, false);
});

// ---- Ctrl+V（NT6〜NT8・NT11） ----

test('空のタブで Ctrl+V を押すと、クリップボードの画像を空のタブの位置に「新しい画像 1」で開く。名前の無い画像で、開いた直後から保存していない（NT6・NT8）', async (t) => {
  const shell = await withShell(t, { clipboardResults: [pasted(), pasted({ kind: 'png', size: 99 })] });
  const { SigK } = shell;
  await blankBetween(shell);

  const event = key(shell, 'v', { ctrlKey: true });
  assert.equal(event.defaultPrevented, true);
  await until(shell, () => names(shell).includes('新しい画像 1'));
  assert.equal(shell.clipboardReads(), 1);
  assert.deepEqual(names(shell), ['a.pdf', '新しい画像 1', 'b.pdf']);
  assert.equal(activeName(shell), '新しい画像 1');
  const file = SigK.viewer.getState().file;
  assert.equal(file.path, null);
  assert.equal(file.name, '新しい画像 1');
  assert.equal(file.untitled, true);
  assert.equal(file.image.kind, 'png', '画像のタブ（spec-7-1）として開く');
  assert.equal(file.copy, 'image');
  assert.equal(file.size, 77);
  assert.equal(SigK.viewer.isDirty(), true, '開いた直後から保存していない');
  assert.equal(SigK.tabs.isDirty(SigK.tabs.activeId()), true);
  assert.notEqual(activeNode(shell).querySelector('.dirty'), null, 'タブに保存していない印');
  assert.deepEqual(tipOf(shell, activeNode(shell)), { name: '新しい画像 1', desc: 'まだファイルとして保存していない画像です。' });
  assert.equal(byId(shell, 'newtab').hidden, true);
  assert.equal(byId(shell, 'view-empty').hidden, true);

  // 次に貼り付けた画像は「新しい画像 2」。空のタブは右端に追加される。
  plus(shell);
  key(shell, 'v', { ctrlKey: true });
  await until(shell, () => names(shell).includes('新しい画像 2'));
  assert.deepEqual(names(shell), ['a.pdf', '新しい画像 1', 'b.pdf', '新しい画像 2']);
  // 映していないタブも、保存していない印のまま。
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  assert.equal(SigK.tabs.isDirty(SigK.tabs.list()[1].id), true);
});

test('クリップボードに画像が無い時の Ctrl+V は、通知バー（黄色）に「クリップボードに画像がありません。」と表示し、ほかには何もしない（NT7）', async (t) => {
  const shell = await withShell(t);
  plus(shell);
  key(shell, 'v', { ctrlKey: true });
  await until(shell, () => shell.SigK.viewBanner.text() !== '');
  assert.equal(shell.SigK.viewBanner.text(), 'クリップボードに画像がありません。');
  assert.equal(byId(shell, 'view-banner').getAttribute('data-tone'), 'warn');
  assert.deepEqual(names(shell), ['新しいタブ']);
  assert.equal(shell.SigK.tabs.isBlankActive(), true);
  assert.equal(byId(shell, 'newtab').hidden, false);
});

test('クリップボードの画像を開けなかったときは、理由を通知バー（赤）に表示する', async (t) => {
  const shell = await withShell(t, { clipboardResults: [{ error: '100MB までに対応していますが、画像が大きすぎます。' }, () => { throw new Error('ipc'); }] });
  plus(shell);
  key(shell, 'v', { ctrlKey: true });
  await until(shell, () => shell.SigK.viewBanner.text() !== '');
  assert.equal(shell.SigK.viewBanner.text(), '100MB までに対応していますが、画像が大きすぎます。');
  assert.equal(byId(shell, 'view-banner').hasAttribute('data-tone'), false, '赤（既定の色）');
  shell.SigK.viewBanner.hide();
  assert.equal(await shell.SigK.newTab.paste(), false);
  assert.equal(shell.SigK.viewBanner.text(), 'クリップボードの画像を開けませんでした。');
  assert.deepEqual(names(shell), ['新しいタブ']);
});

test('文字を入力する欄にフォーカスがある時・ツールモードの時・空のタブを映していない時の Ctrl+V は、クリップボードを読まない（NT6）', async (t) => {
  const shell = await withShell(t, { clipboardResults: [pasted()] });
  const { SigK, document } = shell;
  await SigK.tabs.openPath(A);
  plus(shell);

  for (const tag of ['input', 'textarea']) {
    const field = document.createElement(tag);
    document.body.append(field);
    field.focus();
    const event = key(shell, 'v', { ctrlKey: true }, field);
    assert.equal(event.defaultPrevented, false, `${tag} への貼り付けのまま`);
    field.remove();
  }
  key(shell, 'v', { ctrlKey: true, shiftKey: true });
  key(shell, 'v', {});

  SigK.shell.setMode(document, 'tools');
  key(shell, 'v', { ctrlKey: true });
  SigK.shell.setMode(document, 'view');

  SigK.tabs.activate(SigK.tabs.list()[0].id);
  key(shell, 'v', { ctrlKey: true });
  await shell.flush();
  assert.equal(shell.clipboardReads(), 0);
  assert.deepEqual(names(shell), ['a.pdf', '新しいタブ']);
});

test('確認画面が開いている間の Ctrl+V は、空のタブでもクリップボードを読まない', async (t) => {
  const shell = await withShell(t, { clipboardResults: [pasted()] });
  plus(shell);
  const asking = shell.SigK.confirmDiscard.ask({ name: 'x.pdf' });
  await shell.flush();
  key(shell, 'v', { ctrlKey: true });
  await shell.flush();
  assert.equal(shell.clipboardReads(), 0);
  byId(shell, 'confirm-discard-cancel').click();
  await asking;
});

test('続けて Ctrl+V を押しても、読み込んでいる間は 1 回だけ読む（2 枚にしない）', async (t) => {
  let release = () => {};
  const shell = await withShell(t, { clipboardResults: [() => new Promise((resolve) => { release = () => resolve(pasted()); })] });
  plus(shell);
  key(shell, 'v', { ctrlKey: true });
  key(shell, 'v', { ctrlKey: true });
  assert.equal(shell.clipboardReads(), 1);
  release();
  await until(shell, () => names(shell).includes('新しい画像 1'));
  assert.deepEqual(names(shell), ['新しい画像 1']);
});

// ---- 貼り付けた画像の保存（NT9） ----

// 描く部品の代わり（image-save.test.js と同じ）。jsdom には 2D コンテキストが無い。
function stubImages(t, shell) {
  const images = shell.SigK.pageImage;
  const original = { renderToCanvas: images.renderToCanvas, toBytes: images.toBytes };
  images.renderToCanvas = async () => ({ canvas: { width: 300, height: 200, getContext: () => null }, width: 300, height: 200 });
  images.toBytes = async (_canvas, { type }) => new Uint8Array(type === images.PNG ? 5 : 3).fill(1);
  t.after(() => Object.assign(images, original));
}

// 貼り付けた画像の保存の試験の画面。画像は 1 ページ（画像として保存できるのは 1 ページのときだけ。spec-7-1 確定事項B3）。
function imageShell(t, options) {
  return withShell(t, { pdfjs: createPdfjsStub({ sizes: [SIZE] }), clipboardResults: [pasted()], ...options });
}

async function pasteImage(shell) {
  plus(shell);
  key(shell, 'v', { ctrlKey: true });
  await until(shell, () => shell.SigK.viewer.getState().open);
  return shell.SigK.tabs.activeId();
}

test('貼り付けた画像の［上書き保存］は名前を付けて保存の画面を開き、既定は「新しい画像 1.png」・PNG・JPEG・PDF。PNG で保存すると画像のタブとして開き直す（NT9）', async (t) => {
  const OUT = 'C:\\work\\スクリーンショット.png';
  const shell = await imageShell(t, {
    savePathResults: [{ path: OUT, format: 'png' }],
    files: { [OUT]: imageSource(OUT, 'png') },
  });
  stubImages(t, shell);
  const { SigK } = shell;
  const id = await pasteImage(shell);

  const result = await SigK.save.saveActive();
  assert.equal(result.ok, true);
  assert.deepEqual(shell.savePathCalls.map((call) => [call.defaultPath, call.formats]), [['新しい画像 1.png', ['png', 'jpeg', 'pdf']]]);
  assert.equal(SigK.confirmImageSave.isOpen(), false, '別のファイルへ書くので、焼き込みの確認は出さない');
  assert.deepEqual(shell.imageWrites.map((write) => [write.target, write.options]), [[OUT, { makeBackup: false, expect: null }]]);
  assert.equal(SigK.viewBanner.text(), '保存しました。');

  // 保存したファイルの画像のタブとして開き直す（spec-7-1 確定事項B5）。
  const file = SigK.viewer.getState().file;
  assert.equal(file.path, OUT);
  assert.equal(file.untitled, undefined);
  assert.equal(file.image.kind, 'png');
  assert.equal(SigK.viewer.isDirty(), false);
  assert.equal(SigK.tabs.activeId(), id);
  assert.deepEqual(names(shell), ['スクリーンショット.png']);
  assert.deepEqual(tipOf(shell, activeNode(shell)), { name: 'スクリーンショット.png', desc: OUT });
  assert.equal(shell.recentCalls.at(-1).entry.path, OUT, '最近使ったファイルに載せる');
});

test('設定の「ファイルを書き出すときの、最初のフォルダ」が指定フォルダなら、既定のパスはそのフォルダの「新しい画像 1.png」（NT9）', async (t) => {
  const shell = await imageShell(t, {
    preferences: { outputFolder: { mode: 'fixed', fixed: 'D:\\out' } },
    existingFolders: ['D:\\out'],
  });
  await pasteImage(shell);
  const result = await shell.SigK.save.saveAsActive();
  assert.equal(result.canceled, true);
  assert.equal(shell.savePathCalls[0].defaultPath, 'D:\\out\\新しい画像 1.png');
});

test('貼り付けた画像を PDF で保存すると、組み立てた PDF（鍵 image）をワーカーへ渡し、PDF のタブとして開き直す（NT9）', async (t) => {
  const OUT = 'C:\\work\\新しい画像 1.pdf';
  const shell = await imageShell(t, {
    savePathResults: [{ path: OUT, format: 'pdf' }],
    taskResults: [{ ok: true, signature: { size: 2048, mtimeMs: 2000 } }],
    files: { [OUT]: makeSource({ path: OUT }) },
  });
  const { SigK } = shell;
  await pasteImage(shell);
  const result = await SigK.save.saveActive();
  assert.equal(result.ok, true);
  const { spec } = shell.taskCalls.at(-1);
  assert.equal(spec.kind, 'save');
  assert.equal(spec.source, null);
  assert.equal(spec.sourceCopy, 'image');
  assert.ok(spec.copies.image.length > 0, '組み立てた PDF のバイト列を渡す');
  assert.equal(spec.target, OUT);
  assert.equal(shell.imageWrites.length, 0);
  const file = SigK.viewer.getState().file;
  assert.equal(file.path, OUT);
  assert.equal(file.image, undefined, 'PDF のタブとして開き直す');
  assert.equal(file.untitled, undefined);
  assert.deepEqual(names(shell), ['新しい画像 1.pdf']);
});

test('貼り付けた画像を保存しないまま閉じる時は確認画面を表示し、［保存］で名前を付けて保存の画面を開く（NT8・NT9）', async (t) => {
  const shell = await imageShell(t, {});
  const { SigK } = shell;
  const id = await pasteImage(shell);
  const closing = SigK.tabs.closeTab(id);
  await shell.flush();
  assert.equal(shell.document.querySelector('dialog[open]')?.id, 'confirm-discard');
  byId(shell, 'confirm-discard-save').click();
  assert.equal(await closing, false, '保存画面をキャンセルしたので閉じない');
  assert.equal(shell.savePathCalls.length, 1);
  assert.equal(shell.savePathCalls[0].defaultPath, '新しい画像 1.png');
  assert.deepEqual(names(shell), ['新しい画像 1']);

  // 終了する時も、未保存のタブとして聞く。
  const quitting = shell.fireCloseRequest();
  await shell.flush();
  assert.equal(shell.document.querySelector('dialog[open]')?.id, 'confirm-discard');
  byId(shell, 'confirm-discard-cancel').click();
  await quitting;
  assert.deepEqual(shell.closeAnswers, [false]);
});
