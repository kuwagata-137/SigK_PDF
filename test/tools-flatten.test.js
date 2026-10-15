'use strict';

// フラット化（spec-4-5 確定事項7〜11・32・40〜44、spec-2-5 確定事項E5。決定80 ㉞。見本 screenshots/strips2-flatten.png）。
//
// 焼き込むのはワーカーで、その中身は test/op-flatten.test.js が見ている。ここは「選んでいる帯を対象にして件数をページごとに数え、
// チェックした種類と選んだページの分を足し合わせ、残すもの・失うものを出し、確認のあと何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\out\\a_フラット化.pdf';
const ZERO_KEEP = { functional: 0, noAppearance: 0, hidden: 0 };
const page = (bake, keep = ZERO_KEEP) => ({ bake: { markup: 0, text: 0, shape: 0, note: 0, other: 0, ...bake }, keep: { ...ZERO_KEEP, ...keep } });
// 3 ページの文書。1 ページ目と 2 ページ目に書き込みがある（合計 12 件）。
const CENSUS = {
  ok: true, baked: 12, kept: 3, notes: 2,
  bake: { markup: 4, text: 2, shape: 3, note: 2, other: 1 },
  keep: { functional: 1, noAppearance: 2, hidden: 0 },
  pages: [
    page({ markup: 2, text: 1, shape: 1, note: 1, other: 1 }, { functional: 1, noAppearance: 1 }),
    page({ markup: 2, text: 1, shape: 2, note: 1 }, { noAppearance: 1 }),
    page({}),
  ],
};
const NONE = { ok: true, baked: 0, kept: 1, notes: 0, bake: page({}).bake, keep: { functional: 1, noAppearance: 0, hidden: 0 }, pages: [page({}, { functional: 1 }), page({}), page({})] };

async function createFlattenShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A, mtimeMs: 1000 }), [B]: makeSource({ path: B }), [OUT]: makeSource({ path: OUT }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('flatten');
  return shell;
}

const plain = (value) => structuredClone(value);
const byId = (shell, id) => shell.document.getElementById(id);
const summary = (shell) => byId(shell, 'fl-summary').textContent;
const runButton = (shell) => byId(shell, 'fl-run');
const rows = (shell) => [...byId(shell, 'fl-list').querySelectorAll('.fl-row')];

async function settle(shell) {
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
}

// 帯（＝タブ）を開いて選ぶ。開いたタブが選んでいる帯になり、それが対象になる。
async function openTab(shell, filePath = A) {
  await shell.SigK.tabs.openPath(filePath);
  await settle(shell);
}

