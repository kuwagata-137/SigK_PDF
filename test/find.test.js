'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/find-text.js');
const findText = globalThis.SigK.findText;

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 検索（spec-1-4 A〜D）。
//
// 前半は renderer/find-text.js の純関数だけを見る。正規化と写像の正しさは
// DOM も pdf.js も要らないところで確かめられる（docs/07 第4章の二層構造）。
// 後半は文書へ当てる層で、ハイライトの当たり方とタブごとの状態を見る。
// 位置と見た目は jsdom では確かめられないので、起動確認に残す。

// ---- 正規化と写像（確定事項8〜13）----

test('全角の英数と半角の英数を同じものとして扱う', () => {
  const mapping = findText.normalize('Ａ１ｱ', {});

  assert.equal(mapping.text, 'a1ア');
  // 1文字が1文字のままなら、位置はずれない。
  assert.deepEqual(mapping.starts, [0, 1, 2]);
  assert.deepEqual(mapping.ends, [1, 2, 3]);
});

test('正規化で長さが変わる文字があっても、元の位置へ戻せる', () => {
  // ﬁ（U+FB01）は NFKC で2文字になる。写像が無いと以降がすべてずれる。
  const mapping = findText.normalize('xﬁy', {});

  assert.equal(mapping.text, 'xfiy');
  assert.deepEqual(mapping.starts, [0, 1, 1, 2]);
  assert.deepEqual(mapping.ends, [1, 2, 2, 3]);
  // 展開後の 'y' は元の3文字目である。
  assert.deepEqual(findText.toOriginalRange(mapping, 3, 4), { start: 2, end: 3 });
});

test('展開された文字の片側だけに当たっても、元の1文字を丸ごと指す', () => {
  const mapping = findText.normalize('xﬁy', {});

  // 'f' だけに当たっても、元では ﬁ の1文字ぶん（1〜2）を指す。
  assert.deepEqual(findText.toOriginalRange(mapping, 1, 2), { start: 1, end: 2 });
  assert.equal(findText.toOriginalRange(mapping, 2, 2), null);
});

test('大文字小文字は既定で同一視し、切り替えられる', () => {
  assert.equal(findText.normalize('AbC', {}).text, 'abc');
  assert.equal(findText.normalize('AbC', { matchCase: true }).text, 'AbC');
  assert.equal(findText.prepareTerm('AbC', {}), 'abc');
  assert.equal(findText.prepareTerm('AbC', { matchCase: true }), 'AbC');
});

test('ひらがなとカタカナは同一視しない', () => {
  assert.equal(findText.normalize('けんさく', {}).text, 'けんさく');
  assert.equal(findText.findMatches('けんさく', 'ケンサク').length, 0);
});

test('サロゲートペアを割らずに正規化する', () => {
  const mapping = findText.normalize('a𠮷b', {});

  assert.equal(mapping.text, 'a𠮷b');
  // 𠮷 は2コードユニット。両方が同じ元の位置を指す。
  assert.deepEqual(mapping.starts, [0, 1, 1, 3]);
  assert.deepEqual(mapping.ends, [1, 3, 3, 4]);
});

test('空の語と空白だけの語では探さない', () => {
  assert.equal(findText.prepareTerm('', {}), null);
  assert.equal(findText.prepareTerm('   ', {}), null);
  // 全角空白も NFKC で半角になり、trim が落とす。
  assert.equal(findText.prepareTerm('　', {}), null);
  assert.equal(findText.prepareTerm('あ', {}), 'あ');
});

