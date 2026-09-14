'use strict';

// PDF→画像の画面（spec-3-3 確定事項1〜30）。
//
// 描くのは pdf.js（page-image.js）で、jsdom には 2D コンテキストが無いので bytes は null で
// 通る。ここは「対象をどう決め、何ページをどの形式で、どこへ、どんな名前で書き、終わったら
// 何をするか」を見る。実際の画素は起動確認（SIGK_SMOKE_TO_IMAGE）に残す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, makeDroppedFile, makeDataTransfer, A4 } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT_DIR = 'C:\\out';
const targetsFor = (dir, names) => names.map((name) => `${dir}\\${name}`);
const A_TARGETS = targetsFor('C:\\work', ['a_001.png', 'a_002.png', 'a_003.png']);

async function createToImageShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('toImage');
  return shell;
}

const plain = (value) => structuredClone(value);
const runButton = (shell) => shell.document.getElementById('toimage-run');
const bannerText = (shell) => shell.SigK.viewBanner.text();
const exampleText = (shell) => shell.document.getElementById('toimage-example').textContent;
const summaryText = (shell) => shell.document.getElementById('toimage-summary').textContent;
const fire = (shell, id, value) => {
  const input = shell.document.getElementById(id);
  input.value = value;
  input.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
};
const check = (shell, name, value) => {
  const radio = shell.document.querySelector(`input[name="${name}"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
};
// imageAPI.write を待たせる。中止と実行中の画面を見るために使う。
function gateWrites(shell) {
  const gates = [];
  shell.window.imageAPI.write = (target, bytes) => new Promise((resolve) => {
    shell.imageWrites.push({ target, bytes });
    gates.push(() => resolve({ ok: true, path: target, bytes: 0 }));
  });
  return gates;
}

// ---- 対象（確定事項1〜5） ----

test('初期状態は対象が無く、実行は押せない。既定はすべて・PNG・150dpi', async (t) => {
  const shell = await createToImageShell(t);
  const { document: doc, SigK } = shell;
  assert.equal(SigK.toolsToImage.source(), null);
  assert.equal(doc.getElementById('toimage-empty').hidden, false);
  assert.equal(doc.getElementById('toimage-file').hidden, true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(SigK.toolsToImage.canRun(), false);
  assert.equal(exampleText(shell), '');
  assert.deepEqual(plain(SigK.toolsToImage.settings()), { mode: 'all', range: '', format: 'png', dpi: 150, folder: null });
  assert.equal(doc.querySelector('input[name="toimage-page-mode"][value="all"]').checked, true);
  assert.equal(doc.querySelector('input[name="toimage-format"][value="png"]').checked, true);
  assert.equal(doc.querySelector('input[name="toimage-dpi"][value="150"]').checked, true);
});

test('「ファイルを選ぶ」で対象が決まり、ページ数・寸法・フォルダー・出力の例が埋まる', async (t) => {
  const shell = await createToImageShell(t, { toolSourceResults: [{ path: A }] });
  const { document: doc, SigK } = shell;
  assert.equal(await SigK.toolsToImage.pickFile(), true);
  const src = SigK.toolsToImage.source();
  assert.equal(src.path, A);
  assert.equal(src.pageCount, 3);
  assert.deepEqual(plain(src.sizes), [A4, A4, A4]);
  assert.equal(doc.getElementById('toimage-name').textContent, 'a.pdf');
  assert.equal(doc.getElementById('toimage-pages').textContent, '3 ページ');
  assert.equal(doc.getElementById('toimage-empty').hidden, true);
  assert.equal(doc.getElementById('toimage-folder').textContent, 'C:\\work');
  assert.deepEqual(plain(SigK.toolsToImage.currentPlan().targets), A_TARGETS);
  assert.equal(exampleText(shell), 'a_001.png … a_003.png（3 ファイル・1240×1754 px）');
  assert.equal(summaryText(shell), '3 ページを PNG（150 dpi）で 3 ファイルへ');
  assert.equal(SigK.toolsToImage.canRun(), true);
  assert.equal(runButton(shell).hasAttribute('aria-disabled'), false);
  assert.ok(shell.pdfjs.documents.every((document) => document.destroyed), '寸法を読んだ文書は手放す（確定事項3）');
  // ダイアログの題名はこのツールのもの（確定事項2）。
  assert.equal(shell.toolSourceCalls.length, 1);
  assert.equal(shell.toolSourceCalls[0].title, '画像にする PDF を選ぶ');
});

test('「開いているファイル」はアクティブなタブを対象にし、未保存なら注意を出す', async (t) => {
  const shell = await createToImageShell(t);
  const { document: doc, SigK } = shell;
  await SigK.tabs.openPath(A);
  await SigK.tabs.openPath(B);
  await shell.flush();
  SigK.pageEdit.commit([{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }]);
  SigK.shell.setMode(doc, 'tools');

  doc.getElementById('toimage-use-open').click();
  await shell.flush();
  await shell.flush();
  assert.equal(SigK.toolsToImage.source().path, B);
  assert.equal(SigK.toolsToImage.source().note, '未保存の編集は反映されません');
  assert.equal(doc.getElementById('toimage-note').textContent, '未保存の編集は反映されません');
  assert.match(bannerText(shell), /未保存の編集は画像に反映されません/);
});

test('開いているファイルが無ければ帯で伝える', async (t) => {
  const shell = await createToImageShell(t);
  assert.equal(await shell.SigK.toolsToImage.useOpenTab(), false);
  assert.match(bannerText(shell), /開いているファイルがありません/);
});

test('PDF→画像を選んでいるときの PDF のドロップは対象になり、2本以上なら先頭だけ', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK, window } = shell;
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('b.pdf', B), makeDroppedFile('a.pdf', A)]);
  await SigK.fileDrop.handleDrop(event);
  assert.equal(SigK.toolsToImage.source().path, B);
  assert.equal(SigK.tabs.count(), 0, 'タブには開かない');
  assert.equal(SigK.toolsSplit.source(), null, '分割の対象にはしない');
  assert.equal(SigK.toolsMerge.rows().length, 0, '結合の一覧には足さない');
  assert.equal(bannerText(shell), '1つ目のファイルだけを対象にしました。');
});

test('対象を差し替えてもページ・形式・解像度・フォルダーの設定は残る', async (t) => {
  const shell = await createToImageShell(t, { folderResults: [{ path: OUT_DIR }] });
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  SigK.toolsToImage.setPageMode('range');
  SigK.toolsToImage.setRange('1,3');
  SigK.toolsToImage.setFormat('jpeg');
  SigK.toolsToImage.setDpi(300);
  assert.equal(await SigK.toolsToImage.pickFolder(), true);
  await SigK.toolsToImage.setSource(B);
  const settings = SigK.toolsToImage.settings();
  assert.deepEqual(plain(settings), { mode: 'range', range: '1,3', format: 'jpeg', dpi: 300, folder: OUT_DIR });
  assert.deepEqual(plain(SigK.toolsToImage.currentPlan().targets), targetsFor(OUT_DIR, ['b_001.jpg', 'b_003.jpg']));
});

// ---- 読めない対象（確定事項4・5） ----

test('壊れた PDF は印が付いて実行できない', async (t) => {
  const shell = await createToImageShell(t, { pdfjs: createPdfjsStub({ openError: new Error('broken') }) });
  const { document: doc, SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  assert.match(SigK.toolsToImage.source().blocked, /開けません。選び直してください/);
  assert.equal(doc.getElementById('toimage-file').classList.contains('blocked'), true);
  assert.equal(doc.getElementById('toimage-note').classList.contains('error'), true);
  assert.equal(SigK.toolsToImage.canRun(), false);
  assert.equal(exampleText(shell), '');
});

test('暗号化 PDF はパスワードを聞かずに「画像にできません」と断る（ユーザー確定②）', async (t) => {
  const shell = await createToImageShell(t, { pdfjs: createPdfjsStub({ password: 'secret' }) });
  await shell.SigK.toolsToImage.setSource(A);
  assert.equal(shell.SigK.toolsToImage.source().blocked, 'パスワード付きの PDF は画像にできません。選び直してください');
  assert.equal(shell.SigK.passwordPrompt.isOpen?.() ?? false, false);
  assert.equal(shell.SigK.toolsToImage.canRun(), false);
});

// ---- ページ・形式・解像度（確定事項6〜11） ----

test('範囲・形式・解像度を変えると出力の例と要約が追従し、範囲の誤りは欄の下に出る', async (t) => {
  const shell = await createToImageShell(t);
  const { document: doc, SigK } = shell;
  await SigK.toolsToImage.setSource(A);

  // 欄に打つと「範囲」が選ばれる。
  fire(shell, 'toimage-range', '1, 3');
  doc.getElementById('toimage-range').dispatchEvent(new shell.window.Event('focus'));
  assert.equal(SigK.toolsToImage.settings().mode, 'range');
  assert.equal(doc.querySelector('input[name="toimage-page-mode"][value="range"]').checked, true);
  assert.equal(exampleText(shell), 'a_001.png … a_003.png（2 ファイル・1240×1754 px）');
  assert.equal(summaryText(shell), '2 ページを PNG（150 dpi）で 2 ファイルへ');

  check(shell, 'toimage-format', 'jpeg');
  check(shell, 'toimage-dpi', '300');
  assert.equal(exampleText(shell), 'a_001.jpg … a_003.jpg（2 ファイル・2480×3508 px）');
  assert.equal(summaryText(shell), '2 ページを JPEG（300 dpi）で 2 ファイルへ');
  assert.deepEqual(plain(SigK.toolsToImage.currentPlan().targets), targetsFor('C:\\work', ['a_001.jpg', 'a_003.jpg']));

  // 1 ページだけなら「…」は出ない。
  fire(shell, 'toimage-range', '2');
  assert.equal(exampleText(shell), 'a_002.jpg（1 ファイル・2480×3508 px）');

  // 誤りは欄の下と出力の例に出て、実行できない。
  fire(shell, 'toimage-range', '9');
  assert.equal(SigK.toolsToImage.canRun(), false);
  assert.equal(doc.getElementById('toimage-range').classList.contains('invalid'), true);
  assert.equal(doc.getElementById('toimage-range-err').hidden, false);
  assert.match(doc.getElementById('toimage-range-err').textContent, /3ページまで/);
  assert.match(exampleText(shell), /3ページまで/);
  assert.equal(summaryText(shell), '');

  // 「すべて」へ戻せば誤りは消える。
  check(shell, 'toimage-page-mode', 'all');
  assert.equal(doc.getElementById('toimage-range-err').hidden, true);
  assert.equal(doc.getElementById('toimage-range').classList.contains('invalid'), false);
  assert.equal(SigK.toolsToImage.canRun(), true);
});

test('選んだ解像度で 40M 画素を超えるページがあれば理由を出して実行できない（確定事項9）', async (t) => {
  const A1 = { width: 1683.78, height: 2383.94 };
  const shell = await createToImageShell(t, { pdfjs: createPdfjsStub({ sizes: [A4, A1] }) });
  const { document: doc, SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  assert.equal(SigK.toolsToImage.canRun(), true);

  SigK.toolsToImage.setDpi(300);
  assert.equal(SigK.toolsToImage.canRun(), false);
  assert.match(exampleText(shell), /1 ページが 300dpi では大きすぎます/);
  assert.match(exampleText(shell), /150dpi 以下/);
  // 範囲の欄の誤りではないので、欄の下には出さない。
  assert.equal(doc.getElementById('toimage-range-err').hidden, true);

  SigK.toolsToImage.setDpi(150);
  assert.equal(SigK.toolsToImage.canRun(), true);
});

test('501 ページ以上は理由を出して実行できない（ユーザー確定①）', async (t) => {
  const shell = await createToImageShell(t, { pdfjs: createPdfjsStub({ sizes: Array.from({ length: 501 }, () => A4) }) });
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  assert.equal(SigK.toolsToImage.canRun(), false);
  assert.match(exampleText(shell), /500 ページまでです（501 ページが指定されています）/);
  SigK.toolsToImage.setPageMode('range');
  SigK.toolsToImage.setRange('1-500');
  assert.equal(SigK.toolsToImage.canRun(), true);
});

// ---- 実行（確定事項16〜24） ----

test('実行は 1 ページずつ描いて imageAPI.write へ渡し、終わると帯に「フォルダを開く」が出る', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  const documentsBefore = shell.pdfjs.documents.length;

  const result = await SigK.toolsToImage.run();

  assert.deepEqual(plain(result), { ok: true, written: 3 });
  assert.deepEqual(shell.imageWrites.map((write) => write.target), A_TARGETS);
  // 描くために文書を読み直し（確定事項22）、終わったら畳む。
  assert.equal(shell.pdfjs.documents.length, documentsBefore + 1);
  assert.equal(shell.pdfjs.documents.at(-1).destroyed, true);
  // 1 ページごとに page.cleanup()（確定事項24）。
  assert.deepEqual([...shell.pdfjs.cleanups], [1, 2, 3]);
  // viewport は 150dpi の scale で、回転は pdf.js の既定（ページ自身の /Rotate）。
  const exportCalls = shell.pdfjs.viewportCalls.filter((call) => call.scale === 150 / 72);
  assert.equal(exportCalls.length, 3);
  assert.equal(bannerText(shell), '3 ファイルに変換しました');
  const action = SigK.viewBanner.action();
  assert.equal(action.textContent, 'フォルダを開く');
  action.click();
  assert.deepEqual(shell.showInFolderCalls, [A_TARGETS[0]]);
  assert.equal(SigK.tabs.count(), 0, 'タブでは開かない');
});

test('JPEG と 300dpi は形式・品質・scale がそのまま描画に渡る', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  SigK.toolsToImage.setFormat('jpeg');
  SigK.toolsToImage.setDpi(300);
  SigK.toolsToImage.setPageMode('range');
  SigK.toolsToImage.setRange('2');

  const result = await SigK.toolsToImage.run();

  assert.equal(result.written, 1);
  assert.deepEqual(shell.imageWrites.map((write) => write.target), ['C:\\work\\a_002.jpg']);
  assert.ok(shell.pdfjs.viewportCalls.some((call) => call.page === 2 && call.scale === 300 / 72));
  assert.deepEqual([...shell.pdfjs.cleanups], [2]);
});

test('同名があれば3択を1回だけ出す。上書きは全件、中止は何もしない、別名はフォルダーを選び直す', async (t) => {
  const shell = await createToImageShell(t, {
    existingPaths: [A_TARGETS[0], A_TARGETS[2]],
    folderResults: [{ path: OUT_DIR }],
  });
  const { document: doc, SigK } = shell;
  await SigK.toolsToImage.setSource(A);

  // 上書き。
  let pending = SigK.toolsToImage.run();
  await shell.flush();
  assert.equal(SigK.confirmReplace.isOpen(), true);
  assert.equal(doc.getElementById('confirm-replace-text').textContent, '「a_001.png」など 2 件のファイルが既にあります。上書きしますか。');
  doc.getElementById('confirm-replace-ok').click();
  assert.equal((await pending).ok, true);
  assert.deepEqual(shell.imageWrites.map((write) => write.target), A_TARGETS);

  // 中止。
  pending = SigK.toolsToImage.run();
  await shell.flush();
  doc.getElementById('confirm-replace-cancel').click();
  assert.deepEqual(plain(await pending), { canceled: true });
  assert.equal(shell.imageWrites.length, 3);

  // 別名で保存はフォルダーを選び直し、そこに同名が無ければ進む。
  pending = SigK.toolsToImage.run();
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.folderCalls.length, 1);
  assert.deepEqual(shell.imageWrites.slice(3).map((write) => write.target), targetsFor(OUT_DIR, ['a_001.png', 'a_002.png', 'a_003.png']));
  assert.equal(SigK.toolsToImage.settings().folder, OUT_DIR);
});

test('中止は次のページの前で止まり、書き出し済みの枚数を帯に添える', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  const gates = gateWrites(shell);

  const running = SigK.toolsToImage.run();
  await shell.flush();
  assert.equal(gates.length, 1, '1 ページ目を書いている');
  assert.match(bannerText(shell), /画像にしています（0 \/ 3 ページ）/);
  // 帯の「中止」を押す。旗が立つだけで、いま書いている 1 枚は終わる。
  SigK.viewBanner.action().click();
  gates[0]();
  const result = await running;

  assert.deepEqual(plain(result), { canceled: true, written: 1 });
  assert.equal(gates.length, 1, '2 ページ目は描かない');
  assert.equal(bannerText(shell), '画像にするのを中止しました。1 ファイルは書き出し済みです。');
  assert.equal(shell.pdfjs.documents.at(-1).destroyed, true, '中止でも文書を畳む');
  assert.equal(SigK.save.isBusy(), false);
});

test('書き込みの失敗はファイル名と理由を添えて止め、書き終えた分は残す', async (t) => {
  const shell = await createToImageShell(t, { imageWriteResults: [{ ok: true }, { error: 'ディスクに空きがありません。' }] });
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);

  const result = await SigK.toolsToImage.run();

  assert.equal(result.error, '「a_002.png」を書き込めませんでした。ディスクに空きがありません。');
  assert.equal(result.written, 1);
  assert.equal(shell.imageWrites.length, 2, '3 ページ目には進まない');
  assert.equal(bannerText(shell), result.error);
  assert.equal(shell.pdfjs.documents.at(-1).destroyed, true, '失敗でも文書を畳む');
});

test('描けなかったページは番号を添えて止め、ログにも残す', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  // 2 ページ目の getPage で pdf.js が投げたことにする。
  const original = shell.pdfjs.getDocument;
  shell.pdfjs.getDocument = (...args) => {
    const task = original(...args);
    task.promise = task.promise.then((doc) => {
      const getPage = doc.getPage;
      doc.getPage = async (number) => {
        if (number === 2)
          throw new Error('render failed');
        return getPage(number);
      };
      return doc;
    });
    return task;
  };

  const result = await SigK.toolsToImage.run();

  assert.equal(result.error, '「a.pdf」の 2 ページ目を画像にできませんでした。');
  assert.equal(result.written, 1);
  assert.equal(bannerText(shell), result.error);
  assert.equal(shell.logs.at(-1)?.context?.source, 'to-image');
  assert.equal(shell.logs.at(-1)?.context?.page, 2);
});

test('実行中は入力と実行ボタンが押せず、進捗はページ数で出る。他の保存とは同時に走らない', async (t) => {
  const shell = await createToImageShell(t);
  const { document: doc, SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  const gates = gateWrites(shell);

  const running = SigK.toolsToImage.run();
  await shell.flush();
  assert.equal(SigK.toolsToImage.isRunning(), true);
  assert.equal(SigK.save.isBusy(), true, 'runLocal の枠に載っている（確定事項17）');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('toimage-use-open').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('toimage-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('toimage-folder-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('toimage-range').disabled, true);
  assert.equal(doc.querySelector('input[name="toimage-dpi"][value="300"]').disabled, true);
  assert.equal(SigK.toolsSplit.canRun(), false, '分割も押せない');
  assert.match((await SigK.toolsToImage.run()).error, /画像にできる状態ではありません/);

  gates[0]();
  await shell.flush();
  assert.match(bannerText(shell), /画像にしています（1 \/ 3 ページ）/);
  assert.equal(SigK.shell.setMode(doc, 'view'), true, 'モードの切り替えは許す');
  gates[1]();
  await shell.flush();
  gates[2]();
  const result = await running;

  assert.equal(result.written, 3);
  assert.equal(SigK.toolsToImage.isRunning(), false);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(doc.getElementById('toimage-range').disabled, false);
});

test('imageAPI が無ければ帯で伝えて何も書かない', async (t) => {
  const shell = await createToImageShell(t);
  const { SigK } = shell;
  await SigK.toolsToImage.setSource(A);
  shell.window.imageAPI = undefined;

  const result = await SigK.toolsToImage.run();

  assert.match(result.error, /画像を書き出す機能を使えません/);
  assert.equal(bannerText(shell), result.error);
});
