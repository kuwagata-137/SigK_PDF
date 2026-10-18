'use strict';

// ほかの処理が終わったら、ツールの［実行…］が描き直しを待たずに押せるようになる（計画外の直し）。
//
// ツールの［実行…］が押せるかは、各ツールの canRun() が「ほかの処理が走っているか」（save.isBusy）も見て決める。
// 走り始めと終わりにツールの画面を描き直さないと、走っている間に描いた「押せない」が、終わっても残る。
// 隠れている間に走り始めたときは、選び直した画面に古い「押せる」が残る。ここは 6 つのツールすべてで、
// ほかの処理の間は押せず、終われば押せることを、［実行…］の aria-disabled で見る。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

const A = 'C:\\work\\a.pdf';
const B = 'C:\\work\\b.pdf';
const PNG = 'C:\\photo\\a.png';
const MERGED = 'C:\\work\\merged.pdf';
// フラット化は、対象を決めるとワーカーで書き込みを数える。焼き込めるものが 1 件あれば実行できる。
const CENSUS = {
  ok: true, baked: 1, kept: 0, notes: 0,
  bake: { markup: 1, text: 0, shape: 0, note: 0, other: 0 },
  keep: { functional: 0, noAppearance: 0, hidden: 0 },
};

// 6 つのツール。ready は、そのツールだけなら［実行…］が押せるところまで整える。
// taskResults は、整える間にワーカーへ頼む分の返事（フラット化の数え）。
const TOOLS = [
  // 結合する PDF は帯（＝タブ）。開くと結合の行に既定でチェックが入る（spec-2-5 確定事項E2）。
  { id: 'merge', label: '結合', api: 'toolsMerge', button: 'merge-run', ready: (SigK) => SigK.tabs.openPath(B) },
  // 分割の対象も選んでいる帯（spec-2-5 確定事項G1）。開いた帯を 1 ページずつに分ける。
  {
    id: 'split', label: '分割', api: 'toolsSplit', button: 'split-run',
    ready: async (SigK) => {
      await SigK.tabs.openPath(A);
      SigK.toolsSplitEdit.bulk('each');
    },
  },
  { id: 'convert', label: '画像→PDF', api: 'toolsConvert', button: 'convert-run', ready: (SigK) => SigK.toolsConvert.addPaths([PNG]) },
  // PDF→画像の対象は選んでいる帯（spec-2-5 確定事項E4）。開いたタブが選んでいる帯になる。
  { id: 'toImage', label: 'PDF→画像', api: 'toolsToImage', button: 'toimage-run', ready: (SigK) => SigK.tabs.openPath(A) },
  { id: 'watermark', label: '透かし', api: 'toolsWatermark', button: 'wm-run', ready: (SigK) => SigK.tabs.openPath(A) },
  { id: 'flatten', label: 'フラット化', api: 'toolsFlatten', button: 'fl-run', ready: (SigK) => SigK.tabs.openPath(A), taskResults: [CENSUS] },
];
const toolOf = (id) => TOOLS.find((tool) => tool.id === id);

async function settle(shell) {
  for (let index = 0; index < 4; index += 1)
    await shell.flush();
}

async function createToolsShell(t, options = {}) {
  const shell = await createShell({
    files: { [A]: makeSource({ path: A }), [B]: makeSource({ path: B }) },
    imageInfos: { [PNG]: { kind: 'png', width: 1200, height: 800 } },
    ...options,
  });
  t.after(() => shell.cleanup());
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'tools');
  return shell;
}

// ツールを選んで、［実行…］が押せるところまで整える。返すのは［実行…］の節。
async function prepare(shell, tool) {
  shell.SigK.tools.select(tool.id);
  await tool.ready(shell.SigK);
  await settle(shell);
  const button = shell.document.getElementById(tool.button);
  assert.equal(shell.SigK[tool.api].canRun(), true, `${tool.label}を整えたので実行できる`);
  assert.notEqual(button.getAttribute('aria-disabled'), 'true', `${tool.label}の［実行…］は押せる`);
  return button;
}