function check(shell, group, on) {
  const box = byId(shell, 'fl-list').querySelector(`.fl-row[data-group="${group}"] input`);
  box.checked = on;
  box.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

function range(shell, text) {
  const input = byId(shell, 'fl-range');
  input.dispatchEvent(new shell.window.Event('focus'));
  input.value = text;
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
}

test('帯が無ければ状態の文を出し、数えず、実行できない', async (t) => {
  const shell = await createFlattenShell(t);
  const item = shell.document.querySelector('#tools-list .tool-item[data-tool="flatten"]');
  assert.match(item.textContent, /フラット化書き込みを焼き込む/);
  assert.equal(shell.SigK.tools.panelFor('flatten').parentElement.id, 'tool-pane');
  assert.equal(shell.SigK.tools.panelFor('flatten').hidden, false);
  assert.equal(byId(shell, 'fl-state').textContent, 'PDF を開くと、選んでいる帯が対象になります。');
  assert.equal(summary(shell), '');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(byId(shell, 'fl-list').hidden, true);
  assert.equal(shell.taskCalls.length, 0);
});

test('選んでいる帯をワーカーで数え、ファイルにある種類ごとのチェックボックスと件数・残すもの・失うものを出す', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  await openTab(shell);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec)), [{ kind: 'flatten-preview', source: A }]);
  // census() の写しには文書と待ちの Promise を入れない（起動確認の executeJavaScript が写せずに止まった）。
  assert.deepEqual(Object.keys(shell.SigK.toolsFlatten.census()).sort(), ['error', 'path', 'pending', 'result', 'tabId', 'waiting']);
  assert.equal(byId(shell, 'fl-state').hidden, true);
  assert.deepEqual(rows(shell).map((row) => row.textContent), [
    'ハイライト・下線・取り消し線4 件', 'テキスト・吹き出し2 件', '図形・ペン3 件', 'ノート2 件', 'スタンプなど1 件',
  ]);
  assert.deepEqual(rows(shell).map((row) => row.querySelector('input').checked), [true, true, true, true, true], '既定は全部チェック');
  assert.equal(byId(shell, 'fl-keep-text').textContent,
    'リンク・フォームの欄など 1 件はそのまま残します。見た目の情報を持たない書き込み 2 件（直線・テキストなど）は焼き込めないため、書き込みのまま残します。');
  assert.equal(byId(shell, 'fl-warn').textContent, 'ノート 2 件は付箋の絵だけが残り、本文と作成者は書き出したファイルに残りません。');
  assert.equal(summary(shell), '書き込み 12 件を焼き込みます');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), null);
  assert.equal(byId(shell, 'fl-page-modes').querySelector('input[value="all"]').checked, true, '既定は［すべて］');
  assert.equal(shell.SigK.viewBanner.isVisible(), false, '数え終えたら「書き込みを確認しています」の通知バーは下げる');
});

test('種類のチェックを外すと、焼く件数と要約が変わり、選ばなかった書き込みは残すと書く。全部外すと実行できない', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  await openTab(shell);
  check(shell, 'note', false);
  assert.equal(summary(shell), '書き込み 10 件を焼き込みます');
  assert.equal(byId(shell, 'fl-warn').hidden, true, 'ノートを焼かなければノートの注意は出さない');
  assert.match(byId(shell, 'fl-keep-text').textContent, /選ばなかった書き込み 2 件（チェックを外した種類・範囲の外のページ）は、書き込みのまま残します。$/);
  for (const group of ['markup', 'text', 'shape', 'other'])
    check(shell, group, false);
  assert.equal(summary(shell), '焼き込む書き込みを選んでください。');
  assert.equal(shell.SigK.toolsFlatten.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('ページを範囲にすると、種類の件数・残すもの・要約はそのページの分になる。範囲の誤りは欄の下に出す', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  await openTab(shell);
  range(shell, '2');
  assert.equal(byId(shell, 'fl-page-modes').querySelector('input[value="range"]').checked, true, '欄に触れたら［範囲］');
  assert.deepEqual(rows(shell).map((row) => row.textContent), [
    'ハイライト・下線・取り消し線2 件', 'テキスト・吹き出し1 件', '図形・ペン2 件', 'ノート1 件', 'スタンプなど0 件',
  ], 'ファイルにある種類の行は、範囲の外にしか無くても残す');
  assert.equal(summary(shell), '書き込み 6 件を焼き込みます');
  assert.match(byId(shell, 'fl-keep-text').textContent, /^見た目の情報を持たない書き込み 1 件/);
  assert.match(byId(shell, 'fl-keep-text').textContent, /選ばなかった書き込み 6 件/);

  range(shell, '9');
  assert.equal(byId(shell, 'fl-range').classList.contains('invalid'), true);
  assert.equal(byId(shell, 'fl-range-err').hidden, false);
  assert.match(byId(shell, 'fl-range-err').textContent, /3ページまで/);
  assert.equal(summary(shell), '');
  assert.equal(shell.SigK.toolsFlatten.canRun(), false);
});

test('範囲の欄が誤りの間も種類の行は消さず、件数はファイル全体の数で出す。残すもの・ノートの注意は出さない（点検の直し）', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS] });
  await openTab(shell);
  range(shell, '9');
  assert.equal(byId(shell, 'fl-list').hidden, false, '範囲を打っている途中で行が消えない（確定事項E5-1）');
  assert.deepEqual(rows(shell).map((row) => row.textContent), [
    'ハイライト・下線・取り消し線4 件', 'テキスト・吹き出し2 件', '図形・ペン3 件', 'ノート2 件', 'スタンプなど1 件',
  ]);
  assert.equal(byId(shell, 'fl-keep').hidden, true);
  assert.equal(byId(shell, 'fl-warn').hidden, true);
  assert.equal(summary(shell), '');
  assert.equal(shell.SigK.toolsFlatten.canRun(), false);

  range(shell, '2');
  assert.equal(rows(shell).at(-1).textContent, 'スタンプなど0 件', '正しい範囲に直したら、そのページの件数に戻る');
  assert.equal(summary(shell), '書き込み 6 件を焼き込みます');
});

