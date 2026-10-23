'use strict';

// 画像→PDF（spec-3-1 確定事項1〜9・18〜27、spec-2-5 第 H 章）。
//
// 実際に書くのはワーカーで、その中身は test/op-convert.test.js が、紙と箱の計算は test/convert-plan.test.js が見ている。
// 「変換する画像」の帯の見た目と操作は test/image-strip.test.js、変換のあとの帯と「できた PDF」のカードは test/convert-result.test.js。
// ここは「何を足し、どう並べ、何を出し、何をワーカーへ渡し、終わったら何をするか」を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const DIR = 'C:\\photo';
const A = `${DIR}\\a.png`;
const B = `${DIR}\\b.jpg`;
const C = `${DIR}\\c.png`;
const WEBP = `${DIR}\\logo.webp`;
const SCAN = `${DIR}\\scan.tif`;
const OUT = `${DIR}\\a.pdf`;
const OTHER_DIR = 'C:\\out';

// 既定の検体。横長 PNG・縦長 JPEG・小さい PNG・3ページの TIFF（spec-3-2）。
const INFOS = {
  [A]: { kind: 'png', width: 1200, height: 800 },
  [B]: { kind: 'jpeg', width: 600, height: 900 },
  [C]: { kind: 'png', width: 64, height: 64 },
  [WEBP]: { error: '対応していない形式なので、PNG・JPEG・BMP・GIF・TIFF を選んでください。' },
  [SCAN]: { kind: 'tiff', width: 1200, height: 800, frames: [{ width: 1200, height: 800 }, { width: 600, height: 900 }, { width: 64, height: 64 }] },
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
const rowNodes = (shell) => [...shell.document.querySelectorAll('#image-strip .img-item')];
const names = (shell) => plain(shell.SigK.toolsConvert.rows().map((row) => row.name));
const rows = (shell) => plain(shell.SigK.toolsConvert.rows());
const runButton = (shell) => shell.document.getElementById('convert-run');
const bannerText = (shell) => shell.document.getElementById('view-banner').textContent;
const bannerTone = (shell) => shell.document.getElementById('view-banner').getAttribute('data-tone');
const exampleText = (shell) => shell.document.getElementById('convert-example').textContent;
// 画像にカーソルを当てると出る説明の吹き出しの説明（前の一覧の列「画素数・形式・この紙」を移した。spec-2-5 確定事項H5・J5）。
const tipDescOf = (shell, index) => shell.SigK.tipContent.resolve(rowNodes(shell)[index]).desc;
const noteText = (shell) => shell.document.getElementById('image-strip-note').textContent;
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
  assert.equal(shell.document.getElementById('convert-state').hidden, false, '右の欄に状態の文');
  assert.equal(shell.document.getElementById('image-strip').hidden, true, '画像が無ければ画像の帯は出さない（H4）');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.SigK.toolsConvert.canRun(), false);
});

// 画像が無いときの右の欄の状態の文は、受け口のボタンを今の名前で指す（spec-2-5 確定事項D7。2026-10-23 改訂。ユーザーの指示）。
test('画像が無いときの右の欄の状態の文は、受け口の［ファイルを開く…］を案内する', async (t) => {
  const shell = await createConvertShell(t);
  assert.equal(shell.document.getElementById('convert-state').textContent, '画像を落とすか、下の受け口の［ファイルを開く…］で選ぶと、「変換する画像」の帯に並びます。');
  assert.equal(shell.document.getElementById('strip-drop-pick').textContent, 'ファイルを開く…', '受け口のボタンの名前');
});

