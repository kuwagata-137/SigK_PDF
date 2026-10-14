'use strict';

// 透かし（spec-4-5 確定事項2〜6・11・35〜44、spec-2-5 確定事項E3。見本 screenshots/strips2-watermark.png）。対象は選んでいる帯。
//
// 実際に書くのはワーカーで、その中身は test/op-watermark.test.js が見ている。ここは「画像をどう決め、設定をどう欄に写し、
// 何をワーカーへ渡し、終わったら何をするか」と、帯のページへの重ねを見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, createPdfjsStub, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const OUT = 'C:\\out\\a_透かし.pdf';
const LOGO = 'C:\\work\\logo.png';
const BMP = 'C:\\work\\photo.bmp';

async function createWatermarkShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }), [OUT]: makeSource({ path: OUT }) },
    watermarkImages: {
      [LOGO]: { kind: 'png', width: 400, height: 200 },
      [BMP]: { error: 'PNG か JPEG の画像を選んでください。', kind: 'bmp' },
    },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('watermark');
  return shell;
}

const plain = (value) => structuredClone(value);
const byId = (shell, id) => shell.document.getElementById(id);
const runButton = (shell) => byId(shell, 'wm-run');
const bannerText = (shell) => shell.SigK.viewBanner.text();
const summary = (shell) => byId(shell, 'wm-summary').textContent;
const checkedValue = (shell, name) => shell.document.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

// 帯（＝タブ）を開いて選ぶ。開いたタブが選んでいる帯になり、それが対象になる。
async function withSource(shell, path = A) {
  await shell.SigK.tabs.openPath(path);
  await shell.flush();
}

test('一覧に「透かし」が並び、選ぶと既定値の画面が出る（「社外秘」・中・灰・30%・斜め・中央・すべて）', async (t) => {
  const shell = await createWatermarkShell(t);
  const item = shell.document.querySelector('#tools-list .tool-item[data-tool="watermark"]');
  assert.ok(item !== null);
  assert.match(item.textContent, /透かし文字や画像を重ねる/);
  assert.equal(shell.SigK.tools.panelFor('watermark').hidden, false);
  assert.equal(byId(shell, 'wm-text').value, '社外秘');
  assert.equal(checkedValue(shell, 'wm-type'), 'text');
  assert.equal(checkedValue(shell, 'wm-size'), 'medium');
  assert.equal(checkedValue(shell, 'wm-opacity'), '0.3');
  assert.equal(checkedValue(shell, 'wm-angle'), '45');
  assert.equal(checkedValue(shell, 'wm-page-mode'), 'all');
  assert.deepEqual([...byId(shell, 'wm-colors').children].map((node) => [node.dataset.color, node.classList.contains('on')]),
    [['#808080', true], ['#d92c2c', false], ['#2c5cd9', false], ['#1c2430', false]]);
  assert.deepEqual([...byId(shell, 'wm-opacities').querySelectorAll('.lbl')].map((node) => node.textContent), ['15%', '30%', '50%', '100%']);
  const cells = [...byId(shell, 'wm-grid').children];
  assert.equal(cells.length, 9);
  assert.deepEqual(cells.filter((cell) => cell.classList.contains('on')).map((cell) => cell.getAttribute('aria-label')), ['中央']);
  assert.equal(byId(shell, 'wm-position-label').textContent, '中央');
  assert.equal(byId(shell, 'wm-image-row').hidden, true);
  assert.equal(byId(shell, 'wm-colors').hidden, false);
  assert.equal(byId(shell, 'wm-state').textContent, 'PDF を開くと、選んでいる帯が対象になります。');
  assert.equal(summary(shell), '', '対象が無いときは状態の文が出る');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
  assert.equal(shell.SigK.tools.panelFor('watermark').parentElement.id, 'tool-pane');
});

test('選んでいる帯が対象になり、要約（「a.pdf の 3 ページ」）と実行が出る。ファイルを開き直さない', async (t) => {
  const shell = await createWatermarkShell(t);
  await withSource(shell);
  assert.equal(shell.SigK.toolsWatermark.source().pageCount, 3);
  assert.equal(byId(shell, 'wm-state').hidden, true);
  assert.equal(summary(shell), 'a.pdf の 3 ページ');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), null);
  assert.equal(byId(shell, 'wm-use-open'), null, '［開いているタブから選ぶ］は無い（spec-2-5 確定事項E6）');
});

