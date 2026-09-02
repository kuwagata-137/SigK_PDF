'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource, makeDroppedFile, makeDataTransfer } = require('./harness.js');

const A = 'C:\\work\\a.pdf';

async function withShell(t, options = {}) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A }) }, ...options });
  t.after(() => shell.cleanup());
  return shell;
}

async function withOpenDocument(t, options = {}) {
  const shell = await withShell(t, options);
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  return shell;
}

const sleep = (window, ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

test('起動直後は帯を出していない', async (t) => {
  const { document, SigK } = await withShell(t);

  assert.equal(document.getElementById('view-banner').hidden, true);
  assert.equal(SigK.viewBanner.isVisible(), false);
});

// 塊② で持ち込んだ不具合の回帰テスト。文書を開いたまま setMessage を呼ぶと、
// 全面のオーバーレイが文書の上に出たまま残っていた。
test('文書が映っているときは、帯に出して文書を隠さない', async (t) => {
  const { document, SigK } = await withOpenDocument(t);

  SigK.viewer.setMessage('何かに失敗しました。');

  assert.equal(document.getElementById('view-banner').textContent, '何かに失敗しました。');
  assert.equal(document.getElementById('view-banner').hidden, false);
  assert.equal(document.getElementById('view-empty').hidden, true);
  assert.equal(document.getElementById('view-pages').hidden, false);
});

test('文書が映っていなければ、空の表示の文言を差し替える', async (t) => {
  const { document, SigK } = await withShell(t);

  SigK.viewer.setMessage('開けませんでした。');

  assert.equal(document.getElementById('view-message').textContent, '開けませんでした。');
  assert.equal(document.getElementById('view-empty').hidden, false);
  assert.equal(document.getElementById('view-banner').hidden, true, '文書が無いのに帯を出す必要はない');
});

test('帯は放っておけば消える', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.viewBanner.show('しばらくしたら消えます。', 20);
  assert.equal(shell.SigK.viewBanner.isVisible(), true);

  await sleep(shell.window, 60);
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
  assert.equal(shell.document.getElementById('view-banner').textContent, '');
});

test('帯は押せばすぐ消える', async (t) => {
  const shell = await withOpenDocument(t);
  shell.SigK.viewBanner.show('押すと消えます。');

  shell.document.getElementById('view-banner').dispatchEvent(
    new shell.window.MouseEvent('click', { bubbles: true }),
  );

  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

test('新しい帯を出すと、前の帯の消灯予約は取り消される', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.viewBanner.show('1つ目', 30);
  shell.SigK.viewBanner.show('2つ目', 400);
  await sleep(shell.window, 80);

  // 1つ目のタイマーが生きていると、ここで2つ目まで消えてしまう。
  assert.equal(shell.SigK.viewBanner.isVisible(), true);
  assert.equal(shell.SigK.viewBanner.text(), '2つ目');
});

test('文書を開いたまま PDF 以外を落とすと、帯で断る', async (t) => {
  const shell = await withOpenDocument(t);

  const event = new shell.window.Event('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = makeDataTransfer([makeDroppedFile('メモ.txt', 'C:\\work\\メモ.txt')]);
  shell.document.dispatchEvent(event);
  await shell.flush();

  assert.match(shell.document.getElementById('view-banner').textContent, /PDF ファイルではありません/);
  assert.equal(shell.document.getElementById('view-empty').hidden, true);
  assert.equal(shell.SigK.viewer.getState().open, true, '読んでいた文書はそのまま残る');
});

// 重ねるものが #view の中にあると、スクロールした分だけ画面の外へ出ていく。
// 実測では scrollTop=12700 のとき y=-12620 になっていた。
test('重ねるものは、スクロールする器の外に置く', async (t) => {
  const { document } = await withShell(t);
  const view = document.getElementById('view');

  for (const id of ['view-empty', 'view-banner', 'view-drop']) {
    const node = document.getElementById(id);
    assert.notEqual(node, null, `#${id} が無い`);
    assert.equal(view.contains(node), false, `#${id} が #view の中にある`);
    assert.equal(node.parentElement.id, 'view-wrap', `#${id} は #view-wrap の直下に置く`);
  }
  // ページの器だけは #view の中（スクロールする側）に残す。
  assert.equal(view.contains(document.getElementById('view-pages')), true);
});

// --- 塊⑤ で足した2つ（spec-1-6 確定事項6〜8） ---

test('帯に操作ボタンを載せられる', async (t) => {
  const shell = await withOpenDocument(t);
  let pressed = 0;

  shell.SigK.viewBanner.show('保存しています（3/5）', {
    autoHideMs: 0,
    tone: 'info',
    action: { label: '中止', onClick: () => { pressed += 1; } },
  });

  const button = shell.SigK.viewBanner.action();
  assert.notEqual(button, null);
  assert.equal(button.textContent, '中止');
  // 進捗まで赤いと失敗に見える。
  assert.equal(shell.document.getElementById('view-banner').getAttribute('data-tone'), 'info');
  // 文言にボタンのラベルを混ぜない。
  assert.equal(shell.SigK.viewBanner.text(), '保存しています（3/5）');

  button.dispatchEvent(new shell.window.MouseEvent('click', { bubbles: true }));
  assert.equal(pressed, 1);
  // 帯そのものを押すと閉じる作りなので、ボタンの押下がそこへ伝わってはいけない。
  assert.equal(shell.SigK.viewBanner.isVisible(), true, '中止を押しただけで帯が消えては、結果を出す場所が無くなる');
});

test('autoHideMs に 0 を渡すと、消すまで出したままになる', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.viewBanner.show('ずっと出ています', { autoHideMs: 0 });
  await sleep(shell.window, 60);
  assert.equal(shell.SigK.viewBanner.isVisible(), true);

  shell.SigK.viewBanner.hide();
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});

test('次の帯を出すと、前のボタンと色は残らない', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.viewBanner.show('保存しています', {
    autoHideMs: 0, tone: 'info', action: { label: '中止', onClick: () => {} },
  });
  shell.SigK.viewBanner.show('保存できませんでした。');

  assert.equal(shell.SigK.viewBanner.action(), null);
  assert.equal(shell.document.getElementById('view-banner').hasAttribute('data-tone'), false);
});

test('従来どおり show(text) と show(text, 数値) で呼べる', async (t) => {
  const shell = await withOpenDocument(t);

  shell.SigK.viewBanner.show('文字だけ');
  assert.equal(shell.SigK.viewBanner.text(), '文字だけ');
  assert.equal(shell.SigK.viewBanner.action(), null);

  shell.SigK.viewBanner.show('すぐ消える', 20);
  await sleep(shell.window, 60);
  assert.equal(shell.SigK.viewBanner.isVisible(), false);
});