test('焼くものが無いファイル・数えられないファイルは理由を出して実行できない', async (t) => {
  const none = await createFlattenShell(t, { taskResults: [NONE] });
  await openTab(none);
  assert.equal(byId(none, 'fl-list').hidden, true);
  assert.equal(byId(none, 'fl-status').textContent, '焼き込める書き込みがありません。');
  assert.equal(byId(none, 'fl-keep-text').textContent, 'リンク・フォームの欄など 1 件はそのまま残します。');
  assert.equal(summary(none), '焼き込める書き込みがありません。');

  const broken = await createFlattenShell(t, { taskResults: [{ error: 'この PDF は内容が壊れているため保存できません。' }] });
  await openTab(broken);
  assert.equal(byId(broken, 'fl-status').textContent, 'この PDF は内容が壊れているため保存できません。');
  assert.equal(summary(broken), 'この PDF は内容が壊れているため保存できません。');
  assert.equal(runButton(broken).getAttribute('aria-disabled'), 'true');
});

test('開けなかった帯・パスワード付きの帯は数えずに、状態の文を出す', async (t) => {
  const failed = await createFlattenShell(t, { pdfjs: createPdfjsStub({ openError: new Error('broken') }) });
  await openTab(failed);
  assert.equal(byId(failed, 'fl-state').textContent, '「a.pdf」は開けなかったので、ほかの帯を選んでください。');
  assert.equal(failed.taskCalls.length, 0);
  assert.equal(failed.SigK.toolsFlatten.canRun(), false);

  const locked = await createFlattenShell(t, { taskResults: [CENSUS] });
  await openTab(locked);
  const peek = locked.SigK.tabs.peek;
  locked.window.SigK.tabs.peek = (id) => ({ ...peek(id), file: { ...peek(id).file, encrypted: true } });
  locked.SigK.toolsFlattenView.render();
  assert.equal(locked.SigK.toolsFlatten.source().blocked, '「a.pdf」はパスワード付きなので焼き込めません。ほかの帯を選んでください。');
  assert.equal(locked.SigK.toolsFlatten.canRun(), false);
});

test('帯を選び直すと数え直し、種類とページの選び方は全部チェック・［すべて］に戻す', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS, CENSUS] });
  await openTab(shell, A);
  check(shell, 'note', false);
  range(shell, '1');
  await openTab(shell, B);
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec.source)), [A, B]);
  assert.deepEqual(plain(shell.SigK.toolsFlatten.choices()), { kinds: ['markup', 'text', 'shape', 'note', 'other'], mode: 'all', range: '' });
  assert.equal(summary(shell), '書き込み 12 件を焼き込みます');
});

// ---- 実行（spec-4-5 確定事項9〜11・40〜44） ----

