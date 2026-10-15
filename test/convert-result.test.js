'use strict';

// 画像→PDF の変換のあと（spec-2-5 確定事項H3・H7・H11〜H13。決定80 ㊱。見本 screenshots/strips3-converted.png）。
//
// 書き出しそのものと「まとめる」「画像ごと」の基本の知らせは test/tools-convert.test.js が見ている。
// ここは「できた PDF」のカードの文・番号・ボタン、カードが消える 3 つの場合、帯の上限で入りきらないとき、枠の行き来を見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const DIR = 'C:\\photo';
const A = `${DIR}\\a.png`;
const B = `${DIR}\\b.jpg`;
const C = `${DIR}\\c.png`;
const PDF = `${DIR}\\x.pdf`;
const OUT = `${DIR}\\a.pdf`;
const EACH = [`${DIR}\\a.pdf`, `${DIR}\\b.pdf`, `${DIR}\\c.pdf`];

const INFOS = {
  [A]: { kind: 'png', width: 1200, height: 800 },
  [B]: { kind: 'jpeg', width: 600, height: 900 },
  [C]: { kind: 'png', width: 64, height: 64 },
};

async function createResultShell(t, { open = [PDF], files = {}, ...options } = {}) {
  const all = { [PDF]: makeSource({ path: PDF }), ...Object.fromEntries(EACH.map((filePath) => [filePath, makeSource({ path: filePath })])), ...files };
  const shell = await createShell({ ...options, files: all, imageInfos: INFOS });
  t.after(() => shell.cleanup());
  await shell.flush();
  for (const filePath of open)
    await shell.SigK.tabs.openPath(filePath);
  shell.SigK.shell.setMode(shell.document, 'tools');
  shell.SigK.tools.select('convert');
  return shell;
}

const byId = (shell, id) => shell.document.getElementById(id);
const card = (shell) => byId(shell, 'convert-result');
const cardText = (shell) => ({
  title: byId(shell, 'convert-result-title').textContent,
  desc: byId(shell, 'convert-result-desc').textContent,
  merge: byId(shell, 'convert-result-merge').textContent,
  split: byId(shell, 'convert-result-split').textContent,
});
const strip = (shell, index) => shell.document.querySelectorAll('#strips .strip')[index];
const paths = (shell) => structuredClone(shell.SigK.tabs.list().map((tab) => tab.path));
const bannerText = (shell) => byId(shell, 'view-banner').textContent;
const action = (shell) => shell.document.querySelector('#view-banner .banner-action');

function pick(shell, name, value) {
  const node = shell.document.querySelector(`input[name="convert-${name}"][value="${value}"]`);
  node.checked = true;
  node.dispatchEvent(new shell.window.Event('change', { bubbles: true }));
}

test('「まとめる」のあと、足した帯を選んで画像の帯の枠を外し、右の欄に「できた PDF」のカードを出す（H3・H7）', async (t) => {
  const shell = await createResultShell(t, { savePathResults: [{ path: OUT }], taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }] });
  const { SigK } = shell;
  assert.equal(card(shell).hidden, true, '変換する前は出さない');
  await SigK.toolsConvert.addPaths([A, B]);
  assert.equal(byId(shell, 'image-strip').classList.contains('sel'), true);
  assert.equal(strip(shell, 0).classList.contains('sel'), false, '画像の帯に枠がある間は PDF の帯に枠を付けない');

  assert.equal((await SigK.toolsConvert.run()).ok, true);
  assert.equal(card(shell).hidden, false);
  assert.deepEqual(cardText(shell), {
    title: 'できた PDF（a.pdf）',
    desc: '新しい帯（2 番）として足しました。続けて使うツールを選べます。',
    merge: 'この PDF をほかの帯と結合する',
    split: 'この PDF を分割する',
  });
  assert.equal(byId(shell, 'image-strip').classList.contains('sel'), false);
  assert.equal(strip(shell, 1).classList.contains('sel'), true, '足した帯を選ぶ');
});

