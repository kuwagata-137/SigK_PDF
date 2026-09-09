'use strict';

// 画像→PDF の画面（spec-3-1 確定事項1〜9・18〜27・33）。
//
// 実際に書くのはワーカーで、その中身は test/op-convert.test.js が、紙と箱の計算は
// test/convert-plan.test.js が見ている。ここは「何を足し、どう並べ、何を出し、
// 何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const DIR = 'C:\\photo';
const A = `${DIR}\\a.png`;
const B = `${DIR}\\b.jpg`;
const C = `${DIR}\\c.png`;
const GIF = `${DIR}\\logo.gif`;
const OUT = `${DIR}\\a.pdf`;
const OTHER_DIR = 'C:\\out';

// 既定の検体。横長 PNG・縦長 JPEG・小さい PNG。
const INFOS = {
  [A]: { kind: 'png', width: 1200, height: 800 },
  [B]: { kind: 'jpeg', width: 600, height: 900 },
  [C]: { kind: 'png', width: 64, height: 64 },
  [GIF]: { error: 'GIF はまだ変換できません。PNG・JPEG を選んでください。' },
};

async function createConvertShell(t, options = {}) {
  const shell = await createShell({ ...options, imageInfos: { ...INFOS, ...(options.imageInfos ?? {}) } });
  t.after(() => shell.cleanup());
  // 前回の見た目の復元（restoreUi）は IPC の往復のあとに届く。先に切り替えると
  // 復元で閲覧へ戻されるので、届くのを待ってからツールモードへ入る。
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');
  return shell;
}

// jsdom の realm で作られた配列は Node の Array と参照が違うので、比べる前に写す。
const plain = (value) => structuredClone(value);
const rowNodes = (shell) => [...shell.document.querySelectorAll('#convert-list .convert-row')];
const names = (shell) => plain(shell.SigK.toolsConvert.rows().map((row) => row.name));
const rows = (shell) => plain(shell.SigK.toolsConvert.rows());
const runButton = (shell) => shell.document.getElementById('convert-run');
const bannerText = (shell) => shell.document.getElementById('view-banner').textContent;
const exampleText = (shell) => shell.document.getElementById('convert-example').textContent;
const cell = (shell, index, selector) => rowNodes(shell)[index].querySelector(selector).textContent;
const radio = (shell, name, value) => shell.document.querySelector(`input[name="convert-${name}"][value="${value}"]`);

function pick(shell, name, value) {
  const node = radio(shell, name, value);
  node.checked = true;
  node.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

// ---- 足す（確定事項1・2・4〜7） ----

test('初期状態は空で、実行は押せない', async (t) => {
  const shell = await createConvertShell(t);
  assert.deepEqual(rows(shell), []);
  assert.equal(shell.document.getElementById('convert-empty').hidden, false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.SigK.toolsConvert.canRun(), false);
});

test('「ファイルを選ぶ…」は複数選択で、選んだ順に足し、画素数と形式を読む', async (t) => {
  const shell = await createConvertShell(t, { imageSourceResults: [{ paths: [B, A] }] });
  await shell.SigK.toolsConvert.pickFiles();

  assert.deepEqual(names(shell), ['b.jpg', 'a.png']);
  assert.deepEqual(rows(shell).map((row) => [row.kind, row.width, row.height]), [['jpeg', 600, 900], ['png', 1200, 800]]);
  assert.equal(rowNodes(shell).length, 2);
  assert.equal(cell(shell, 0, '.px'), '600×900');
  assert.equal(cell(shell, 0, '.kind'), 'JPEG');
  assert.equal(cell(shell, 1, '.px'), '1200×800');
  assert.equal(cell(shell, 1, '.kind'), 'PNG');
  assert.equal(shell.document.getElementById('convert-empty').hidden, true);
  assert.equal(shell.SigK.toolsConvert.canRun(), true);
});

test('ドロップでも足せる。変換画面では画像を受け、PDF は断る', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;

  const drop = (files) => SigK.fileDrop.handleDrop({
    preventDefault: () => {},
    dataTransfer: makeDataTransfer(files),
  });

  await drop([makeDroppedFile('a.png', A), makeDroppedFile('b.jpg', B)]);
  assert.deepEqual(names(shell), ['a.png', 'b.jpg']);

  // PDF は変換画面では受けない。
  await drop([makeDroppedFile('x.pdf', 'C:\\work\\x.pdf')]);
  assert.deepEqual(names(shell), ['a.png', 'b.jpg']);
  assert.equal(bannerText(shell), '画像ファイルではありません。PNG・JPEG を落としてください。');
});

