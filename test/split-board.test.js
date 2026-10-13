'use strict';

// 分割の盤の画面（spec-2-2b 確定事項A・B・C・H・I。見本 screenshots/phase2-2b-*.png）。
// 盤の純粋な操作は split-board-model.test.js、配置は split-board-layout.test.js、描く層は split-thumbs.test.js が見る。
// ここは、画面の上で押した・選んだときに盤・右の欄・下の要約・実行がどう変わるかを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function createBoardShell(t, { pages = 3, ...options } = {}) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ sizes: Array.from({ length: pages }, () => A4) }),
    files: { [A]: makeSource({ path: A }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  // jsdom は大きさを計算しないので、盤の器の幅と高さを与える。
  const scroll = shell.document.getElementById('split-board-scroll');
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 500 });
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('split');
  return shell;
}

async function withSource(t, options) {
  const shell = await createBoardShell(t, options);
  await shell.SigK.toolsSplit.setSource(A);
  await settle(shell);
  return shell;
}

const settle = async (shell) => {
  for (let i = 0; i < 6; i += 1)
    await shell.flush();
};
const plain = (value) => structuredClone(value);
const $ = (shell, selector) => shell.document.querySelector(selector);
const $$ = (shell, selector) => [...shell.document.querySelectorAll(selector)];
const summary = (shell) => $(shell, '#split-summary').textContent;
const runDisabled = (shell) => $(shell, '#split-run').getAttribute('aria-disabled') === 'true';
const boxHeads = (shell) => $$(shell, '#split-board-canvas .sb-box').map((box) => box.querySelector('.sb-head').textContent);
const fileRows = (shell) => $$(shell, '#split-files .sb-file').map((row) => row.textContent);
const edit = (shell) => shell.SigK.toolsSplitEdit;

test('PDF を決める前は、盤に案内を出し、実行は押せない', async (t) => {
  const shell = await createBoardShell(t);
  assert.equal($(shell, '#split-board-empty').hidden, false);
  assert.equal($(shell, '#split-board-empty').textContent, '分割する PDF を決めると、ここに全部のページが並びます。');
  assert.equal(summary(shell), '分割する PDF を決めてください。');
  assert.equal(runDisabled(shell), true);
  assert.equal($(shell, '#split-files-card').hidden, true);
});

test('入れた直後は分け目なしの箱 1 つで、✂ の使い方を案内して実行は押せない（決定76 ④）', async (t) => {
  const shell = await withSource(t);
  assert.equal($(shell, '#split-board-empty').hidden, true);
  assert.deepEqual(boxHeads(shell), ['1a_001.pdf1〜3 ページ']);
  assert.equal($$(shell, '#split-board-canvas .sb-page').length, 3);
  assert.deepEqual($$(shell, '#split-board-canvas .sb-cut').map((cut) => cut.dataset.cut), ['1', '2']);
  assert.equal(summary(shell), '✂ で分け目を入れるか、書き出さないページを決めると、実行できます。');
  assert.equal($(shell, '#split-summary').classList.contains('wait'), true);
  assert.equal(runDisabled(shell), true);
  assert.deepEqual(fileRows(shell), ['1a_001.pdf1〜3 ページ']);
});

test('✂ を押すと箱が割れ、［前のファイルとつなげる］で戻る', async (t) => {
  const shell = await withSource(t);
  $(shell, '#split-board-canvas .sb-cut[data-cut="2"]').click();
  assert.deepEqual(boxHeads(shell), ['1a_001.pdf1〜2 ページ', '2a_002.pdf3 ページ目前のファイルとつなげる']);
  assert.equal(summary(shell), '3 ページを 2 つのファイルに分けます。');
  assert.equal(runDisabled(shell), false);
  assert.deepEqual(fileRows(shell), ['1a_001.pdf1〜2 ページ', '2a_002.pdf3 ページ目']);
  assert.equal($(shell, '#split-files-count').textContent, '2 つ');
  $(shell, '#split-board-canvas .sb-box[data-box="1"] .sb-join').click();
  assert.deepEqual(boxHeads(shell), ['1a_001.pdf1〜3 ページ']);
});

test('ページ番号の規則を選ぶと、箱と一覧の名前も変わる', async (t) => {
  const shell = await withSource(t);
  edit(shell).cut(2);
  $(shell, 'input[name="split-rule"][value="pages"]').click();
  assert.deepEqual(fileRows(shell), ['1a_p1-2.pdf1〜2 ページ', '2a_p3.pdf3 ページ目']);
  assert.equal($(shell, '#split-rule-pages').textContent, 'a_p1-2.pdf');
});