test('開けなかった帯・パスワード付きの帯は、状態の文を出して実行できない', async (t) => {
  const failed = await createWatermarkShell(t, { pdfjs: createPdfjsStub({ openError: new Error('broken') }) });
  await withSource(failed);
  assert.equal(byId(failed, 'wm-state').textContent, '「a.pdf」は開けなかったので、ほかの帯を選んでください。');
  assert.equal(failed.SigK.toolsWatermark.canRun(), false);
  assert.equal(summary(failed), '');

  const locked = await createWatermarkShell(t);
  await withSource(locked);
  const peek = locked.SigK.tabs.peek;
  locked.window.SigK.tabs.peek = (id) => ({ ...peek(id), file: { ...peek(id).file, encrypted: true } });
  locked.SigK.toolsWatermarkView.render();
  assert.equal(locked.SigK.toolsWatermark.source().blocked, '「a.pdf」はパスワード付きなので透かしを入れられません。ほかの帯を選んでください。');
  assert.equal(locked.SigK.toolsWatermark.canRun(), false);
});

test('欄の操作が設定に届き、ワーカーへ渡す spec に写る', async (t) => {
  const shell = await createWatermarkShell(t);
  await withSource(shell);
  const { document: doc, window, SigK } = shell;
  const text = byId(shell, 'wm-text');
  text.value = '  複製禁止 ';
  text.dispatchEvent(new window.Event('input', { bubbles: true }));
  byId(shell, 'wm-colors').children[1].click();
  byId(shell, 'wm-grid').children[2].click();
  const pick = (name, value) => {
    const input = doc.querySelector(`input[name="${name}"][value="${value}"]`);
    input.checked = true;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  pick('wm-size', 'large');
  pick('wm-opacity', '0.5');
  pick('wm-angle', '0');
  assert.deepEqual(plain(SigK.toolsWatermark.currentPlan().spec.mark), {
    type: 'text', text: '複製禁止', color: '#d92c2c', opacity: 0.5, angle: 0, size: 'large', position: 'top-right',
  });
  assert.equal(byId(shell, 'wm-position-label').textContent, '右上');
  assert.equal(byId(shell, 'wm-colors').children[1].classList.contains('on'), true);
  assert.equal(byId(shell, 'wm-grid').children[2].getAttribute('aria-pressed'), 'true');
});

test('範囲は集合にして要約に出し、誤りは欄の下に出して実行させない', async (t) => {
  const shell = await createWatermarkShell(t);
  await withSource(shell);
  const range = byId(shell, 'wm-range');
  range.dispatchEvent(new shell.window.Event('focus'));
  assert.equal(checkedValue(shell, 'wm-page-mode'), 'range');
  range.value = '3, 2, 3';
  range.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.equal(summary(shell), 'a.pdf の 2 ページ');
  assert.deepEqual(plain(shell.SigK.toolsWatermark.currentPlan().pages), [1, 2]);
  range.value = '9';
  range.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  assert.equal(byId(shell, 'wm-range-err').hidden, false);
  assert.equal(range.classList.contains('invalid'), true);
  assert.equal(summary(shell), '');
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('種類を「画像」にすると画像の欄が出て色が消え、画像を選ぶまで実行できない', async (t) => {
  const shell = await createWatermarkShell(t, { watermarkImageResults: [{ path: LOGO }] });
  await withSource(shell);
  shell.SigK.toolsWatermark.setType('image');
  assert.equal(byId(shell, 'wm-image-row').hidden, false);
  assert.equal(byId(shell, 'wm-colors').hidden, true);
  assert.equal(byId(shell, 'wm-text-row').hidden, true);
  assert.match(byId(shell, 'wm-image-note').textContent, /PNG か JPEG の画像を選んでください/);
  assert.equal(summary(shell), '透かしにする画像を選んでください。');
  byId(shell, 'wm-image-pick').click();
  await shell.flush();
  await shell.flush();
  assert.deepEqual(plain(shell.watermarkImageCalls), [{ defaultPath: undefined }]);
  assert.equal(byId(shell, 'wm-image-name').textContent, 'logo.png');
  assert.equal(byId(shell, 'wm-image-meta').textContent, '400 × 200 px');
  assert.equal(byId(shell, 'wm-image-note').hidden, true);
  assert.equal(summary(shell), 'a.pdf の 3 ページ');
  assert.deepEqual(plain(shell.SigK.toolsWatermark.currentPlan().spec.mark),
    { type: 'image', image: LOGO, opacity: 0.3, angle: 45, size: 'medium', position: 'center' });
});

test('PNG・JPEG 以外の画像は断り、理由を画像の欄に出す', async (t) => {
  const shell = await createWatermarkShell(t);
  await withSource(shell);
  assert.equal(await shell.SigK.toolsWatermark.setImage(BMP), false);
  await shell.flush();
  assert.equal(checkedValue(shell, 'wm-type'), 'image');
  assert.equal(byId(shell, 'wm-image-note').textContent, 'PNG か JPEG の画像を選んでください。');
  assert.equal(byId(shell, 'wm-image-note').classList.contains('error'), true);
  assert.equal(runButton(shell).getAttribute('aria-disabled'), 'true');
});

test('実行は保存ダイアログで出力先を決め、spec をワーカーへ渡し、書けたら新しいタブで開く', async (t) => {
  const shell = await createWatermarkShell(t, {
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, pages: 3, path: OUT, bytes: 2048 }],
  });
  await withSource(shell);
  const result = await shell.SigK.toolsWatermark.run();
  await shell.flush();
  assert.equal(result.ok, true);
  assert.deepEqual(plain(shell.savePathCalls), [{ defaultPath: 'C:\\work\\a_透かし.pdf', title: '透かしを入れた PDF を保存' }]);
  assert.equal(shell.taskCalls.length, 1);
  assert.deepEqual(plain(shell.taskCalls[0].spec), {
    kind: 'watermark', source: A, pages: [0, 1, 2], target: OUT,
    mark: { type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center' },
  });
  assert.equal(shell.SigK.tabs.list().some((tab) => tab.path === OUT), true);
  assert.equal(shell.document.documentElement.getAttribute('data-mode'), 'tools', 'ツールモードのまま（決定80）');
  assert.equal(bannerText(shell), '3 ページに透かしを入れました');
});

test('入力と同じ出力先と、タブで開いている出力先は断ってワーカーへ渡さない', async (t) => {
  const shell = await createWatermarkShell(t, { savePathResults: [{ path: A }, { path: B }] });
  await withSource(shell);
  assert.equal((await shell.SigK.toolsWatermark.run()).error, '出力先に入力ファイルと同じファイルは選べません。');
  assert.equal(bannerText(shell), '出力先に入力ファイルと同じファイルは選べません。');
  await shell.SigK.tabs.openPath(B);
  // B を開くと選んでいる帯（＝対象）も B になるので、a.pdf の帯を選び直す。
  shell.SigK.tabs.activate(shell.SigK.tabs.list()[0].id);
  assert.equal((await shell.SigK.toolsWatermark.run()).error, '出力先のファイルはタブで開いているので、タブを閉じるか、別の名前を選んでください。');
  assert.equal(shell.taskCalls.length, 0);
});

test('保存ダイアログを開いている間も実行中と数え、やめれば下ろす（spec-5-1 確定事項12）', async (t) => {
  let answer;
  const dialog = new Promise((resolve) => { answer = resolve; });
  const shell = await createWatermarkShell(t, { savePathResults: [dialog] });
  await withSource(shell);

  const running = shell.SigK.toolsWatermark.run();
  await shell.flush();
  assert.equal(shell.SigK.toolsWatermark.isRunning(), true);
  assert.equal(shell.SigK.toolsWatermark.canRun(), false);

  answer({ canceled: true });
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.SigK.toolsWatermark.isRunning(), false);
  assert.equal(shell.SigK.toolsWatermark.canRun(), true);
});

test('保存ダイアログをやめたら何もしない。中止は帯で伝える', async (t) => {
  const shell = await createWatermarkShell(t, { savePathResults: [{ canceled: true }, { path: OUT }], taskResults: [{ canceled: true }] });
  await withSource(shell);
  assert.deepEqual(plain(await shell.SigK.toolsWatermark.run()), { canceled: true });
  assert.equal(shell.taskCalls.length, 0);
  await shell.SigK.toolsWatermark.run();
  assert.equal(bannerText(shell), '透かしの追加を中止しました。');
  assert.equal(shell.SigK.tabs.list().some((tab) => tab.path === OUT), false);
});

test('ワーカーの失敗は文言をそのまま帯に出す', async (t) => {
  const shell = await createWatermarkShell(t, { savePathResults: [{ path: OUT }], taskResults: [{ error: 'この PDF は内容が壊れているため保存できません。' }] });
  await withSource(shell);
  await shell.SigK.toolsWatermark.run();
  assert.equal(bannerText(shell), 'この PDF は内容が壊れているため保存できません。');
});

test('透かしを選んでいるときのドロップは、PDF を帯で開いて対象にし、PNG・JPEG を透かしの画像にする', async (t) => {
  const shell = await createWatermarkShell(t);
  const { SigK, window } = shell;
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('logo.png', LOGO), makeDroppedFile('b.pdf', B), makeDroppedFile('memo.txt', 'C:\\work\\memo.txt')]);
  await SigK.fileDrop.handleDrop(event);
  await shell.flush();
  assert.equal(SigK.toolsWatermark.source().path, B);
  assert.equal(SigK.toolsWatermark.image().path, LOGO);
  assert.equal(SigK.toolsWatermark.settings().type, 'image');
  assert.deepEqual(plain(SigK.tabs.list().map((tab) => tab.path)), [B], 'PDF はタブでも開く（決定80）。画像は開かない');

  const rejected = new window.Event('drop', { bubbles: true, cancelable: true });
  rejected.dataTransfer = makeDataTransfer([makeDroppedFile('memo.txt', 'C:\\work\\memo.txt')]);
  assert.equal(await SigK.fileDrop.handleDrop(rejected), false);
  assert.equal(bannerText(shell), 'PDF でも PNG・JPEG でもないので、PDF か PNG・JPEG の画像を落としてください。');
});

