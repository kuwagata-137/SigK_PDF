'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';

// パス3つを読めるようにした画面を1つ作る。
function threeFiles() {
  return {
    [A]: makeSource({ path: A, size: 1000 }),
    [B]: makeSource({ path: B, size: 2000 }),
    [C]: makeSource({ path: C, size: 3000 }),
  };
}

async function withShell(t, options = {}) {
  const shell = await createShell({ files: threeFiles(), ...options });
  t.after(() => shell.cleanup());
  return shell;
}

async function withTabs(t, paths = [A, B], options = {}) {
  const shell = await withShell(t, options);
  for (const filePath of paths)
    await shell.SigK.tabs.openPath(filePath);
  await shell.flush();
  return shell;
}

function names(document) {
  return [...document.querySelectorAll('#tabbar .tab .name')].map((el) => el.textContent);
}

function tabNode(document, index) {
  return document.querySelectorAll('#tabbar .tab')[index];
}

test('起動直後はタブが1枚も無く、「＋」だけが並ぶ', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.equal(SigK.tabs.count(), 0);
  assert.equal(document.querySelectorAll('#tabbar .tab').length, 0);
  assert.notEqual(document.querySelector('#tabbar .tab-add'), null);
  // Phase 0 では押せない見た目だった。開く手段になったので有効にする。
  assert.equal(document.querySelector('.tab-add').hasAttribute('aria-disabled'), false);
});

test('3つ開くとタブが3枚並び、最後のものが選ばれている', async (t) => {
  const { document, SigK } = await withTabs(t, [A, B, C]);

  assert.equal(SigK.tabs.count(), 3);
  assert.deepEqual(names(document), ['a.pdf', 'b.pdf', 'c.pdf']);
  // list() は jsdom 側の Array である。deepEqual は prototype も見るため、
  // 一度こちらの realm の配列へ移してから比べる。
  assert.deepEqual([...SigK.tabs.list()].map((tab) => tab.active), [false, false, true]);
  assert.equal(document.querySelectorAll('#tabbar .tab.active').length, 1);
});

test('切り替えても倍率と読み位置が元のまま戻る', async (t) => {
  const { SigK, flush } = await withTabs(t, [A, B]);
  const [tabA, tabB] = SigK.tabs.list();

  // B（いま選ばれている）を 200% の3ページ目にしておく。
  SigK.viewer.setZoom(2);
  SigK.viewer.goToPage(2);
  await flush();
  const bZoom = SigK.viewer.getState().zoom;

  SigK.tabs.activate(tabA.id);
  await flush();
  // A は開いた直後のまま（幅に合わせる・1ページ目）。
  assert.equal(SigK.viewer.getState().fit, 'width');
  assert.equal(SigK.viewer.getState().current, 0);
  assert.equal(SigK.viewer.getState().file.name, 'a.pdf');

  SigK.tabs.activate(tabB.id);
  await flush();
  assert.equal(SigK.viewer.getState().zoom, bZoom, '倍率が戻っていない');
  assert.equal(SigK.viewer.getState().current, 2, 'ページ位置が戻っていない');
  assert.equal(SigK.viewer.getState().file.name, 'b.pdf');
});

test('選ばれていないタブは canvas を持たず、文書は生きたまま残る', async (t) => {
  const { document, SigK, pdfjs, flush } = await withTabs(t, [A, B]);
  const [tabA] = SigK.tabs.list();

  // いま映っているのは B。canvas は B のぶんだけである。
  assert.ok(document.querySelectorAll('.pdf-page').length > 0);
  assert.equal(SigK.viewer.getState().rendered.length > 0, true);

  SigK.tabs.activate(tabA.id);
  await flush();

  // 文書は2つとも生きている（spec-1-2 確定事項1）。破棄していたら開き直しになる。
  assert.equal(pdfjs.documents.length, 2);
  assert.deepEqual(pdfjs.documents.map((d) => d.destroyed), [false, false]);
});