test('まとめて分ける 4 つ。番号の欄の誤りは赤くして段の下に出し、打ち直すと消える', async (t) => {
  const shell = await withSource(t, { pages: 10 });
  const parts = () => plain(shell.SigK.toolsSplit.currentPlan().parts);
  $(shell, '#split-each').click();
  assert.equal(parts().length, 10);

  $(shell, '#split-every').value = '4';
  $(shell, '#split-every').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  $(shell, '#split-every-go').click();
  assert.deepEqual(parts(), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);

  $(shell, '#split-at').value = '1, 5';
  $(shell, '#split-at').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  $(shell, '#split-at-go').click();
  assert.equal($(shell, '#split-bulk-err').hidden, false);
  assert.equal($(shell, '#split-bulk-err').textContent, '1 の前では切れないので、2 から書いてください');
  assert.equal($(shell, '#split-at').classList.contains('invalid'), true);
  assert.deepEqual(parts(), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]], '誤りのときは盤を変えない');
  $(shell, '#split-at').value = '5';
  $(shell, '#split-at').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.equal($(shell, '#split-bulk-err').hidden, true);
  assert.equal($(shell, '#split-at').classList.contains('invalid'), false);
  $(shell, '#split-at-go').click();
  assert.deepEqual(parts(), [[0, 1, 2, 3], [4, 5, 6, 7, 8, 9]]);
  assert.equal($(shell, '#split-at').value, '5', '押したあとも欄の文字は残す');

  $(shell, '#split-clear').click();
  assert.equal(shell.SigK.toolsSplit.currentPlan().reason, 'untouched');
});

test('選ぶと帯が出て、書き出さない・書き出す・1 つのファイルにする・選ぶのをやめるが効く', async (t) => {
  const shell = await withSource(t, { pages: 6 });
  edit(shell).cut(4);
  edit(shell).select(1);
  edit(shell).select(2, { shift: true });
  assert.equal($(shell, '#split-band').hidden, false);
  assert.equal($(shell, '#split-band-text').textContent, '2〜3 ページを選んでいます');
  assert.deepEqual($$(shell, '.sb-page.sel').map((page) => page.dataset.page), ['1', '2']);

  $(shell, '#split-band-skip').click();
  assert.deepEqual($$(shell, '.sb-page.skip').map((page) => page.dataset.page), ['1', '2']);
  assert.equal($(shell, '.sb-page.skip .tag').textContent, '書き出さない');
  assert.match(boxHeads(shell)[0], /2・3 ページは書き出さない/);
  assert.equal(summary(shell), '2・3 ページ目を書き出さずに、残りの 4 ページを 2 つのファイルに分けます。');
  assert.equal($(shell, '#split-band-skip').hidden, true, '全部が書き出さないページなら［書き出す］');
  assert.equal($(shell, '#split-band-unskip').hidden, false);

  edit(shell).select(1);
  edit(shell).select(4, { shift: true });
  $(shell, '#split-band-one').click();
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2, 3, 4], [5]]);
  assert.equal($(shell, '#split-band').hidden, true, '1 つのファイルにしたら選択を外す');

  edit(shell).select(5);
  $(shell, '#split-band-clear').click();
  assert.equal($(shell, '#split-band').hidden, true);
  assert.equal($(shell, '#split-band-text').textContent, '');
});

test('狭い箱（幅 420px 未満）は見出しを 2 行にし、書き出さない札は出さない（ページの札で分かる）', async (t) => {
  const shell = await withSource(t, { pages: 6 });
  edit(shell).cut(3);
  edit(shell).select(1);
  edit(shell).skip();
  const box = $(shell, '#split-board-canvas .sb-box[data-box="0"]');
  assert.equal(box.classList.contains('narrow'), true);
  assert.equal(box.querySelector('.chip'), null);
  assert.equal($(shell, '.sb-page[data-page="1"] .tag').textContent, '書き出さない');
});

test('1 ページだけ選んだときの帯の文', async (t) => {
  const shell = await withSource(t);
  edit(shell).select(2);
  assert.equal($(shell, '#split-band-text').textContent, '3 ページ目を選んでいます');
});