test('部分一致を重ならないように列挙する', () => {
  assert.deepEqual(findText.findMatches('aaaa', 'aa'), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  assert.deepEqual(findText.findMatches('abc', ''), []);
  assert.deepEqual(findText.findMatches('abc', 'z'), []);
});

// ---- ヒットの区間割り（確定事項14〜16）----

test('span をまたぐヒットは span ごとの区間へ割れる', () => {
  const segments = findText.locateSegments({ start: 1, end: 5, lengths: [2, 2, 2] });

  assert.deepEqual(segments, [
    { index: 0, from: 1, to: 2 },
    { index: 1, from: 0, to: 2 },
    { index: 2, from: 0, to: 1 },
  ]);
});

test('区間の位置に応じて begin・middle・end が付く', () => {
  assert.equal(findText.segmentClass(0, 1), 'highlight');
  assert.equal(findText.segmentClass(0, 3), 'highlight begin');
  assert.equal(findText.segmentClass(1, 3), 'highlight middle');
  assert.equal(findText.segmentClass(2, 3), 'highlight end');
});

test('空の item をまたいだだけでは、幅0の区間を作らない', () => {
  const segments = findText.locateSegments({ start: 0, end: 4, lengths: [2, 0, 2] });

  assert.deepEqual(segments, [
    { index: 0, from: 0, to: 2 },
    { index: 2, from: 0, to: 2 },
  ]);
});

test('ページ1枚ぶんのヒットを、区間つきで列挙する', () => {
  const found = findText.matchesInPage({ items: ['見積書の', '控えです'], term: '書の控' });

  assert.equal(found.length, 1);
  assert.deepEqual(found[0].segments, [
    { index: 0, from: 2, to: 4 },
    { index: 1, from: 0, to: 1 },
  ]);
});

test('端まで行ったら反対の端へ回る', () => {
  assert.equal(findText.stepIndex(2, 3, 1), 0);
  assert.equal(findText.stepIndex(0, 3, -1), 2);
  assert.equal(findText.stepIndex(-1, 3, 1), 0);
  assert.equal(findText.stepIndex(-1, 3, -1), 2);
  assert.equal(findText.stepIndex(0, 0, 1), -1);
});

// ---- 文書へ当てる層 ----

// 1ページ目の末尾「見積」と2ページ目の先頭「書」で、ページをまたぐ語を作る。
// 「見積書」として拾わないことが確定事項6 である。
const PAGE_TEXT = [
  ['契約書は見積'],
  ['書を含む', 'SigK PDF の Sigk 版'],
  ['見積書はここ', 'にもある'],
];

function pdfjs() {
  return createPdfjsStub({ pageTextItems: PAGE_TEXT });
}

async function withDocument(t, options = {}) {
  const shell = await createShell({ pdfjs: pdfjs(), ...options });
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource({ path: 'C:\\work\\a.pdf' }));
  await shell.flush();
  return shell;
}

function highlights(document) {
  return [...document.querySelectorAll('.textLayer .highlight')];
}

test('検索を始めた時に全ページのテキストを取り出す', async (t) => {
  const { SigK } = await withDocument(t);

  assert.equal(SigK.find.getPages(), null, '開いた時点では取り出していない');
  await SigK.find.run('見積書');
  assert.equal(SigK.find.getPages().length, 3);
});

test('ページをまたぐ語は拾わない', async (t) => {
  const { SigK } = await withDocument(t);
  // 「見積」で1ページ目が終わり「書」で2ページ目が始まる並びは拾わない。
  const view = await SigK.find.run('見積書');

  assert.equal(view.total, 1);
  assert.equal(view.page, 2, '3ページ目の1件だけが当たる');
});

test('同じページなら span をまたぐ語を拾う', async (t) => {
  const { SigK } = await withDocument(t);
  const view = await SigK.find.run('契約書は見積書');

  assert.equal(view.total, 0, 'ページをまたぐので拾わない');
  const inPage = await SigK.find.run('見積書はここにもある');
  assert.equal(inPage.total, 1);
  assert.equal(inPage.page, 2);
});

test('空の語ではヒットを持たず、ハイライトも消える', async (t) => {
  const { SigK, document } = await withDocument(t);

  await SigK.find.run('Sigk');
  assert.ok(highlights(document).length > 0);

  const view = await SigK.find.run('   ');
  assert.equal(view.total, 0);
  assert.equal(highlights(document).length, 0);
});

test('大文字小文字を区別すると当たり方が変わる', async (t) => {
  const { SigK } = await withDocument(t);

  assert.equal((await SigK.find.run('sigk', { matchCase: false })).total, 2);
  assert.equal((await SigK.find.run('sigk', { matchCase: true })).total, 0);
  assert.equal((await SigK.find.run('Sigk', { matchCase: true })).total, 1);
});