test('透かしの画像を 2 つ以上渡したら、1つ目だけを使い、黄色の帯で知らせる', async (t) => {
  const LOGO2 = 'C:\\work\\logo2.png';
  const shell = await createWatermarkShell(t, {
    watermarkImages: {
      [LOGO]: { kind: 'png', width: 400, height: 200 },
      [LOGO2]: { kind: 'png', width: 200, height: 200 },
    },
  });
  const { SigK } = shell;

  assert.equal(await SigK.toolsWatermark.addImages([LOGO, LOGO2]), true);
  await shell.flush();

  assert.equal(SigK.toolsWatermark.image().path, LOGO);
  assert.equal(bannerText(shell), SigK.toolsWatermark.NOTE_FIRST_IMAGE);
  // 注意・お知らせは黄色の帯で出す（決定49）。
  assert.equal(byId(shell, 'view-banner').getAttribute('data-tone'), 'warn');
});

// 帯のページへの重ね（spec-2-5 確定事項E3。strip-watermark.js）。
const overlays = (shell) => [...shell.document.querySelectorAll('#strips .strip-wm')];

test('透かしを選んでいる間は、選んでいる帯の透かしを入れるページに透かしを重ね、範囲・ツール・帯に合わせて付け外しする', async (t) => {
  const shell = await createWatermarkShell(t);
  const { SigK, document: doc, window } = shell;
  await withSource(shell, A);
  await withSource(shell, B);
  const sheetsOf = (index) => [...doc.querySelectorAll('#strips .strip')[index].querySelectorAll('.sheet')];
  assert.equal(overlays(shell).length, 3, '選んでいる帯（b.pdf）の 3 ページ');
  assert.ok(sheetsOf(1).every((sheet) => sheet.querySelector('.strip-wm') !== null));
  assert.equal(sheetsOf(0).some((sheet) => sheet.querySelector('.strip-wm') !== null), false, 'ほかの帯には重ねない');
  assert.equal(overlays(shell)[0].querySelector('text').textContent, '社外秘');

  const range = byId(shell, 'wm-range');
  range.dispatchEvent(new window.Event('focus'));
  range.value = '2';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(sheetsOf(1).map((sheet) => sheet.querySelector('.strip-wm') !== null), [false, true, false]);

  doc.querySelector('#strips .strip .fname').click();
  assert.deepEqual(sheetsOf(0).map((sheet) => sheet.querySelector('.strip-wm') !== null), [false, true, false], '帯を選び直すとその帯に重ねる');
  assert.equal(sheetsOf(1).some((sheet) => sheet.querySelector('.strip-wm') !== null), false);

  SigK.tools.select('merge');
  assert.equal(overlays(shell).length, 0, 'ほかのツールでは重ねない');
});

// 保存していない帯は、実行の前に確かめる（spec-2-5 確定事項F。窓そのものは run-guard.test.js が見る）。
test('保存していない帯を対象にすると、実行の前に確認の窓を出し、［キャンセル］なら保存先も聞かない', async (t) => {
  const shell = await createWatermarkShell(t);
  await withSource(shell);
  shell.SigK.pageEdit.rotate(90, [0]);
  const running = shell.SigK.toolsWatermark.run();
  await shell.flush();
  assert.equal(shell.SigK.confirmUnsavedRun.isOpen(), true);
  byId(shell, 'confirm-unsaved-run-cancel').click();
  assert.deepEqual(plain(await running), { canceled: true });
  assert.equal(shell.savePathCalls.length, 0);
});