test('全部を書き出さないにすると、実行できない理由を案内する', async (t) => {
  const shell = await withSource(t);
  edit(shell).select(0);
  edit(shell).select(2, { shift: true });
  edit(shell).skip();
  assert.equal(summary(shell), '書き出すページが 1 枚も無いので、書き出さない印をどれか外してください。');
  assert.equal(runDisabled(shell), true);
  assert.match(boxHeads(shell)[0], /^－書き出さない/);
});

test('500 を超えるファイルになる分け方は、数を添えて実行を止める', async (t) => {
  const shell = await withSource(t, { pages: 640 });
  $(shell, '#split-each').click();
  assert.equal(summary(shell), 'いまの分け方では 640 ファイルになり、上限の 500 を超えるので、実行できません。');
  assert.equal(runDisabled(shell), true);
});

test('書き出さないページが 4 枚以上なら、要約は枚数で言う', async (t) => {
  const shell = await withSource(t, { pages: 10 });
  edit(shell).select(0);
  edit(shell).select(3, { shift: true });
  edit(shell).skip();
  assert.equal(summary(shell), '4 ページを書き出さずに、残りの 6 ページを 1 つのファイルに分けます。');
});

test('［元に戻す］［やり直す］は盤の操作を 1 つずつ戻し、選択は外す', async (t) => {
  const shell = await withSource(t);
  assert.equal($(shell, '#split-undo').getAttribute('aria-disabled'), 'true');
  edit(shell).cut(1);
  edit(shell).cut(2);
  edit(shell).select(0);
  $(shell, '#split-undo').click();
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2]]);
  assert.equal($(shell, '#split-band').hidden, true);
  assert.equal($(shell, '#split-redo').hasAttribute('aria-disabled'), false);
  $(shell, '#split-redo').click();
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1], [2]]);
  assert.equal($(shell, '#split-redo').getAttribute('aria-disabled'), 'true');
});

test('大きさ 小・中・大で、描く層の大きさと押している印が変わる', async (t) => {
  const shell = await withSource(t);
  assert.equal($(shell, '#split-size [data-size="mid"]').getAttribute('aria-checked'), 'true');
  $(shell, '#split-size [data-size="large"]').click();
  assert.equal(shell.SigK.splitThumbs.size(), 'large');
  assert.equal($(shell, '#split-size [data-size="large"]').getAttribute('aria-checked'), 'true');
  assert.equal($(shell, '#split-size [data-size="mid"]').getAttribute('aria-checked'), 'false');
  assert.equal($(shell, '.sb-sheet').style.width, '148px');
});

test('1,000 ページを 1 ページずつにしても、盤の DOM は見えている所の分だけ', async (t) => {
  const shell = await withSource(t, { pages: 1000 });
  $(shell, '#split-each').click();
  await settle(shell);
  const state = shell.SigK.splitBoardView.getState();
  assert.ok(state.pages > 0 && state.pages <= 80, `${state.pages}`);
  assert.ok(state.boxes <= 80, `${state.boxes}`);
  assert.ok(shell.SigK.splitThumbs.getState().drawn.length <= 72);
  assert.ok(Number.parseFloat($(shell, '#split-board-canvas').style.height) > 50000);
});

test('できるファイルの行を押すと、その箱へスクロールする', async (t) => {
  const shell = await withSource(t, { pages: 60 });
  $(shell, '#split-every').value = '10';
  $(shell, '#split-every').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  $(shell, '#split-every-go').click();
  $$(shell, '#split-files .sb-file')[4].click();
  const top = shell.SigK.splitBoardView.boxTop(4);
  assert.ok(top > 0);
  assert.equal($(shell, '#split-board-scroll').scrollTop, top);
});

test('実行は盤の parts と、読んだときの大きさと更新日時をワーカーへ渡す', async (t) => {
  const shell = await withSource(t, { taskResults: [{ ok: true, written: 2, targets: [] }] });
  edit(shell).cut(1);
  edit(shell).select(2);
  edit(shell).skip();
  await shell.SigK.toolsSplit.run();
  assert.deepEqual(plain(shell.taskCalls[0].spec), {
    kind: 'split', source: A, name: 'a.pdf',
    parts: [{ pages: [0], target: 'C:\\work\\a_001.pdf' }, { pages: [1], target: 'C:\\work\\a_002.pdf' }],
    targets: ['C:\\work\\a_001.pdf', 'C:\\work\\a_002.pdf'],
    expectSource: { size: 2048, mtimeMs: 1 },
  });
});