test('同じファイルは2枚にせず、既にあるタブへ切り替える', async (t) => {
  const { SigK } = await withTabs(t, [A, B]);
  const [tabA] = SigK.tabs.list();

  await SigK.tabs.openPath(A);
  assert.equal(SigK.tabs.count(), 2, 'タブが増えてしまった');
  assert.equal(SigK.tabs.activeId(), tabA.id);

  // 大文字小文字と区切りが違っても同じファイルとして扱う。
  await SigK.tabs.openPath('c:/work/A.PDF');
  assert.equal(SigK.tabs.count(), 2);
});

test('タブの × で閉じると右隣が選ばれる', async (t) => {
  const { document, SigK } = await withTabs(t, [A, B, C]);
  const ids = SigK.tabs.list().map((tab) => tab.id);

  SigK.tabs.activate(ids[0]);
  tabNode(document, 0).querySelector('.x').dispatchEvent(
    new document.defaultView.MouseEvent('click', { bubbles: true }),
  );

  assert.deepEqual(names(document), ['b.pdf', 'c.pdf']);
  assert.equal(SigK.tabs.activeId(), ids[1], '右隣が選ばれていない');
});

test('右端のタブを閉じると左隣が選ばれる', async (t) => {
  const { SigK } = await withTabs(t, [A, B, C]);
  const ids = SigK.tabs.list().map((tab) => tab.id);

  SigK.tabs.closeTab(ids[2]);
  assert.equal(SigK.tabs.activeId(), ids[1]);
});

test('選ばれていないタブを閉じても、映っている文書は変わらない', async (t) => {
  const { SigK, flush } = await withTabs(t, [A, B]);
  const ids = SigK.tabs.list().map((tab) => tab.id);

  SigK.tabs.closeTab(ids[0]);
  await flush();

  assert.equal(SigK.tabs.activeId(), ids[1]);
  assert.equal(SigK.viewer.getState().file.name, 'b.pdf');
});

test('中クリックでもタブを閉じられる', async (t) => {
  const { document, SigK } = await withTabs(t, [A, B]);

  tabNode(document, 0).dispatchEvent(
    new document.defaultView.MouseEvent('auxclick', { bubbles: true, button: 1 }),
  );
  assert.deepEqual(names(document), ['b.pdf']);

  // 左ボタンの auxclick では閉じない。
  tabNode(document, 0).dispatchEvent(
    new document.defaultView.MouseEvent('auxclick', { bubbles: true, button: 0 }),
  );
  assert.deepEqual(names(document), ['b.pdf']);
});

test('タブのクリックで切り替わる', async (t) => {
  const { document, SigK, flush } = await withTabs(t, [A, B]);

  tabNode(document, 0).dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
  await flush();

  assert.equal(SigK.viewer.getState().file.name, 'a.pdf');
  assert.equal(tabNode(document, 0).classList.contains('active'), true);
});

test('最後の1枚を閉じると文書なしの表示へ戻る', async (t) => {
  const { document, SigK, pdfjs } = await withTabs(t, [A]);

  SigK.tabs.closeTab(SigK.tabs.list()[0].id);

  assert.equal(SigK.tabs.count(), 0);
  assert.equal(SigK.tabs.activeId(), null);
  assert.equal(SigK.viewer.getState().open, false);
  assert.equal(document.getElementById('view-empty').hidden, false);
  assert.equal(document.getElementById('view-message').textContent, SigK.viewer.EMPTY_MESSAGE);
  // 閉じたタブの文書は破棄する。開いたままだとメモリに残る。
  assert.equal(pdfjs.documents.at(-1).destroyed, true);
});