test('結合の画面では従来どおり PDF だけを受け、画像は断る', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  SigK.tools.select('merge');

  await SigK.fileDrop.handleDrop({
    preventDefault: () => {},
    dataTransfer: makeDataTransfer([makeDroppedFile('a.png', A)]),
  });
  assert.deepEqual(rows(shell), []);
  assert.deepEqual(plain(SigK.toolsMerge.rows()), []);
  assert.equal(bannerText(shell), 'PDF ファイルではありません。PDF を落としてください。');
});

test('addFromLaunch はツールモードへ切り替えて変換を選び、末尾へ足す', async (t) => {
  const shell = await createShell({ imageInfos: INFOS });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK, document: doc } = shell;
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');

  await SigK.toolsConvert.addFromLaunch([A, B]);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'convert');
  assert.deepEqual(names(shell), ['a.png', 'b.jpg']);
});

test('読めない画像は行に印と文言が付き、実行できない', async (t) => {
  const shell = await createConvertShell(t, {
    imageInfos: {
      'C:\\photo\\x.pdf': { error: 'PDF は画像ではありません。PNG・JPEG を選んでください。' },
      'C:\\photo\\p.jpg': { error: 'この JPEG は変換できません（プログレッシブ形式）。' },
    },
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, GIF, 'C:\\photo\\x.pdf', 'C:\\photo\\p.jpg']);

  assert.equal(rows(shell)[1].blocked, 'GIF はまだ変換できません。PNG・JPEG を選んでください。外してください');
  assert.equal(rows(shell)[2].blocked, 'PDF は画像ではありません。PNG・JPEG を選んでください。外してください');
  assert.equal(rows(shell)[3].blocked, 'この JPEG は変換できません（プログレッシブ形式）。外してください');
  assert.equal(rowNodes(shell)[1].classList.contains('blocked'), true);
  assert.equal(cell(shell, 1, '.px'), '–');
  assert.equal(SigK.toolsConvert.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');

  // 外せば実行できる。数え上げは足元の帯に出る。
  assert.match(shell.document.getElementById('convert-summary').textContent, /4 ファイル ・ 3 件は変換できません/);
  for (const row of rows(shell).filter((entry) => entry.blocked !== null))
    SigK.toolsConvert.remove(row.id);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

test('見つからないファイルも断る', async (t) => {
  const shell = await createConvertShell(t);
  await shell.SigK.toolsConvert.addPaths(['C:\\photo\\nope.png']);
  assert.equal(rows(shell)[0].blocked, 'ファイルが見つかりません。外してください');
});

test(`上限は ${'100'} ファイルで、超えたぶんは切り捨てて帯で伝える`, async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  const many = Array.from({ length: 101 }, (_, index) => `${DIR}\\m${index}.png`);
  for (const path of many)
    shell.imageInfos[path] = { kind: 'png', width: 100, height: 100 };

  await SigK.toolsConvert.addPaths(many);
  assert.equal(rows(shell).length, 100);
  assert.equal(bannerText(shell), '変換できるのは 100 ファイルまでです。');

  // いっぱいのときは1つも足さない。
  assert.deepEqual(plain(await SigK.toolsConvert.addPaths([A])), []);
  assert.equal(rows(shell).length, 100);
});

test('同じ画像を2回足すことは止めない', async (t) => {
  const shell = await createConvertShell(t);
  await shell.SigK.toolsConvert.addPaths([A, A]);
  assert.deepEqual(names(shell), ['a.png', 'a.png']);
});

// ---- 並べ替える・外す（確定事項8） ----

test('上へ・下へ・ドラッグで並べ替え、外す・すべて外すで減る', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);

  SigK.toolsConvert.move(SigK.toolsConvert.rows()[2].id, -1);
  assert.deepEqual(names(shell), ['a.png', 'c.png', 'b.jpg']);
  SigK.toolsConvert.move(SigK.toolsConvert.rows()[0].id, 1);
  assert.deepEqual(names(shell), ['c.png', 'a.png', 'b.jpg']);

  // jsdom では rect がすべて 0 なので、y > 0 で落とすと末尾になる。
  const list = doc.getElementById('convert-list');
  shell.firePointer(rowNodes(shell)[0].querySelector('.grip'), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(SigK.toolsConvertList.isDragging(), true);
  shell.firePointer(list, 'pointerup', { x: 5, y: 40 });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png']);

  SigK.toolsConvert.remove(SigK.toolsConvert.rows()[1].id);
  assert.deepEqual(names(shell), ['a.png', 'c.png']);
  doc.getElementById('convert-clear').click();
  assert.deepEqual(rows(shell), []);
});

// ---- 用紙と向きと余白（確定事項10〜14・21） ----

test('用紙・向き・余白を変えると各行の「この紙」と出力の例が変わる', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  // 既定は A4・自動・標準。横長は横、縦長は縦。
  assert.deepEqual([cell(shell, 0, '.paper'), cell(shell, 1, '.paper')], ['A4 横', 'A4 縦']);

  pick(shell, 'orient', 'portrait');
  assert.equal(SigK.toolsConvert.settings().orientation, 'portrait');
  assert.deepEqual([cell(shell, 0, '.paper'), cell(shell, 1, '.paper')], ['A4 縦', 'A4 縦']);

  pick(shell, 'paper', 'a3');
  assert.deepEqual([cell(shell, 0, '.paper'), cell(shell, 1, '.paper')], ['A3 縦', 'A3 縦']);

  // 余白は紙の名前を変えないが、計画の箱は変わる（中身は convert-plan.test.js）。
  pick(shell, 'margin', 'none');
  assert.equal(SigK.toolsConvert.settings().margin, 'none');
  assert.deepEqual(plain(SigK.toolsConvert.currentPlan().pages[0].box), { x: 0, y: 0, width: 841.89, height: 1190.55 });

  // 出力の例は「まとめる」なので先頭画像の名前とページ数。
  assert.match(exampleText(shell), /a\.pdf（2 ページ）/);
});