// ほかのツール（結合か分割）を整えて走らせる。ワーカーの返事は gate で待たせておく。
// 走っている Promise は包んで返す（async 関数がそのまま返すと、終わるまで待ってしまう）。
async function startOther(shell, other) {
  const { SigK } = shell;
  // 準備で帯を開くと、選んでいる帯（分割・PDF→画像・フラット化などの対象。spec-2-5 確定事項E4・E5・G1）が替わる。
  // ほかの処理を走らせ始めてから元の帯を選び直して、試すツールの対象を保つ（走らせる前に戻すと、分割はその帯を対象にしてしまう）。
  const active = SigK.tabs.activeId();
  await other.ready(SigK);
  SigK.tools.select(other.id);
  const running = SigK[other.api].run();
  await settle(shell);
  assert.equal(SigK.save.isBusy(), true, `${other.label}が走っている`);
  if (active !== null)
    SigK.tabs.activate(active);
  return { running };
}

for (const tool of TOOLS) {
  const other = toolOf(tool.id === 'merge' ? 'split' : 'merge');
  test(`${tool.label}: ${other.label}が走っている間に選ぶと［実行…］は押せず、${other.label}が終われば描き直しを待たずに押せる`, async (t) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const shell = await createToolsShell(t, { savePathResults: [{ path: MERGED }], taskResults: [...(tool.taskResults ?? []), gate] });
    const { SigK } = shell;
    const button = await prepare(shell, tool);

    const { running } = await startOther(shell, other);
    SigK.tools.select(tool.id);
    await settle(shell);
    assert.equal(SigK[tool.api].canRun(), false);
    assert.equal(button.getAttribute('aria-disabled'), 'true', `${other.label}が走っている間は押せない`);

    // 画面には触らずに、ほかの処理を終わらせる（中止で終える）。
    release({ canceled: true });
    await running;
    await settle(shell);
    assert.equal(SigK.save.isBusy(), false);
    assert.equal(SigK[tool.api].canRun(), true);
    assert.notEqual(button.getAttribute('aria-disabled'), 'true', `${other.label}が終われば押せる`);
  });
}

test('分割: PDF→画像（レンダラーの中で回す処理）が終わったときも、描き直しを待たずに［実行…］が押せる', async (t) => {
  const shell = await createToolsShell(t);
  const { SigK } = shell;
  const button = await prepare(shell, toolOf('split'));
  // 書き出しを待たせる。1 ページだけ書かせ、その 1 枚の返事で終わる。
  const gates = [];
  shell.window.imageAPI.write = (target) => new Promise((resolve) => {
    gates.push(() => resolve({ ok: true, path: target, bytes: 0 }));
  });
  await SigK.tabs.openPath(B);
  SigK.toolsToImage.setPageMode('range');
  SigK.toolsToImage.setRange('1');
  SigK.tools.select('toImage');
  const running = SigK.toolsToImage.run();
  await settle(shell);
  assert.equal(gates.length, 1, '1 ページ目を書いている');
  assert.equal(SigK.save.isBusy(), true);
  // 分割の対象は選んでいる帯なので、分けると決めた A の帯を選び直す（spec-2-5 確定事項G1・G5）。
  SigK.tabs.activate(SigK.tabs.findByPath(A).id);

  SigK.tools.select('split');
  await settle(shell);
  assert.equal(button.getAttribute('aria-disabled'), 'true', 'PDF→画像の間は押せない');

  gates[0]();
  assert.equal((await running).ok, true);
  await settle(shell);
  assert.equal(SigK.save.isBusy(), false);
  assert.equal(SigK.toolsSplit.canRun(), true);
  assert.notEqual(button.getAttribute('aria-disabled'), 'true', 'PDF→画像が終われば押せる');
});