test('［この PDF を分割する］は、できた帯を選んで分割へ移り、その帯を ✂ の盤に広げる（決定80 ㊱・G1）', async (t) => {
  const shell = await createResultShell(t, { savePathResults: [{ path: OUT }], taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }] });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  await SigK.toolsConvert.run();
  SigK.tabs.activate(SigK.tabs.list()[0].id);

  byId(shell, 'convert-result-split').click();
  await shell.flush();
  assert.equal(SigK.tools.selected(), 'split');
  assert.equal(SigK.tabs.activeId(), SigK.tabs.findByPath(OUT).id);
  assert.equal(strip(shell, 1).classList.contains('board'), true);
});

test('「画像ごと」で 3 個のとき、カードは個数と番号の範囲を書き、［ほかの帯と結合する］はほかの帯のチェックをそのままにする（決定80 ㊱）', async (t) => {
  const shell = await createResultShell(t, { taskResults: [{ ok: true, written: 3, targets: EACH, pages: 3 }] });
  const { SigK } = shell;
  const first = SigK.tabs.list()[0].id;
  SigK.toolsMerge.setChecked(first, false);
  await SigK.toolsConvert.addPaths([A, B, C]);
  pick(shell, 'output', 'each');
  await SigK.toolsConvert.run();

  assert.deepEqual(paths(shell), [PDF, ...EACH]);
  assert.deepEqual(cardText(shell), {
    title: 'できた PDF（3 個）',
    desc: '新しい帯（2〜4 番）として足しました。続けて使うツールを選べます。',
    merge: 'できた PDF をほかの帯と結合する',
    split: '最後にできた PDF を分割する',
  });

  byId(shell, 'convert-result-merge').click();
  assert.equal(SigK.tools.selected(), 'merge');
  const checked = Object.fromEntries(SigK.toolsMerge.rows().map((row) => [row.path, row.checked]));
  assert.deepEqual(checked, { [PDF]: false, [EACH[0]]: true, [EACH[1]]: true, [EACH[2]]: true }, '新しい帯は既定でチェック、ほかの帯はそのまま');
});

test('できた帯を並べ替えたり閉じたりすると、カードの番号を書き直し、すべて閉じたらカードを消す（H12）', async (t) => {
  const shell = await createResultShell(t, { taskResults: [{ ok: true, written: 3, targets: EACH, pages: 3 }] });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);
  pick(shell, 'output', 'each');
  await SigK.toolsConvert.run();

  const ids = SigK.tabs.list().map((tab) => tab.id);
  assert.equal(SigK.tabs.reorder([ids[1], ids[0], ids[2], ids[3]]), true);
  assert.equal(cardText(shell).desc, '新しい帯（1・3・4 番）として足しました。続けて使うツールを選べます。');

  SigK.tabs.forceCloseTab(ids[2]);
  assert.equal(cardText(shell).desc, '新しい帯（1・3 番）として足しました。続けて使うツールを選べます。');
  SigK.tabs.forceCloseTab(ids[1]);
  SigK.tabs.forceCloseTab(ids[3]);
  assert.equal(card(shell).hidden, true);
});