test('実行の前にファイルが書き換わっていたら、読み直して止める（確定事項D7）', async (t) => {
  const shell = await withSource(t);
  edit(shell).cut(1);
  shell.files[A] = makeSource({ path: A, mtimeMs: 5 });
  const result = await shell.SigK.toolsSplit.run();
  assert.equal(result.error, '「a.pdf」が書き換えられていたので、分割を止めました。読み直したページを確かめてから、もう一度実行してください。');
  assert.equal(shell.SigK.viewBanner.text(), result.error);
  assert.equal(shell.taskCalls.length, 0);
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2]], 'ページ数が同じなら分け目は残す');
  assert.equal(await shell.SigK.splitThumbs.isChanged(), false, '読み直した');
});

test('PDF を読んでいる途中で別のツールへ移っても、文書を開いたまま残さない。戻ると読み直して盤を出す', async (t) => {
  const shell = await createBoardShell(t);
  const setting = shell.SigK.toolsSplit.setSource(A);
  shell.SigK.tools.select('merge');
  assert.equal(await setting, true);
  await settle(shell);
  assert.ok(shell.pdfjs.documents.length >= 1, '読んだ');
  assert.equal(shell.pdfjs.documents.every((document) => document.destroyed), true);
  assert.equal(shell.SigK.toolsSplit.source().pageCount, 3);
  assert.equal(shell.SigK.toolsSplit.source().blocked, null);

  shell.SigK.tools.select('split');
  await settle(shell);
  assert.equal(shell.SigK.splitThumbs.getState().open, true);
  assert.equal(boxHeads(shell).length, 1);
  assert.notEqual(shell.SigK.viewBanner.text(), '「a.pdf」が書き換えられていたので、読み直しました。');
});

test('別のツールへ移ると畳み、戻ると読み直す。書き換わっていれば知らせる', async (t) => {
  const shell = await withSource(t);
  edit(shell).cut(1);
  shell.SigK.tools.select('merge');
  await settle(shell);
  assert.equal(shell.SigK.splitThumbs.getState().folded, true);
  assert.equal(shell.pdfjs.documents.every((document) => document.destroyed), true);

  shell.SigK.tools.select('split');
  await settle(shell);
  assert.equal(shell.SigK.splitThumbs.getState().open, true);
  assert.notEqual(shell.SigK.viewBanner.text(), '「a.pdf」が書き換えられていたので、読み直しました。');

  shell.SigK.tools.select('merge');
  await settle(shell);
  shell.files[A] = makeSource({ path: A, mtimeMs: 7 });
  shell.SigK.tools.select('split');
  await settle(shell);
  assert.equal(shell.SigK.viewBanner.text(), '「a.pdf」が書き換えられていたので、読み直しました。');
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2]]);
});

test('戻ったときにページ数が変わっていたら、分け目を消して知らせる', async (t) => {
  const sizes = [A4, A4, A4];
  const shell = await createBoardShell(t, { pdfjs: createPdfjsStub({ sizes }) });
  await shell.SigK.toolsSplit.setSource(A);
  await settle(shell);
  edit(shell).cut(1);
  shell.SigK.shell.setMode(shell.document, 'view');
  await settle(shell);
  sizes.push(A4);
  shell.files[A] = makeSource({ path: A, size: 4000 });
  shell.SigK.shell.setMode(shell.document, 'tools');
  await settle(shell);
  assert.equal(shell.SigK.viewBanner.text(), '「a.pdf」のページ数が変わっていたので、読み直して分け目を消しました。');
  assert.equal(shell.SigK.toolsSplit.source().pageCount, 4);
  assert.equal(shell.SigK.toolsSplit.currentPlan().reason, 'untouched');
});