test('ヒットは span を分割してハイライトされ、現在のものが selected になる', async (t) => {
  const { SigK, document } = await withDocument(t);
  await SigK.find.run('SigK');
  await shellFlush(document);

  const marks = highlights(document);
  assert.equal(marks.length, 2, '2ページ目の2件が当たる');
  assert.equal(marks[0].className, 'highlight selected appended');
  assert.equal(marks[0].textContent, 'SigK');
  assert.equal(marks[1].className, 'highlight appended');
  // 包まれていない部分は元のまま残る。
  assert.equal(marks[0].parentNode.textContent, 'SigK PDF の Sigk 版');
});

test('span をまたぐヒットの区間には begin・middle・end が並ぶ', async (t) => {
  const shell = await createShell({ pdfjs: createPdfjsStub({ pageTextItems: [['あい', 'うえ', 'おか']] , sizes: [{ width: 595.28, height: 841.89 }] }) });
  t.after(() => shell.cleanup());
  await shell.SigK.viewer.open(makeSource());
  await shell.flush();

  await shell.SigK.find.run('いうえお');
  const classes = highlights(shell.document).map((node) => node.className);

  assert.deepEqual(classes, [
    'highlight begin selected appended',
    'highlight middle selected appended',
    'highlight end selected appended',
  ]);
});

test('まだ描いていないページも、描いた時点でハイライトが当たる', async (t) => {
  const { SigK, document } = await withDocument(t);

  // 3ページ目は開いた直後には描かれていない（見えている範囲の前後まで）。
  assert.equal(SigK.viewer.getState().rendered.includes(2), false);
  await SigK.find.run('見積書');
  // ヒットへ飛ぶと3ページ目が描かれ、そこで当たる。
  await shellFlushDeep(document);

  assert.equal(SigK.viewer.getState().rendered.includes(2), true);
  assert.equal(highlights(document).length, 1);
  assert.equal(highlights(document)[0].textContent, '見積書');
});

test('前後のヒットへ移ると selected が動き、端では回る', async (t) => {
  const { SigK } = await withDocument(t);
  await SigK.find.run('sigk');

  assert.equal(SigK.find.getState().current, 0);
  assert.equal(SigK.find.step(1).current, 1);
  assert.equal(SigK.find.step(1).current, 0, '末尾の次は先頭へ回る');
  assert.equal(SigK.find.step(-1).current, 1, '先頭の前は末尾へ回る');
});

test('検索バーを閉じるとハイライトは消えるが、検索語は残る', async (t) => {
  const { SigK, document } = await withDocument(t);
  SigK.findBar.open();
  await SigK.find.run('sigk');
  assert.ok(highlights(document).length > 0);

  SigK.findBar.close();
  assert.equal(highlights(document).length, 0);
  assert.equal(SigK.find.getState().term, 'sigk');
  assert.equal(SigK.findBar.isOpen(), false);

  // 開き直すと前回の語が初期値になる。
  SigK.findBar.open();
  assert.equal(document.getElementById('find-input').value, 'sigk');
});

test('文書を閉じると検索の状態ごと消える', async (t) => {
  const { SigK } = await withDocument(t);
  await SigK.find.run('sigk');

  SigK.viewer.close();
  assert.equal(SigK.find.getState().term, '');
  assert.equal(SigK.find.getState().total, 0);
  assert.equal(SigK.find.getPages(), null);
});

test('検索の状態はタブごとに分かれる', async (t) => {
  const A = 'C:\\work\\a.pdf';
  const B = 'C:\\work\\b.pdf';
  const shell = await createShell({
    pdfjs: pdfjs(),
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
  });
  t.after(() => shell.cleanup());

  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.find.run('sigk');
  assert.equal(shell.SigK.find.getState().total, 2);

  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(shell.SigK.find.getState().term, '', '別のタブへ移れば検索は空から');
  await shell.SigK.find.run('見積書');
  assert.equal(shell.SigK.find.getState().total, 1);

  const ids = shell.SigK.tabs.list().map((tab) => tab.id);
  shell.SigK.tabs.activate(ids[0]);
  await shell.flush();

  const back = shell.SigK.find.getState();
  assert.equal(back.term, 'sigk', '戻れば元のタブの検索語が戻る');
  assert.equal(back.total, 2);
});