test('「画像サイズに合わせる」では向きと余白を押せなくし、紙は画素数そのものになる', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, C]);

  pick(shell, 'paper', 'image');
  assert.equal(radio(shell, 'orient', 'portrait').disabled, true);
  assert.equal(radio(shell, 'margin', 'none').disabled, true);
  assert.deepEqual([cell(shell, 0, '.paper'), cell(shell, 1, '.paper')], ['1200×800 pt', '64×64 pt']);
  assert.deepEqual(plain(SigK.toolsConvert.currentPlan().pages[1]), {
    page: { width: 64, height: 64 },
    box: { x: 0, y: 0, width: 64, height: 64 },
    allowUpscale: false,
  });

  // 用紙を戻せばまた押せる。値は据え置き。
  pick(shell, 'paper', 'a4');
  assert.equal(radio(shell, 'orient', 'portrait').disabled, false);
  assert.equal(radio(shell, 'margin', 'none').disabled, false);
  assert.equal(SigK.toolsConvert.settings().margin, 'normal');
});

// ---- 出力（確定事項18〜21） ----

test('「画像ごと」ではフォルダーの欄が出て、既定は先頭画像の場所。変えたら追従しない', async (t) => {
  const shell = await createConvertShell(t, { folderResults: [{ path: OTHER_DIR }] });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  assert.equal(doc.getElementById('convert-folder-row').hidden, true, 'まとめるときは出さない');
  pick(shell, 'output', 'each');
  assert.equal(doc.getElementById('convert-folder-row').hidden, false);
  assert.equal(doc.getElementById('convert-folder').textContent, DIR);
  assert.match(exampleText(shell), /a\.pdf … b\.pdf（2 ファイル）/);

  assert.equal(await SigK.toolsConvert.pickFolder(), true);
  assert.equal(SigK.toolsConvert.settings().folder, OTHER_DIR);
  assert.deepEqual(plain(SigK.toolsConvert.currentPlan().targets), [`${OTHER_DIR}\\a.pdf`, `${OTHER_DIR}\\b.pdf`]);

  // 画像を足し直しても、選んだフォルダーのままにする。
  await SigK.toolsConvert.addPaths([C]);
  assert.equal(SigK.toolsConvert.settings().folder, OTHER_DIR);
});