test('実行中は盤の操作と段と帯を受けない', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await withSource(t, { taskResults: [gate] });
  edit(shell).cut(1);
  const running = shell.SigK.toolsSplit.run();
  await shell.flush();
  await shell.flush();
  assert.equal(shell.SigK.toolsSplit.isRunning(), true);
  edit(shell).cut(2);
  $(shell, '#split-each').click();
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2]]);
  assert.equal($(shell, '#split-each').getAttribute('aria-disabled'), 'true');
  assert.equal($(shell, '#split-every').disabled, true);
  // ✂ と［前のファイルとつなげる］も押せない色にする（確定事項C12）。大きさは見え方だけなので変えられる。
  assert.ok($$(shell, '.sb-cut').length > 0 && $$(shell, '.sb-join').length > 0);
  assert.ok($$(shell, '.sb-cut, .sb-join').every((node) => node.getAttribute('aria-disabled') === 'true'));
  $(shell, '.sb-join').click();
  assert.deepEqual(plain(shell.SigK.toolsSplit.currentPlan().parts), [[0], [1, 2]]);
  $(shell, '#split-size [data-size="small"]').click();
  assert.equal(shell.SigK.splitThumbs.size(), 'small');
  release({ ok: true, written: 2, targets: [] });
  await running;
  assert.equal($(shell, '#split-every').disabled, false);
  assert.ok($$(shell, '.sb-cut, .sb-join').every((node) => !node.hasAttribute('aria-disabled')));
});

test('まとめて分けるの欄の誤りは、［1 ページずつに分ける］と［分け目をすべて消す］でも消える', async (t) => {
  const shell = await withSource(t, { pages: 6 });
  const typeAt = (text) => {
    $(shell, '#split-at').value = text;
    $(shell, '#split-at').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
    $(shell, '#split-at-go').click();
  };
  const errorShown = () => $(shell, '#split-bulk-err').hidden === false || $(shell, '#split-at').classList.contains('invalid');
  typeAt('1');
  assert.equal(errorShown(), true);
  $(shell, '#split-each').click();
  assert.equal(errorShown(), false);
  typeAt('9');
  assert.equal($(shell, '#split-bulk-err').textContent, '6 ページまでです');
  $(shell, '#split-clear').click();
  assert.equal(errorShown(), false);
  typeAt('9');
  $(shell, '#split-clear').click();   // 盤は変わらないが、誤りの表示は消す
  assert.equal(errorShown(), false);
});

test('1,000 以上の数には、分割の画面のどこでもカンマを付ける。10 個からは「12 個」（決定78 ②③）', async (t) => {
  const shell = await withSource(t, { pages: 1200 });
  $(shell, '#split-every').value = '100';
  $(shell, '#split-every').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  $(shell, '#split-every-go').click();
  assert.equal(summary(shell), '1,200 ページを 12 個のファイルに分けます。');
  assert.equal($(shell, '#split-files-count').textContent, '12 個');
  assert.match(fileRows(shell)[10], /1,001〜1,100 ページ$/);
  assert.equal($(shell, '#split-pages').textContent, '1,200 ページ');

  shell.SigK.splitBoardView.revealBox(10);
  assert.ok(boxHeads(shell).some((head) => head.includes('1,001〜1,100 ページ')));
  assert.ok($$(shell, '.sb-page .cap').some((cap) => cap.textContent === '1,001'));

  edit(shell).select(1000);
  assert.equal($(shell, '#split-band-text').textContent, '1,001 ページ目を選んでいます');
  edit(shell).skip();
  assert.equal(summary(shell), '1,001 ページ目を書き出さずに、残りの 1,199 ページを 12 個のファイルに分けます。');
  assert.ok(boxHeads(shell).some((head) => head.includes('1,001 ページは書き出さない')));

  shell.SigK.splitZoom.open(1099);
  assert.equal($(shell, '#split-zoom-title').textContent, '1,100 / 1,200 ページ');
  shell.SigK.splitZoom.close();

  $(shell, '#split-at').value = '1300';
  $(shell, '#split-at').dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  $(shell, '#split-at-go').click();
  assert.equal($(shell, '#split-bulk-err').textContent, '1,200 ページまでです');
});

test('できるファイルの一覧は上限の 500 行までにし、残りの数を 1 行で知らせる。盤が変わらなければ組み直さない', async (t) => {
  const shell = await withSource(t, { pages: 1000 });
  $(shell, '#split-each').click();
  assert.equal($$(shell, '#split-files .sb-file').length, 500);
  assert.equal($(shell, '#split-files .sb-files-more').textContent, '上限の 500 を超えるので、残りの 500 個はここに並べません。');
  const first = $(shell, '#split-files .sb-file');
  edit(shell).select(3);
  assert.equal($(shell, '#split-files .sb-file'), first, '選んだだけでは一覧を組み直さない');
  $(shell, '#split-clear').click();
  assert.equal($$(shell, '#split-files .sb-file').length, 1);
  assert.equal($(shell, '#split-files .sb-files-more'), null);
});