test('受け口の［ファイルを開く…］は PDF と画像を選べ、画像は選んだ順に画像の帯へ、PDF は帯へ（spec-2-5 確定事項H10）', async (t) => {
  const PDF = 'C:\\work\\x.pdf';
  const shell = await createConvertShell(t, { files: { [PDF]: makeSource({ path: PDF }) }, convertSourceResults: [{ paths: [B, PDF, A] }] });
  const { SigK, document: doc } = shell;
  // 帯が 0 本のときは大きい受け口の文、帯ができたら小さい受け口の文（H10）。
  assert.equal(doc.getElementById('strip-drop-text').textContent, 'PDF か画像を落とすか［ファイルを開く…］で選ぶと、PDF は帯、画像は「変換する画像」の帯に並びます');
  assert.equal(await SigK.stripDropZone.pick(), true);
  assert.equal(doc.getElementById('strip-drop-text').textContent, 'PDF か画像をここへ落とすと足します（画像は「変換する画像」の帯へ）');

  assert.deepEqual(names(shell), ['b.jpg', 'a.png']);
  assert.deepEqual(plain(SigK.tabs.list().map((tab) => tab.path)), [PDF]);
  assert.deepEqual(rows(shell).map((row) => [row.kind, row.width, row.height]), [['jpeg', 600, 900], ['png', 1200, 800]]);
  assert.equal(rowNodes(shell).length, 2);
  assert.match(tipDescOf(shell, 0), /600×900・JPEG/);
  assert.match(tipDescOf(shell, 1), /1200×800・PNG/);
  assert.equal(doc.getElementById('convert-state').hidden, true);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

test('ドロップでも足せる。画像は画像の帯へ足し、PDF はタブ（帯）で開くだけ（決定80）', async (t) => {
  const PDF = 'C:\\work\\x.pdf';
  const shell = await createConvertShell(t, { files: { [PDF]: makeSource({ path: PDF }) } });
  const { SigK } = shell;

  const drop = (files) => SigK.fileDrop.handleDrop({
    preventDefault: () => {},
    dataTransfer: makeDataTransfer(files),
  });

  await drop([makeDroppedFile('a.png', A), makeDroppedFile('b.jpg', B)]);
  assert.deepEqual(names(shell), ['a.png', 'b.jpg']);

  // PDF は画像の帯には入れず、タブ（帯）で開くだけ。
  await drop([makeDroppedFile('x.pdf', PDF)]);
  assert.deepEqual(names(shell), ['a.png', 'b.jpg']);
  assert.deepEqual(plain(SigK.tabs.list().map((tab) => tab.path)), [PDF]);

  // PDF でも画像でもないものは断る。
  await drop([makeDroppedFile('logo.webp', WEBP)]);
  assert.equal(bannerText(shell), 'PDF でも画像でもないので、PDF か画像（PNG・JPEG・BMP・GIF・TIFF）を落としてください。');
});

test('結合の画面で画像を落とすと、画像→PDF に切り替えて画像の帯へ足す（決定80）', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  SigK.tools.select('merge');

  await SigK.fileDrop.handleDrop({
    preventDefault: () => {},
    dataTransfer: makeDataTransfer([makeDroppedFile('a.png', A)]),
  });
  assert.equal(SigK.tools.selected(), 'convert');
  assert.deepEqual(names(shell), ['a.png']);
  assert.deepEqual(plain(SigK.toolsMerge.rows()), []);
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

test('右クリックの束はファイル名の順に並び、注記は束につき 1 回。実行済みの一覧は次の束で置き換える（spec-5-1 確定事項16〜18）', async (t) => {
  const note = 'ファイル名の順に並べたので、エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。';
  const shell = await createShell({
    imageInfos: INFOS,
    files: { [OUT]: makeSource({ path: OUT }) },
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }],
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  const { SigK } = shell;

  await SigK.toolsConvert.addFromLaunch([C], { batch: { id: 1, first: true } });
  await SigK.toolsConvert.addFromLaunch([A], { batch: { id: 1, first: false } });
  assert.deepEqual(names(shell), ['a.png', 'c.png']);
  assert.equal(bannerText(shell), note);
  // 注意・お知らせは黄色の通知バーで出す（決定49）。
  assert.equal(bannerTone(shell), 'warn');
  SigK.viewBanner.show('ほかの知らせ');
  await SigK.toolsConvert.addFromLaunch([B], { batch: { id: 1, first: false } });
  assert.deepEqual(names(shell), ['a.png', 'b.jpg', 'c.png']);
  assert.equal(bannerText(shell), 'ほかの知らせ');

  assert.equal((await SigK.toolsConvert.run()).ok, true);
  await SigK.toolsConvert.addFromLaunch([B], { batch: { id: 2, first: true } });
  assert.deepEqual(names(shell), ['b.jpg'], '実行し終えた一覧は置き換える');
  assert.equal(SigK.tools.selected(), 'convert');
});

// ---- 右クリックの束の続き（spec-5-1 確定事項16〜19。test/tools-merge.test.js の同じ名前のテストに揃える） ----

const NOTE_NAME_ORDER = 'ファイル名の順に並べたので、エクスプローラーの並びと違うときは、ドラッグで入れ替えてください。';
const first = (id) => ({ batch: { id, first: true } });
const next = (id) => ({ batch: { id, first: false } });

// 変換し終えたら出力を開くので、出力の PDF も仕込んでおく。
async function createLaunchShell(t, options = {}) {
  const shell = await createShell({
    files: { [OUT]: makeSource({ path: OUT }) },
    ...options,
    imageInfos: { ...INFOS, ...(options.imageInfos ?? {}) },
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

// 「まとめる」で変換し終えた（実行済みの）一覧 a.png・b.jpg。
async function createExecutedShell(t) {
  const shell = await createLaunchShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }],
  });
  await shell.SigK.toolsConvert.addPaths([A, B]);
  assert.equal((await shell.SigK.toolsConvert.run()).ok, true);
  return shell;
}

test('アプリの中で足した行は束に入らず、束はその後ろにまとまる。注記も出さない', async (t) => {
  const shell = await createLaunchShell(t);
  const { SigK } = shell;
  SigK.shell.setMode(shell.document, 'tools');

  await SigK.toolsConvert.addPaths([C, B]);
  assert.notEqual(bannerText(shell), NOTE_NAME_ORDER);
  await SigK.toolsConvert.addFromLaunch([B], first(4));
  await SigK.toolsConvert.addFromLaunch([A], next(4));
  assert.deepEqual(names(shell), ['c.png', 'b.jpg', 'a.png', 'b.jpg'], '実行していない一覧には後ろに足す');
  assert.deepEqual(rows(shell).map((row) => row.batch), [null, null, 4, 4]);
});

test('保存ダイアログをやめた（実行し終えていない）一覧には、次の束を後ろに足す（論点3）', async (t) => {
  const shell = await createLaunchShell(t, { savePathResults: [{ canceled: true }] });
  const { SigK } = shell;

  await SigK.toolsConvert.addFromLaunch([C, B], first(1));
  assert.deepEqual(names(shell), ['b.jpg', 'c.png']);
  assert.deepEqual(plain(await SigK.toolsConvert.run()), { canceled: true });

  await SigK.toolsConvert.addFromLaunch([A], first(2));
  assert.deepEqual(names(shell), ['b.jpg', 'c.png', 'a.png'], '前の束と混ぜて並べ直さない');
  assert.deepEqual(rows(shell).map((row) => row.batch), [1, 1, 2]);
});

test('実行した後に一覧を変えれば、実行済みではなくなる', async (t) => {
  const edits = {
    外す: (SigK) => SigK.toolsConvert.remove(SigK.toolsConvert.rows()[0].id),
    並べ替える: (SigK) => SigK.toolsConvert.moveTo(SigK.toolsConvert.rows()[0].id, 2),
    足す: (SigK) => SigK.toolsConvert.addPaths([C]),
  };
  for (const [label, edit] of Object.entries(edits)) {
    const { SigK } = await createExecutedShell(t);
    await edit(SigK);
    const before = SigK.toolsConvert.rows().length;

    await SigK.toolsConvert.addFromLaunch([C], first(9));
    assert.equal(SigK.toolsConvert.rows().length, before + 1, `${label}: 置き換えずに足す`);
  }
});

test('用紙・向き・余白・出力のしかた・出力フォルダを変えても、実行済みのまま（spec-5-1 確定事項18）', async (t) => {
  const shell = await createExecutedShell(t);
  const { SigK } = shell;
  assert.equal(SigK.toolsConvert.setPaper('a3'), true);
  assert.equal(SigK.toolsConvert.setOrientation('landscape'), true);
  assert.equal(SigK.toolsConvert.setMargin('narrow'), true);
  assert.equal(SigK.toolsConvert.setOutput('each'), true);
  assert.equal(SigK.toolsConvert.setFolder(OTHER_DIR), true);

  await SigK.toolsConvert.addFromLaunch([C], first(9));
  assert.deepEqual(names(shell), ['c.png'], '設定は一覧ではないので、次の束で置き換える');
});

test('上限を超えた分は入れず、上限の通知バーは束につき 1 回', async (t) => {
  const shell = await createLaunchShell(t);
  const { SigK } = shell;
  const many = Array.from({ length: 99 }, (_, index) => `${DIR}\\m${index}.png`);
  for (const path of many)
    shell.imageInfos[path] = { kind: 'png', width: 100, height: 100 };
  SigK.shell.setMode(shell.document, 'tools');
  await SigK.toolsConvert.addPaths(many);

  await SigK.toolsConvert.addFromLaunch([A], first(1));
  assert.equal(rows(shell).length, 100);
  await SigK.toolsConvert.addFromLaunch([B], next(1));
  assert.equal(rows(shell).length, 100);
  assert.equal(bannerText(shell), '変換できるのは 100 ファイルまでです。');

  SigK.viewBanner.show('ほかの知らせ');
  await SigK.toolsConvert.addFromLaunch([C], next(1));
  assert.equal(rows(shell).length, 100);
  assert.equal(bannerText(shell), 'ほかの知らせ', '上限の通知バーは束につき 1 回');
});

test('読めない画像は名前が赤くなり、帯の下に理由が出て、実行できない（spec-2-5 確定事項H8）', async (t) => {
  const shell = await createConvertShell(t, {
    imageInfos: {
      'C:\\photo\\x.pdf': { error: 'PDF は画像ではないので、PNG・JPEG・BMP・GIF・TIFF を選んでください。' },
      'C:\\photo\\p.jpg': { error: 'この JPEG はプログレッシブ形式なので、変換できません。' },
    },
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, WEBP, 'C:\\photo\\x.pdf', 'C:\\photo\\p.jpg']);

  assert.equal(rows(shell)[1].blocked, '対応していない形式なので、PNG・JPEG・BMP・GIF・TIFF を選んでください。外してください');
  assert.equal(rows(shell)[2].blocked, 'PDF は画像ではないので、PNG・JPEG・BMP・GIF・TIFF を選んでください。外してください');
  assert.equal(rows(shell)[3].blocked, 'この JPEG はプログレッシブ形式なので、変換できません。外してください');
  assert.equal(rowNodes(shell)[1].classList.contains('bad'), true);
  assert.equal(rowNodes(shell)[0].classList.contains('bad'), false);
  assert.match(noteText(shell), /「logo\.webp」：対応していない形式なので、PNG・JPEG・BMP・GIF・TIFF を選んでください。外してください/);
  assert.equal(SigK.toolsConvert.canRun(), false);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');

  // 外せば実行できる。数え上げは右の欄の下に出る。
  assert.equal(shell.document.getElementById('convert-summary').textContent, '画像 4 枚のうち 3 枚は変換できません');
  for (const row of rows(shell).filter((entry) => entry.blocked !== null))
    SigK.toolsConvert.remove(row.id);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

test('見つからないファイルも断る', async (t) => {
  const shell = await createConvertShell(t);
  await shell.SigK.toolsConvert.addPaths(['C:\\photo\\nope.png']);
  assert.equal(rows(shell)[0].blocked, 'ファイルが見つかりません。外してください');
});

test(`上限は ${'100'} ファイルで、超えたぶんは切り捨てて通知バーで伝える`, async (t) => {
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

test('横に引いて並べ替え、画像の［×］で 1 枚、見出しの［×］ですべて外す（spec-2-5 確定事項H4・H6）', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);

  assert.equal(SigK.toolsConvert.moveTo(SigK.toolsConvert.rows()[2].id, 1), true);
  assert.deepEqual(names(shell), ['a.png', 'c.png', 'b.jpg']);

  // jsdom では rect がすべて 0 なので、x > 0 で落とすと末尾になる。
  const items = doc.getElementById('image-strip-items');
  shell.firePointer(rowNodes(shell)[0], 'pointerdown', { x: 10, y: 5 });
  shell.firePointer(doc, 'pointermove', { x: 40, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), true);
  shell.firePointer(items, 'pointerup', { x: 40, y: 5 });
  assert.deepEqual(names(shell), ['c.png', 'b.jpg', 'a.png']);

  rowNodes(shell)[1].querySelector('.img-x').click();
  assert.deepEqual(names(shell), ['c.png', 'a.png']);
  doc.getElementById('image-strip-clear').click();
  assert.deepEqual(rows(shell), []);
  assert.equal(doc.getElementById('image-strip').hidden, true);
});

// ---- 用紙と向きと余白（確定事項10〜14・21） ----

test('用紙・向き・余白を変えると、画像の説明の「この紙」と出力の例が変わる', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  // 既定は A4・自動・標準。横長は横、縦長は縦。
  const papers = () => [0, 1].map((index) => tipDescOf(shell, index).split('この紙: ')[1]);
  assert.deepEqual(papers(), ['A4 横', 'A4 縦']);

  pick(shell, 'orient', 'portrait');
  assert.equal(SigK.toolsConvert.settings().orientation, 'portrait');
  assert.deepEqual(papers(), ['A4 縦', 'A4 縦']);

  pick(shell, 'paper', 'a3');
  assert.deepEqual(papers(), ['A3 縦', 'A3 縦']);

  // 余白は紙の名前を変えないが、計画の箱は変わる（中身は convert-plan.test.js）。
  pick(shell, 'margin', 'none');
  assert.equal(SigK.toolsConvert.settings().margin, 'none');
  assert.deepEqual(plain(SigK.toolsConvert.currentPlan().pages[0][0].box), { x: 0, y: 0, width: 841.89, height: 1190.55 });

  // 出力の例は「まとめる」なので先頭画像の名前とページ数。
  assert.match(exampleText(shell), /a\.pdf（2 ページ）/);
});

test('「画像に合わせる」では向きと余白を押せなくし、紙は画素数そのものになる', async (t) => {
  const shell = await createConvertShell(t);
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, C]);

  pick(shell, 'paper', 'image');
  assert.equal(radio(shell, 'orient', 'portrait').disabled, true);
  assert.equal(radio(shell, 'margin', 'none').disabled, true);
  assert.deepEqual([0, 1].map((index) => tipDescOf(shell, index).split('この紙: ')[1]), ['1200×800 pt', '64×64 pt']);
  assert.deepEqual(plain(SigK.toolsConvert.currentPlan().pages[1]), [{
    page: { width: 64, height: 64 },
    box: { x: 0, y: 0, width: 64, height: 64 },
    allowUpscale: false,
  }]);

  // 用紙を戻せばまた押せる。値は据え置き。
  pick(shell, 'paper', 'a4');
  assert.equal(radio(shell, 'orient', 'portrait').disabled, false);
  assert.equal(radio(shell, 'margin', 'none').disabled, false);
  assert.equal(SigK.toolsConvert.settings().margin, 'normal');
});

// ---- 出力（確定事項18〜21） ----

test('「画像ごと」ではフォルダの欄が出て、既定は先頭画像の場所。変えたら追従しない', async (t) => {
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

  // 画像を足し直しても、選んだフォルダのままにする。
  await SigK.toolsConvert.addPaths([C]);
  assert.equal(SigK.toolsConvert.settings().folder, OTHER_DIR);
});

test('画像の帯の中で出力名が重なると赤く示して実行できない', async (t) => {
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
  assert.equal(rowNodes(shell)[0].classList.contains('bad'), true);
  assert.equal(rowNodes(shell)[1].classList.contains('bad'), true);
  assert.match(noteText(shell), /「a\.png」：出力名がほかの画像と重なります/);
  assert.match(exampleText(shell), /出力名が重なります/);

  SigK.toolsConvert.remove(SigK.toolsConvert.rows()[1].id);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

// ---- 実行（確定事項19・20・22〜27） ----

test('「まとめる」は保存先を聞き、1本ぶんの spec を渡して、終わったら新しい帯（タブ）で開いて選ぶ', async (t) => {
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
  assert.deepEqual(plain(spec.images[0].layouts.map((layout) => layout.page)), [{ width: 841.89, height: 595.28 }], 'A4 横');
  assert.deepEqual(plain(spec.images[1].layouts.map((layout) => layout.page)), [{ width: 595.28, height: 841.89 }], 'A4 縦');
  assert.equal(spec.images[0].layouts[0].allowUpscale, true);

  // 新しい帯（タブ）で開いて選び（ツールモードのまま。決定80・spec-2-5 確定事項H3）、知らせる。成功は失敗ではないので赤く塗らない（決定48）。
  assert.equal(SigK.tabs.list().at(-1).path, OUT);
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list().at(-1).id);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(SigK.tools.selected(), 'convert');
  assert.equal(bannerText(shell), '画像を PDF にして、「a.pdf」の帯を足しました。');
  assert.equal(bannerTone(shell), 'info');
  assert.deepEqual(names(shell), ['a.png', 'b.jpg'], '画像の帯は消さない');
});

test('「まとめる」で帯が上限なら開かずに知らせ、最近使ったファイルへ足す', async (t) => {
  const files = {};
  const paths = [];
  for (let index = 0; index < 20; index += 1) {
    const filePath = `C:\\work\\t${index}.pdf`;
    files[filePath] = makeSource({ path: filePath });
    paths.push(filePath);
  }
  const shell = await createConvertShell(t, {
    files,
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }],
  });
  const { SigK } = shell;
  for (const filePath of paths)
    await SigK.tabs.openPath(filePath);
  assert.equal(SigK.tabs.count(), 20);
  SigK.shell.setMode(shell.document, 'tools');
  SigK.tools.select('convert');

  await SigK.toolsConvert.addPaths([A, B]);
  await SigK.toolsConvert.run();
  assert.equal(SigK.tabs.count(), 20);
  assert.equal(bannerText(shell), '画像を PDF にして「a.pdf」を作りましたが、帯が 20 本を超えるので開いていません。');
  // 開かなかっただけで書けてはいるので、失敗の赤にしない（決定48）。
  assert.equal(bannerTone(shell), 'info');
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools');
  assert.equal(shell.recentList()[0].path, OUT);
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

test('「まとめる」の出力先がタブで開いていれば、何も書かずに通知バーで断る（確定事項38）', async (t) => {
  const shell = await createConvertShell(t, {
    files: { [OUT]: makeSource({ path: OUT }) },
    savePathResults: [{ path: OUT }],
  });
  const { SigK, document: doc } = shell;
  await SigK.tabs.openPath(OUT);
  SigK.shell.setMode(doc, 'tools');
  await SigK.toolsConvert.addPaths([A]);

  const result = await SigK.toolsConvert.run();
  assert.equal(result.error, '出力先のファイルはタブで開いているので、タブを閉じるか、別の名前を選んでください。');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(bannerText(shell), result.error);
  assert.equal(doc.documentElement.getAttribute('data-mode'), 'tools');
});

test('「画像ごと」の出力先がタブで開いていれば、同名の3択を出す前に断る（確定事項38）', async (t) => {
  const openOut = `${DIR}\\b.pdf`;
  const shell = await createConvertShell(t, {
    files: { [openOut]: makeSource({ path: openOut }) },
    existingPaths: [`${DIR}\\a.pdf`, openOut],
  });
  const { SigK, document: doc } = shell;
  await SigK.tabs.openPath(openOut);
  SigK.shell.setMode(doc, 'tools');
  await SigK.toolsConvert.addPaths([A, B]);
  pick(shell, 'output', 'each');

  const result = await SigK.toolsConvert.run();
  assert.equal(result.error, '出力先の「b.pdf」はタブで開いているので、タブを閉じるか、フォルダを変えてください。');
  assert.equal(doc.getElementById('confirm-replace').open, false, '置き換えてよいかは聞かない');
  assert.equal(shell.taskCalls.length, 0);
  assert.equal(bannerText(shell), result.error);
});

test('「画像ごと」は出力先を組んで渡し、終わったらできた PDF を帯で開き、［フォルダを開く］を出す', async (t) => {
  const outs = [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`];
  const shell = await createConvertShell(t, {
    files: Object.fromEntries(outs.map((filePath) => [filePath, makeSource({ path: filePath })])),
    taskResults: [{ ok: true, written: 2, targets: outs, pages: 2 }],
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

  assert.equal(bannerText(shell).includes('画像を 2 個の PDF にして、帯を足しました。'), true);
  assert.deepEqual(plain(SigK.tabs.list().map((tab) => tab.path)), outs);
  assert.equal(SigK.tabs.activeId(), SigK.tabs.list().at(-1).id, '最後にできた PDF の帯を選ぶ（H11）');
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

  // 別名で保存はフォルダを選び直し、そこに同名が無ければ進む。
  pending = SigK.toolsConvert.run();
  await shell.flush();
  doc.getElementById('confirm-replace-rename').click();
  assert.equal((await pending).ok, true);
  assert.equal(shell.folderCalls.length, 1);
  assert.deepEqual(plain(shell.taskCalls[1].spec.targets), [`${OTHER_DIR}\\a.pdf`, `${OTHER_DIR}\\b.pdf`]);
});

test('中止と失敗は通知バーで伝え、画像ごとの中止では書き出し済みの本数を添える', async (t) => {
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
  // 自分で止めたので、失敗の赤ではなく青で出す（決定49）。
  assert.equal(bannerTone(shell), 'info');

  // 画像ごとの中止は、書き終えた本数を進捗（write の done）から取る。
  pick(shell, 'output', 'each');
  const running = SigK.toolsConvert.run();
  await shell.flush();
  shell.fireProgress({ taskId: shell.taskCalls[1].taskId, phase: 'write', label: 'x', step: 5, total: 5, done: 1, of: 2 });
  release({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(bannerText(shell), '変換を中止しましたが、1 ファイルは書き出し済みです。');
  assert.equal(bannerTone(shell), 'info');

  const failed = await SigK.toolsConvert.run();
  assert.match(failed.error, /a\.png/);
  assert.equal(bannerText(shell), failed.error);
});

test('保存ダイアログを開いている間も実行中と数え、やめれば下ろす（spec-5-1 確定事項12）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await createConvertShell(t, { savePathResults: [dialog] });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  const running = SigK.toolsConvert.run();
  await shell.flush();
  assert.equal(SigK.toolsConvert.isRunning(), true);
  assert.equal(SigK.toolsConvert.canRun(), false);

  answer({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(SigK.toolsConvert.isRunning(), false);
  assert.equal(SigK.toolsConvert.canRun(), true);
});

test('実行中は画像の帯と設定と実行ボタンが押せず、進捗はファイル数で出る', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const shell = await createConvertShell(t, { savePathResults: [{ path: OUT }], taskResults: [gate] });
  const { SigK, document: doc } = shell;
  await SigK.toolsConvert.addPaths([A, B]);

  const running = SigK.toolsConvert.run();
  await shell.flush();
  assert.equal(SigK.toolsConvert.isRunning(), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(radio(shell, 'paper', 'a3').disabled, true);
  assert.equal(radio(shell, 'output', 'each').disabled, true);
  // 実行中は画像を外せず、引いても並べ替えさせない。
  rowNodes(shell)[0].querySelector('.img-x').click();
  doc.getElementById('image-strip-clear').click();
  assert.equal(rows(shell).length, 2);
  // 実行中は画像を足せない（受け口の［ファイルを開く…］・ドロップから。点検で見つかった。前の画面では［ファイルを選ぶ…］を押せなくしていた）。
  assert.deepEqual(plain(await SigK.toolsConvert.addPaths([C])), []);
  assert.equal(rows(shell).length, 2);
  shell.firePointer(rowNodes(shell)[0], 'pointerdown', { x: 10, y: 5 });
  shell.firePointer(doc, 'pointermove', { x: 40, y: 5 });
  assert.equal(SigK.imageStripDrag.isDragging(), false);

  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'apply', label: 'x', step: 3, total: 5, done: 1, of: 2 });
  assert.match(bannerText(shell), /変換しています（1 \/ 2 ファイル）/);
  // ワーカーが unit を添えればその単位で出る（変換の apply はページ単位。spec-3-2 確定事項21）。
  shell.fireProgress({ taskId: shell.taskCalls[0].taskId, phase: 'apply', label: 'x', step: 3, total: 5, done: 3, of: 12, unit: 'ページ' });
  assert.match(bannerText(shell), /変換しています（3 \/ 12 ページ）/);
  assert.equal(SigK.shell.setMode(doc, 'view'), true, 'モードの切り替えは許す');

  release({ ok: true, path: OUT, pages: 2, inputs: 2 });
  await running;
  assert.equal(SigK.toolsConvert.isRunning(), false);
  assert.equal(radio(shell, 'paper', 'a3').disabled, false);
});

// ---- BMP・GIF・TIFF と複数ページ（spec-3-2 確定事項29〜31） ----

test('TIFF の画像には「N ページ」の札と説明が付き、出力の例と spec はページ数ぶんになる', async (t) => {
  const shell = await createConvertShell(t, {
    files: { [OUT]: makeSource({ path: OUT }) }, savePathResults: [{ path: OUT }], taskResults: [{ ok: true, path: OUT, pages: 4, inputs: 2 }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([SCAN, A]);
  assert.equal(rowNodes(shell)[0].querySelector('.img-pages').textContent, '3 ページ');
  assert.equal(rowNodes(shell)[1].querySelector('.img-pages'), null, '1ページなら札を出さない');
  assert.match(tipDescOf(shell, 0), /1200×800・TIFF・3 ページ\nこの紙: A4 横/, '「この紙」は先頭ページ');
  assert.match(tipDescOf(shell, 1), /1200×800・PNG\n/);
  assert.match(exampleText(shell), /scan\.pdf（4 ページ）/);
  assert.equal(plain(SigK.toolsConvert.currentPlan().totalPages), 4);

  const result = await SigK.toolsConvert.run();
  assert.equal(result.ok, true);
  const { spec } = shell.taskCalls[0];
  assert.deepEqual(plain(spec.images[0].layouts.map((layout) => layout.page)), [
    { width: 841.89, height: 595.28 }, { width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 },
  ], 'ページごとに向き「自動」');
  assert.equal(spec.images[1].layouts.length, 1);
  assert.equal(bannerText(shell), '画像を PDF にして、「a.pdf」の帯を足しました。');
});

test('合計ページ数が 100 を超えると出力の例に文言が出て実行できない', async (t) => {
  const long = `${DIR}\long.tif`;
  const shell = await createConvertShell(t, {
    imageInfos: { [long]: { kind: 'tiff', width: 100, height: 100, frames: Array.from({ length: 100 }, () => ({ width: 100, height: 100 })) } },
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([long]);
  assert.equal(SigK.toolsConvert.canRun(), true, 'ちょうど 100 ページは通る');
  await SigK.toolsConvert.addPaths([A]);
  assert.equal(SigK.toolsConvert.canRun(), false);
  assert.equal(exampleText(shell), '100 ページまでです');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});
