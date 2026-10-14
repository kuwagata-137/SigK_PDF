'use strict';

// ［開いているタブから選ぶ ▾］の一覧（spec-2-2b 確定事項F1〜F7・G2②。見本 screenshots/phase2-2b-07-tab-menu.png）。
// 分割・PDF→画像・透かし・フラット化の 4 画面が同じ部品（source-picker.js の bindTabMenu → tab-menu.js）を使う。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const C = 'C:\\work\\c.pdf';
// フラット化は対象を決めると書き込みを数える（tools-flatten.test.js と同じ形の結果を返す）。
const CENSUS = { ok: true, baked: 0, kept: 0, notes: 0, bake: { markup: 0, text: 0, shape: 0, note: 0, other: 0 }, keep: { functional: 0, noAppearance: 0, hidden: 0 } };

async function createToolShell(t, tool = 'split', options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [C]: makeSource({ path: C }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select(tool);
  return shell;
}

// A・B・C を開き、B に保存していない編集を作り、A を選んでいるタブにする。
async function openThreeTabs(shell) {
  const { SigK, document: doc } = shell;
  for (const filePath of [A, B, C])
    await SigK.tabs.openPath(filePath);
  await shell.flush();
  SigK.tabs.activate(SigK.tabs.list()[1].id);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.tabs.activate(SigK.tabs.list()[0].id);
  await shell.flush();
  SigK.shell.setMode(doc, 'tools');
}

const menuOf = (shell) => shell.document.querySelector('.tab-menu');
const rowsOf = (shell) => [...shell.document.querySelectorAll('.tab-menu .tab-menu-row')];
const key = (shell, target, name, extra = {}) => target.dispatchEvent(new shell.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
const bannerText = (shell) => shell.SigK.viewBanner.text();

test('ボタンの名前と、一覧を開く印（aria-haspopup・aria-expanded）', async (t) => {
  const shell = await createToolShell(t);
  const button = shell.document.getElementById('split-use-open');
  assert.match(button.textContent, /開いているタブから選ぶ/);
  assert.equal(button.getAttribute('aria-haspopup'), 'menu');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(menuOf(shell), null);
});

test('一覧はタブの並び順で、選んでいるタブと未保存の編集の印を付け、title にフルパスを出す', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  shell.document.getElementById('split-use-open').click();
  const rows = rowsOf(shell);
  assert.deepEqual(rows.map((row) => row.querySelector('.name').textContent), ['a.pdf', 'b.pdf', 'c.pdf']);
  assert.deepEqual(rows.map((row) => row.title), [A, B, C]);
  assert.equal(rows[0].querySelector('.mark').textContent, '選んでいるタブ');
  assert.equal(rows[1].querySelector('.mark').textContent, '未保存の編集あり');
  assert.notEqual(rows[1].querySelector('.dot'), null);
  assert.equal(rows[2].querySelector('.mark'), null);
  assert.equal(rows[0].getAttribute('role'), 'menuitem');
});

test('選ぶとそのタブの PDF が対象になり、未保存なら注意と黄色の帯。一覧は閉じてボタンへ戻る', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const button = shell.document.getElementById('split-use-open');
  button.click();
  rowsOf(shell)[1].click();
  await shell.flush();
  await shell.flush();
  assert.equal(shell.SigK.toolsSplit.source().path, B);
  assert.equal(shell.SigK.toolsSplit.source().note, '未保存の編集は反映されません');
  assert.match(bannerText(shell), /未保存の編集は分割に反映されないので/);
  assert.equal(menuOf(shell), null);
  assert.equal(shell.document.activeElement, button);
});

test('タブが無ければ、押せない案内の 1 行だけを出す（帯は出さない）', async (t) => {
  const shell = await createToolShell(t);
  shell.document.getElementById('split-use-open').click();
  assert.equal(rowsOf(shell).length, 0);
  const empty = shell.document.querySelector('.tab-menu .tab-menu-empty');
  assert.equal(empty.textContent, 'タブで開いている PDF はありません');
  empty.click();
  assert.equal(shell.SigK.toolsSplit.source(), null);
  assert.equal(bannerText(shell), '');
});

test('キー: ↓ で開いて選んでいるタブへ、↑↓ は端で反対の端へ、Home・End、Enter で選ぶ', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const doc = shell.document;
  const button = doc.getElementById('split-use-open');
  button.focus();
  key(shell, button, 'ArrowDown');
  const rows = rowsOf(shell);
  assert.equal(doc.activeElement, rows[0]);
  key(shell, doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, rows[2]);
  key(shell, doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, rows[0]);
  key(shell, doc.activeElement, 'End');
  assert.equal(doc.activeElement, rows[2]);
  key(shell, doc.activeElement, 'Home');
  assert.equal(doc.activeElement, rows[0]);
  key(shell, doc.activeElement, 'ArrowDown');
  key(shell, doc.activeElement, 'Enter');
  await shell.flush();
  await shell.flush();
  assert.equal(shell.SigK.toolsSplit.source().path, B);
  assert.equal(doc.activeElement, button);
});