test('Ctrl+Tab と Ctrl+Shift+Tab で巡回する', async (t) => {
  const { document, SigK, flush } = await withTabs(t, [A, B, C]);
  const ids = SigK.tabs.list().map((tab) => tab.id);
  const press = (key, shiftKey = false) => document.dispatchEvent(
    new document.defaultView.KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true }),
  );

  // いまは3枚目。次は先頭へ回る。
  press('Tab');
  await flush();
  assert.equal(SigK.tabs.activeId(), ids[0]);

  press('Tab');
  assert.equal(SigK.tabs.activeId(), ids[1]);

  press('Tab', true);
  assert.equal(SigK.tabs.activeId(), ids[0]);

  // 先頭からさらに戻ると末尾へ回る。
  press('Tab', true);
  assert.equal(SigK.tabs.activeId(), ids[2]);
});

test('Ctrl+W で選ばれているタブを閉じる', async (t) => {
  const { document, SigK } = await withTabs(t, [A, B]);

  document.dispatchEvent(
    new document.defaultView.KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true }),
  );
  assert.deepEqual(names(document), ['a.pdf']);
});

test('上限を超えて開こうとすると断る', async (t) => {
  const files = {};
  for (let i = 0; i < 25; i += 1)
    files[`C:\\work\\${i}.pdf`] = makeSource({ path: `C:\\work\\${i}.pdf` });
  const { document, SigK } = await withShell(t, { files });

  for (let i = 0; i < SigK.tabs.MAX_TABS; i += 1)
    await SigK.tabs.openPath(`C:\\work\\${i}.pdf`);
  assert.equal(SigK.tabs.count(), SigK.tabs.MAX_TABS);

  const opened = await SigK.tabs.openPath('C:\\work\\20.pdf');
  assert.equal(opened, false);
  assert.equal(SigK.tabs.count(), SigK.tabs.MAX_TABS, '上限を超えて開けてしまった');

  // 文書は開いたままなので、理由は上端の帯に出す（確定事項20）。
  // 全面のオーバーレイで出すと、読んでいる文書が隠れてしまう。
  assert.match(document.getElementById('view-banner').textContent, /タブが多すぎます/);
  assert.equal(document.getElementById('view-banner').hidden, false);
  assert.equal(document.getElementById('view-empty').hidden, true, '文書が隠れてはいけない');
  assert.equal(SigK.viewer.getState().open, true);
});

test('タブを切り替えると、前の文書について出した帯は消える', async (t) => {
  const files = {};
  for (let i = 0; i < 25; i += 1)
    files[`C:\\work\\${i}.pdf`] = makeSource({ path: `C:\\work\\${i}.pdf` });
  const { document, SigK, flush } = await withShell(t, { files });

  for (let i = 0; i < SigK.tabs.MAX_TABS; i += 1)
    await SigK.tabs.openPath(`C:\\work\\${i}.pdf`);
  await SigK.tabs.openPath('C:\\work\\20.pdf');
  assert.equal(document.getElementById('view-banner').hidden, false);

  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await flush();
  assert.equal(document.getElementById('view-banner').hidden, true);
});

// 20枚 × 最小 96px = 1920px はタブバーに入らない。画面外のタブへ Ctrl+Tab で
// 移ったとき、選ばれているタブが見えないままにならないようにする。
test('選ばれているタブを画面内へ寄せる', async (t) => {
  const { document, SigK, flush } = await withTabs(t, [A, B, C]);
  const calls = [];

  // jsdom は scrollIntoView を実装しない。呼ばれたことだけを見る。
  for (const node of document.querySelectorAll('#tabbar .tab'))
    node.scrollIntoView = function stub() { calls.push(this.querySelector('.name').textContent); };

  SigK.tabs.revealActive();
  assert.deepEqual([...calls], ['c.pdf'], '選ばれているタブを寄せていない');

  // 切り替えのたびに寄せ直す。render() を通る経路すべてで効く必要がある。
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await flush();
  const after = document.querySelector('#tabbar .tab.active .name').textContent;
  assert.equal(after, 'a.pdf');
});

test('タブが無くても、寄せる処理は転ばない', async (t) => {
  const { SigK } = await withShell(t);

  assert.equal(SigK.tabs.revealActive(), false);
});