test('カードは、用紙を変えたときと、次の変換を始めたときに消える（H12）', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // 出力先がタブで開いていると変換を断るので（確定事項38）、毎回別の名前で書く。
  const shell = await createResultShell(t, {
    savePathResults: EACH.map((filePath) => ({ path: filePath })),
    taskResults: [{ ok: true, path: EACH[0], pages: 2, inputs: 2 }, { ok: true, path: EACH[1], pages: 2, inputs: 2 }, gate],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  await SigK.toolsConvert.run();
  assert.equal(card(shell).hidden, false);
  pick(shell, 'paper', 'a3');
  assert.equal(card(shell).hidden, true, '用紙を変えた');

  await SigK.toolsConvert.run();
  assert.equal(card(shell).hidden, false);
  const running = SigK.toolsConvert.run();
  await shell.flush();
  assert.equal(card(shell).hidden, true, '次の変換を始めた');
  release({ ok: true, path: EACH[2], pages: 2, inputs: 2 });
  await running;
  assert.equal(card(shell).hidden, false);
  assert.equal(cardText(shell).title, 'できた PDF（c.pdf）', 'カードは最後の変換でできた PDF だけを書く');
});

test('「画像ごと」で帯が上限を超えると、入る分だけ足して最後の 1 本を選び、残りの数を知らせる（H11・H13）', async (t) => {
  const many = Array.from({ length: 18 }, (_value, index) => `C:\\work\\t${index}.pdf`);
  const shell = await createResultShell(t, {
    open: many,
    files: Object.fromEntries(many.map((filePath) => [filePath, makeSource({ path: filePath })])),
    taskResults: [{ ok: true, written: 3, targets: EACH, pages: 3 }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);
  pick(shell, 'output', 'each');
  await SigK.toolsConvert.run();

  assert.equal(SigK.tabs.count(), 20);
  assert.deepEqual(paths(shell).slice(-2), EACH.slice(0, 2));
  assert.equal(SigK.tabs.activeId(), SigK.tabs.findByPath(EACH[1]).id);
  assert.equal(bannerText(shell), '画像を 3 個の PDF にして、帯を 2 本足しました。残りの 1 個は、帯が 20 本を超えるので開いていません。フォルダを開く');
  assert.equal(action(shell).textContent, 'フォルダを開く');
  assert.equal(cardText(shell).title, 'できた PDF（2 個）');
  assert.equal(cardText(shell).desc, '新しい帯（19〜20 番）として足しました。続けて使うツールを選べます。');
});

test('「まとめる」でできた PDF を開けなかったときは、作ったことを知らせて［フォルダを開く］を付け、カードは出さない（H13）', async (t) => {
  const shell = await createResultShell(t, {
    files: { [OUT]: { ok: false, error: '開けませんでした。' } },
    savePathResults: [{ path: OUT }],
    taskResults: [{ ok: true, path: OUT, pages: 2, inputs: 2 }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B]);
  await SigK.toolsConvert.run();
  assert.equal(SigK.tabs.findByPath(OUT), null);
  assert.equal(bannerText(shell), '画像を PDF にして「a.pdf」を作りました。フォルダを開く');
  assert.equal(card(shell).hidden, true);
});

// 点検で見つかった（2026-10-15）。前は 1 個を開けなくても「画像を 3 個の PDF にして、帯を足しました。」とだけ出し、開けなかった理由の知らせも
// この知らせで上書きしていた。知らせは「3 個」、帯とカードは「2 個」で、数が合わない理由が分からなかった。
test('「画像ごと」でできた PDF の一部を開けなかったときは、足した帯の本数と開けなかった個数を知らせる', async (t) => {
  const shell = await createResultShell(t, {
    files: { [EACH[1]]: { ok: false, error: 'ファイルを読めませんでした。' } },
    taskResults: [{ ok: true, written: 3, targets: EACH, pages: 3 }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);
  pick(shell, 'output', 'each');
  await SigK.toolsConvert.run();

  assert.deepEqual(paths(shell), [PDF, EACH[0], EACH[2]]);
  assert.equal(bannerText(shell), '画像を 3 個の PDF にして、帯を 2 本足しました。1 個は開けませんでした。フォルダを開く');
  assert.equal(action(shell).textContent, 'フォルダを開く');
  assert.equal(cardText(shell).title, 'できた PDF（2 個）', 'カードは足した帯だけを書く');
});

test('「画像ごと」で開けなかった PDF と、帯の上限で開かなかった PDF があるときは、両方の個数を知らせる', async (t) => {
  const many = Array.from({ length: 18 }, (_value, index) => `${DIR}\\t${index}.pdf`);
  const shell = await createResultShell(t, {
    open: [PDF, ...many],   // 帯は 19 本。開けない 1 個目のあと、2 個目で 20 本になり、3 個目は開かない
    files: { ...Object.fromEntries(many.map((filePath) => [filePath, makeSource({ path: filePath })])), [EACH[0]]: { ok: false, error: 'ファイルを読めませんでした。' } },
    taskResults: [{ ok: true, written: 3, targets: EACH, pages: 3 }],
  });
  const { SigK } = shell;
  await SigK.toolsConvert.addPaths([A, B, C]);
  pick(shell, 'output', 'each');
  await SigK.toolsConvert.run();

  assert.equal(SigK.tabs.count(), 20);
  assert.equal(paths(shell).at(-1), EACH[1]);
  assert.equal(bannerText(shell), '画像を 3 個の PDF にして、帯を 1 本足しました。1 個は、帯が 20 本を超えるので開いていません。1 個は開けませんでした。フォルダを開く');
});