test('Esc は閉じてボタンへ戻る。Tab は閉じる。外を押しても閉じる', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const doc = shell.document;
  const button = doc.getElementById('split-use-open');
  button.focus();
  key(shell, button, 'ArrowDown');
  assert.notEqual(menuOf(shell), null);
  key(shell, doc.activeElement, 'Escape');
  assert.equal(menuOf(shell), null);
  assert.equal(doc.activeElement, button);

  key(shell, button, 'ArrowDown');
  assert.notEqual(menuOf(shell), null);
  key(shell, doc.activeElement, 'Tab');
  assert.equal(menuOf(shell), null);

  button.click();
  assert.notEqual(menuOf(shell), null);
  doc.getElementById('split-run').dispatchEvent(new shell.window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(menuOf(shell), null);
});

test('一覧の外にフォーカスがあるときの Esc も、一覧を閉じる（Esc の順の 2 段目）', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const doc = shell.document;
  doc.getElementById('split-use-open').click();
  assert.notEqual(menuOf(shell), null);
  doc.body.focus();
  key(shell, doc.body, 'Escape');
  assert.equal(menuOf(shell), null);
});

// 結合は帯と右の欄へ移り、［開いているタブをまとめて追加］は無くした（spec-2-5 確定事項E6）。空のときの案内は右の欄の文。
test('2 画面の何も選んでいないときの案内と、結合の空のときの案内（F8・F9・第 I 章、spec-2-5 確定事項E2・E4・E5）', async (t) => {
  const shell = await createToolShell(t);
  const text = (id) => shell.document.getElementById(id).textContent.trim();
  const lead = '［開いているタブから選ぶ］か［ファイルを選ぶ…］で選ぶか、ここへ PDF をドラッグして、';
  assert.equal(text('split-empty'), `${lead}分割する PDF を決めてください。`);
  assert.equal(text('wm-empty'), `${lead}透かしを入れる PDF を決めてください。`);
  assert.equal(shell.document.getElementById('merge-add-open'), null);
  assert.equal(text('merge-empty'), 'PDF を開くと、ここにまとめるファイルが並びます。');
});

test('窓が非活性になる・窓の大きさが変わると、一覧を閉じる（F6）', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const button = shell.document.getElementById('split-use-open');
  button.click();
  assert.notEqual(menuOf(shell), null);
  shell.window.dispatchEvent(new shell.window.Event('blur'));
  assert.equal(menuOf(shell), null);
  button.click();
  assert.notEqual(menuOf(shell), null);
  shell.window.dispatchEvent(new shell.window.Event('resize'));
  assert.equal(menuOf(shell), null);
});

test('開けなかったタブも一覧に並べ、選ぶと対象の行に読めない印が付く（F2）', async (t) => {
  const shell = await createToolShell(t);
  const { SigK } = shell;
  await SigK.tabs.openPath(A);
  await shell.flush();
  const original = SigK.pdfjs.getDocument;
  SigK.pdfjs.getDocument = () => ({ promise: Promise.reject(Object.assign(new Error('broken'), { name: 'InvalidPDFException' })), destroy: async () => {} });
  t.after(() => { SigK.pdfjs.getDocument = original; });
  await SigK.tabs.openPath(B);
  await shell.flush();
  assert.equal(SigK.tabs.list().length, 2, '開けなくてもタブは作る');
  SigK.shell.setMode(shell.document, 'tools');
  SigK.tools.select('split');

  shell.document.getElementById('split-use-open').click();
  assert.deepEqual(rowsOf(shell).map((row) => row.title), [A, B]);
  rowsOf(shell)[1].click();
  for (let i = 0; i < 4; i += 1)
    await shell.flush();
  const src = SigK.toolsSplit.source();
  assert.equal(src.path, B);
  assert.match(src.blocked ?? '', /選び直してください$/);
});

test('一覧を開いたあとで押せなくなったら（実行中）、行を押しても選ばずに閉じる（F6）', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const button = shell.document.getElementById('split-use-open');
  button.click();
  button.setAttribute('aria-disabled', 'true');
  rowsOf(shell)[2].click();
  await shell.flush();
  assert.equal(menuOf(shell), null);
  assert.equal(shell.SigK.toolsSplit.source(), null);
});

test('押せない（実行中）ときは開かない', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  const button = shell.document.getElementById('split-use-open');
  button.setAttribute('aria-disabled', 'true');
  button.click();
  assert.equal(menuOf(shell), null);
});

// PDF→画像・フラット化は帯の画面へ移り、選んでいる帯が対象になった（spec-2-5 確定事項E4・E5・E6）。
test('透かしでも、選んだタブの PDF が対象になる', async (t) => {
  const screens = [
    { tool: 'watermark', id: 'wm-use-open', of: (SigK) => SigK.toolsWatermark },
  ];
  for (const screen of screens) {
    const shell = await createToolShell(t, screen.tool, { taskResults: [CENSUS] });
    await openThreeTabs(shell);
    shell.SigK.tools.select(screen.tool);
    const button = shell.document.getElementById(screen.id);
    assert.match(button.textContent, /開いているタブから選ぶ/, screen.tool);
    button.click();
    rowsOf(shell)[2].click();
    await shell.flush();
    await shell.flush();
    assert.equal(screen.of(shell.SigK).source().path, C, screen.tool);
  }
});

test('ツールを切り替えると一覧は閉じる', async (t) => {
  const shell = await createToolShell(t);
  await openThreeTabs(shell);
  shell.document.getElementById('split-use-open').click();
  assert.notEqual(menuOf(shell), null);
  shell.SigK.tools.select('merge');
  assert.equal(menuOf(shell), null);
});