test('ウィンドウのタイトルが選ばれているタブに追従する', async (t) => {
  const { document, SigK } = await withTabs(t, [A, B]);

  assert.equal(document.title, `b.pdf — ${SigK.tabs.TITLE}`);

  SigK.tabs.activate(SigK.tabs.list()[0].id);
  assert.equal(document.title, `a.pdf — ${SigK.tabs.TITLE}`);

  SigK.tabs.closeTab(SigK.tabs.list()[0].id);
  SigK.tabs.closeTab(SigK.tabs.list()[0].id);
  assert.equal(document.title, SigK.tabs.TITLE, '文書が無ければ製品名だけに戻す');
});

test('開けなかったファイルもタブになり、理由が残る', async (t) => {
  const error = Object.assign(new Error('password'), { name: 'PasswordException' });
  const { document, SigK } = await withShell(t, { pdfjs: createPdfjsStub({ openError: error }) });

  const opened = await SigK.tabs.openPath(A);

  assert.equal(opened, false);
  assert.equal(SigK.tabs.count(), 1, '理由を出す場所としてタブは残す（確定事項19）');
  assert.equal(tabNode(document, 0).classList.contains('failed'), true);
  assert.match(document.getElementById('view-message').textContent, /パスワード/);
});

test('開けなかったタブへ戻ると、理由がもう一度出る', async (t) => {
  // 1つ目は開け、2つ目は開けない画面を作る。
  const { document, SigK, flush } = await withShell(t);
  await SigK.tabs.openPath(A);
  await flush();

  // 2つ目の getDocument だけ失敗させる。
  const original = SigK.pdfjs.getDocument;
  SigK.pdfjs.getDocument = () => ({ promise: Promise.reject(Object.assign(new Error('broken'), { name: 'InvalidPDFException' })) });
  await SigK.tabs.openPath(B);
  SigK.pdfjs.getDocument = original;

  const ids = SigK.tabs.list().map((tab) => tab.id);
  SigK.tabs.activate(ids[0]);
  await flush();
  assert.equal(SigK.viewer.getState().file.name, 'a.pdf');

  SigK.tabs.activate(ids[1]);
  assert.match(document.getElementById('view-message').textContent, /壊れている/);
  assert.equal(SigK.viewer.getState().open, false);
});

test('開けたファイルだけを履歴へ残す', async (t) => {
  const { SigK, recentCalls } = await withShell(t);

  await SigK.tabs.openPath(A);
  assert.deepEqual(recentCalls.map((call) => call.kind), ['add']);
  assert.equal(recentCalls[0].entry.path, A);
  assert.equal(recentCalls[0].entry.name, 'a.pdf');
  assert.equal(typeof recentCalls[0].entry.openedAt, 'string');

  // 読めなかったファイルは履歴から外す（確定事項10）。
  await SigK.tabs.openPath('C:\\work\\消えた.pdf');
  assert.deepEqual(recentCalls.map((call) => call.kind), ['add', 'remove']);
  assert.equal(recentCalls[1].path, 'C:\\work\\消えた.pdf');
});

test('ツールバーとメニューの「開く」はどちらもタブを作る', async (t) => {
  const shell = await withShell(t, { openResults: [makeSource({ path: A }), makeSource({ path: B })] });

  shell.document.getElementById('btn-open').dispatchEvent(
    new shell.window.MouseEvent('click', { bubbles: true }),
  );
  await shell.flush();
  assert.equal(shell.SigK.tabs.count(), 1);

  shell.fireOpenRequest();
  await shell.flush();
  assert.equal(shell.SigK.tabs.count(), 2);
});

test('メニューの最近使ったファイルはパス付きで届き、そのまま開く', async (t) => {
  const shell = await withShell(t);

  shell.fireOpenRequest(C);
  await shell.flush();

  assert.equal(shell.SigK.tabs.count(), 1);
  assert.equal(shell.SigK.viewer.getState().file.name, 'c.pdf');
});