test('一覧の中で出力名が重なると赤く示して実行できない', async (t) => {
  const shell = await createConvertShell(t, {
    imageInfos: { 'C:\\photo\\sub\\a.png': { kind: 'png', width: 100, height: 100 } },
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, 'C:\\photo\\sub\\a.png']);

  // まとめるなら1本になるので衝突しない。
  assert.equal(SigK.toolsConvert.canRun(), true);

  pick(shell, 'output', 'each');
  assert.equal(SigK.toolsConvert.canRun(), false);
  assert.equal(SigK.toolsConvert.currentPlan().error, '出力名が重なります: a.pdf');
  assert.equal(rowNodes(shell)[0].classList.contains('dup'), true);
  assert.equal(rowNodes(shell)[1].classList.contains('dup'), true);
  assert.match(exampleText(shell), /出力名が重なります/);

  SigK.toolsConvert.remove(SigK.toolsConvert.rows()[1].id);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

// ---- 実行（確定事項19・20・22〜27） ----

test('「まとめる」は保存先を聞き、1本ぶんの spec を渡して、終わったらタブで開く', async (t) => {
  const shell = await createConvertShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }],
    files: { [OUT]: makeSource({ path: OUT, name: 'a.pdf' }) },
  });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  const result = await SigK.toolsConvert.run();
  assert.equal(result.ok, true);

  // 保存ダイアログの既定名は先頭画像の場所と名前（確定事項19）。
  assert.deepEqual(plain(shell.savePathCalls[0]), { defaultPath: OUT, title: '変換した PDF を保存' });

  const { spec } = shell.taskCalls[0];
  assert.equal(spec.kind, 'convert');
  assert.equal(spec.output, 'single');
  assert.equal(spec.target, OUT);
  assert.deepEqual(plain(spec.targets), [OUT]);
  assert.deepEqual(plain(spec.images.map((image) => image.path)), [A, B]);
  assert.deepEqual(plain(spec.images[0].layout.page), { width: 841.89, height: 595.28 }, 'A4 横');
  assert.deepEqual(plain(spec.images[1].layout.page), { width: 595.28, height: 841.89 }, 'A4 縦');
  assert.equal(spec.images[0].layout.allowUpscale, true);

  // 開いたタブへ移り、帯で知らせる。
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'view');
  assert.equal(bannerText(shell), '2 ファイルを変換しました（2 ページ）');
});

test('「まとめる」で保存先を取り消せば何も起きない', async (t) => {
  const shell = await createConvertShell(t, { savePathResults: [{ canceled: true }] });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A]);
  assert.deepEqual(plain(await SigK.toolsConvert.run()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
});

test('出力先に入力の画像と同じファイルは選べない', async (t) => {
  const shell = await createConvertShell(t, { savePathResults: [{ path: A }] });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A]);
  const result = await SigK.toolsConvert.run();
  assert.match(result.error, /入力ファイルと同じ/);
  assert.equal(shell.taskCalls.length, 0);
});