test('取り出した本文はタブを戻しても読み直さない', async (t) => {
  const A = 'C:\\work\\a.pdf';
  const B = 'C:\\work\\b.pdf';
  const shell = await createShell({
    pdfjs: pdfjs(),
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
  });
  t.after(() => shell.cleanup());

  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.find.run('sigk');
  const pages = shell.SigK.find.getPages();

  await shell.SigK.tabs.openPath(B);
  await shell.flush();
  const ids = shell.SigK.tabs.list().map((tab) => tab.id);
  shell.SigK.tabs.activate(ids[0]);
  await shell.flush();

  assert.equal(shell.SigK.find.getPages().length, pages.length);
});

// ---- キー操作（確定事項25・26）----

function press(shell, key, options = {}) {
  shell.document.dispatchEvent(new shell.window.KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...options,
  }));
}

test('Ctrl+F で検索バーが開き、Esc で閉じる', async (t) => {
  const shell = await withDocument(t);

  press(shell, 'f', { ctrlKey: true });
  assert.equal(shell.SigK.findBar.isOpen(), true);
  assert.equal(shell.document.activeElement.id, 'find-input');

  press(shell, 'Escape');
  assert.equal(shell.SigK.findBar.isOpen(), false);
});

test('F3 は検索バーが閉じていても効く', async (t) => {
  const shell = await withDocument(t);
  await shell.SigK.find.run('sigk');
  shell.SigK.findBar.close();

  press(shell, 'F3');
  assert.equal(shell.SigK.findBar.isOpen(), true, '閉じていれば開いてから移動する');
});

test('文書を開いていなければ Ctrl+F は効かない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());

  press(shell, 'f', { ctrlKey: true });
  assert.equal(shell.SigK.findBar.isOpen(), false);
});

test('入力欄に打つと1フレーム後に探し直す', async (t) => {
  const shell = await withDocument(t);
  shell.SigK.findBar.open();

  const input = shell.document.getElementById('find-input');
  input.value = 'sigk';
  input.dispatchEvent(new shell.window.Event('input'));
  // 打つたびではなく1フレームに1回へ間引く（確定事項26）。
  assert.equal(shell.SigK.find.getState().total, 0);

  await shellFlushDeep(shell.document);
  assert.equal(shell.SigK.find.getState().total, 2);
  assert.equal(shell.document.getElementById('find-count').textContent, '1 / 2');
});

test('ヒットが無ければ「0 件」を出す', async (t) => {
  const shell = await withDocument(t);
  shell.SigK.findBar.open();
  await shell.SigK.find.run('そんな語は無い');

  const count = shell.document.getElementById('find-count');
  assert.equal(count.textContent, '0 件');
  assert.equal(count.classList.contains('none'), true);
});

test('Aa を押すと大文字小文字の区別が切り替わり、探し直す', async (t) => {
  const shell = await withDocument(t);
  shell.SigK.findBar.open();
  shell.document.getElementById('find-input').value = 'sigk';
  await shell.SigK.find.run('sigk');
  assert.equal(shell.SigK.find.getState().total, 2);

  const button = shell.document.getElementById('find-case');
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  await shellFlushDeep(shell.document);

  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(shell.SigK.find.getState().matchCase, true);
  assert.equal(shell.SigK.find.getState().total, 0);
});

test('ツールバーの虫眼鏡は文書を開くまで押せない', async (t) => {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  const button = shell.document.getElementById('btn-find');

  assert.equal(button.getAttribute('aria-disabled'), 'true');
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.SigK.findBar.isOpen(), false);

  await shell.SigK.viewer.open(makeSource());
  await shell.flush();
  assert.equal(button.hasAttribute('aria-disabled'), false);
  button.dispatchEvent(new shell.window.MouseEvent('click'));
  assert.equal(shell.SigK.findBar.isOpen(), true);
});

// 描画は requestAnimationFrame で1フレーム遅れる。テキストレイヤーの組み立ては
// さらに microtask をまたぐため、数フレーム待ってから見る。
function shellFlush(document) {
  const win = document.defaultView;
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => win.setTimeout(resolve, 0));
  });
}

async function shellFlushDeep(document) {
  for (let round = 0; round < 4; round += 1)
    await shellFlush(document);
}