test('実行は保存ダイアログ → 確認（既定はキャンセル）→ 選んだ種類とページで焼き込み。書けたら新しい帯として足す', async (t) => {
  const shell = await createFlattenShell(t, {
    taskResults: [CENSUS, { ok: true, baked: 5, kept: 3, notes: 0, path: OUT }],
    savePathResults: [{ path: OUT }],
  });
  await openTab(shell);
  check(shell, 'note', false);
  range(shell, '2-3');
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  assert.deepEqual(plain(shell.savePathCalls), [{ defaultPath: 'C:\\work\\a_フラット化.pdf', title: 'フラット化した PDF を保存' }]);
  assert.equal(shell.SigK.confirmFlatten.isOpen(), true);
  assert.equal(shell.document.activeElement?.id, 'confirm-flatten-cancel');
  assert.equal(byId(shell, 'confirm-flatten-text').textContent,
    '書き込み 5 件をページの内容として焼き込み、「a_フラット化.pdf」に書き出します。書き出したファイルでは、これらの書き込みを選んだり直したりできません。元のファイルは変わりません。');
  assert.equal(byId(shell, 'confirm-flatten-notes').hidden, true);
  assert.equal(shell.taskCalls.length, 1, '確認の前にはワーカーへ渡さない');
  byId(shell, 'confirm-flatten-ok').click();
  const result = await running;
  await settle(shell);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(shell.taskCalls[1].spec), { kind: 'flatten', source: A, target: OUT, kinds: ['markup', 'text', 'shape', 'other'], pages: [1, 2] });
  assert.equal(shell.SigK.tabs.list().some((tab) => tab.path === OUT), true);
  assert.equal(shell.SigK.viewBanner.text(), '書き込み 5 件を焼き込みました');
});

test('［すべて］のページなら pages は渡さない（ワーカーが全部のページを焼く）', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS, { ok: true, baked: 12, path: OUT }], savePathResults: [{ path: OUT }] });
  await openTab(shell);
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  byId(shell, 'confirm-flatten-ok').click();
  await running;
  assert.deepEqual(plain(shell.taskCalls[1].spec), { kind: 'flatten', source: A, target: OUT, kinds: ['markup', 'text', 'shape', 'note', 'other'] });
});

test('保存ダイアログと確認の間も実行中と数え、キャンセルすれば下ろす（spec-5-1 確定事項12）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await createFlattenShell(t, { taskResults: [CENSUS], savePathResults: [dialog] });
  await openTab(shell);
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  assert.equal(shell.SigK.toolsFlatten.isRunning(), true, '保存ダイアログの間');
  answer({ path: OUT });
  await settle(shell);
  assert.equal(byId(shell, 'confirm-flatten').open, true);
  assert.equal(shell.SigK.toolsFlatten.isRunning(), true, '確認の間');
  byId(shell, 'confirm-flatten-cancel').click();
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.SigK.toolsFlatten.isRunning(), false);
  assert.equal(shell.SigK.toolsFlatten.canRun(), true);
  assert.equal(shell.taskCalls.length, 1, '焼き込まない');
});

test('入力と同じ出力先は、確認を出す前に断る', async (t) => {
  const shell = await createFlattenShell(t, { taskResults: [CENSUS], savePathResults: [{ path: A }] });
  await openTab(shell);
  assert.equal((await shell.SigK.toolsFlatten.run()).error, '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(shell.SigK.confirmFlatten.isOpen(), false);
  assert.equal(shell.taskCalls.length, 1);
});

test('保存していない帯は［上書き保存してから実行］で保存し、数え直してから焼き込む（spec-2-5 確定事項F）', async (t) => {
  const saved = { ok: true, path: A, signature: { size: 2048, mtimeMs: 2000 } };
  const shell = await createFlattenShell(t, {
    taskResults: [CENSUS, saved, NONE],
    savePathResults: [{ path: OUT }],
  });
  await openTab(shell);
  shell.SigK.pageEdit.rotate(90, [0]);
  const running = shell.SigK.toolsFlatten.run();
  await settle(shell);
  assert.equal(shell.SigK.confirmUnsavedRun.isOpen(), true);
  byId(shell, 'confirm-unsaved-run-save').click();
  const result = await running;
  assert.deepEqual(plain(shell.taskCalls.map((call) => call.spec.kind)), ['flatten-preview', 'save', 'flatten-preview']);
  assert.equal(result.error, '焼き込める書き込みがありません。', '保存した中身を数え直し、焼くものが無ければ止める');
  assert.equal(shell.savePathCalls.length, 0);
});