test('「画像ごと」は出力先を組んで渡し、終わったら帯に「フォルダを開く」を出す', async (t) => {
  const shell = await createConvertShell(t, {
    taskResults: [{ ok: true, written: 2, targets: [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`], pages: 2 }],
  });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  pick(shell, 'output', 'each');

  const result = await SigK.toolsConvert.run();
  assert.equal(result.ok, true);
  assert.equal(shell.savePathCalls.length, 0, '保存ダイアログは出さない');

  const { spec } = shell.taskCalls[0];
  assert.equal(spec.output, 'each');
  assert.equal(spec.target, undefined);
  assert.deepEqual(plain(spec.targets), [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`]);
  assert.deepEqual(plain(spec.images.map((image) => image.target)), [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`]);

  assert.equal(bannerText(shell).includes('2 ファイルに変換しました'), true);
  const action = doc.querySelector('#view-banner .banner-action');
  assert.equal(action.textContent, 'フォルダを開く');
  action.click();
  assert.deepEqual(plain(shell.showInFolderCalls), [`${DIR}\\a.pdf`]);
});

test('「画像ごと」で同名があれば3択を1回だけ出す', async (t) => {
  const shell = await createConvertShell(t, {
    existingPaths: [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`],
    folderResults: [{ path: OTHER_DIR }],
    taskResults: [{ ok: true, written: 2, targets: [], pages: 2 }, { ok: true, written: 2, targets: [], pages: 2 }],
  });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  pick(shell, 'output', 'each');

  // 上書きを選べば、そのまま進む。3択は1回だけである。
  let pending = SigK.toolsConvert.run();
  await shell.flush();
  assert.equal(doc.getElementById('confirm-replace').open, true);
  doc.getElementById('confirm-replace-ok').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.taskCalls.length, 1);

  // 取り消せば走らせない。
  pending = SigK.toolsConvert.run();
  await shell.flush();
  doc.getElementById('confirm-replace-cancel').click();
  assert.deepEqual(plain(await pending), { canceled: true });
  assert.equal(shell.taskCalls.length, 1);

  // 別名で保存はフォルダーを選び直し、そこに同名が無ければ進む。
  pending = SigK.toolsConvert.run();
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.folderCalls.length, 1);
  assert.deepEqual(plain(shell.taskCalls[1].spec.targets), [`${OTHER_DIR}\\a.pdf`, `${OTHER_DIR}\\b.pdf`]);
});

test('中止と失敗は帯で伝え、画像ごとの中止では書き出し済みの本数を添える', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createConvertShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ canceled: true }, gate, { error: '「a.png」画像を読み込めませんでした。' }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  // まとめるの中止は本数を添えない（書きかけの一時ファイルだけが消える）。
  assert.deepEqual(plain(await SigK.toolsConvert.run()), { canceled: true });
  assert.equal(bannerText(shell), '変換を中止しました。');

  // 画像ごとの中止は、書き終えた本数を進捗（write の done）から取る。
  pick(shell, 'output', 'each');
  const running = SigK.toolsConvert.run();
  await shell.flush();
  shell.fireProgress({ taskId: shell.taskCalls[1].taskId, phase: 'write', label: 'x', step: 5, total: 5, done: 1, of: 2 });
  release({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(bannerText(shell), '変換を中止しました。1 ファイルは書き出し済みです。');

  const failed = await SigK.toolsConvert.run();
  assert.match(failed.error, /a\.png/);
  assert.equal(bannerText(shell), failed.error);
});

test('実行中は一覧と設定と実行ボタンが押せず、進捗はファイル数で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createConvertShell(t, { savePathResults: [{ path: OUT }], taskResults: [gate] });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  const running = SigK.toolsConvert.run();
  await shell.flush();
  assert.equal(SigK.toolsConvert.isRunning(), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('convert-pick').getAttribute('aria-disabled'), 'true');
  assert.equal(doc.getElementById('convert-clear').getAttribute('aria-disabled'), 'true');
  assert.equal(radio(shell, 'paper', 'a3').disabled, true);
  assert.equal(radio(shell, 'output', 'each').disabled, true);
  assert.equal(rowNodes(shell)[0].querySelector('.rbtn').getAttribute('aria-disabled'), 'true');

  // 実行中はドラッグでも並べ替えさせない。
  shell.firePointer(rowNodes(shell)[0].querySelector('.grip'), 'pointerdown', { x: 5, y: 10 });
  shell.firePointer(doc, 'pointermove', { x: 5, y: 40 });
  assert.equal(SigK.toolsConvertList.isDragging(), false);

  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'apply', label: 'x', step: 3, total: 5, done: 1, of: 2 });
  assert.match(bannerText(shell), /変換しています（1 \/ 2 ファイル）/);
  assert.equal(SigK.shell.setMode(doc, 'view'), true, 'モードの切り替えは許す');

  release({ ok: true, path: OUT, pages: 2, inputs: 2 });
  await running;
  assert.equal(SigK.toolsConvert.isRunning(), false);
  assert.equal(radio(shell, 'paper', 'a3').disabled, false);
});
