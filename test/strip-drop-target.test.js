'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// 引いているページをどこへ落とすか（spec-2-5 確定事項I2〜I4。PR-4 の起草者の判断 I-b）。strip-drop-target.js。DOM に触れない。
// 帯の紙の列のページとページの間（紙の真ん中より左なら前、右なら後ろ）、見出しと紙の列の右の空きは末尾、帯と帯の間は落とせない、受け口は新しい帯。

async function withTarget(t) {
  const shell = await createShell();
  t.after(() => shell.cleanup());
  return shell.SigK;
}

const A4 = { width: 595.28, height: 841.89 };

// 帯 2 本（上端 0 と 198・高さ 188・紙の列は見出しの 40px 下・左端 10）と受け口（600〜700）。
function layoutOf(SigK, { refused = null } = {}) {
  const line = SigK.stripLayout.row([A4, A4, A4]);
  const strip = (tabId, top) => ({ tabId, left: 0, right: 800, top, height: 188, pagesTop: top + 40, pagesLeft: 10, scrollLeft: 0, line, board: false });
  return { strips: [strip(1, 0), strip(2, 198)], zone: { left: 0, right: 800, top: 600, bottom: 700 }, refused, line };
}

test('gapIndex は紙の真ん中より左なら前、右なら後ろ', async (t) => {
  const SigK = await withTarget(t);
  const line = SigK.stripLayout.row([A4, A4, A4]);
  const center = (index) => line.lefts[index] + line.widths[index] / 2;
  const at = (x) => SigK.stripDropTarget.gapIndex(line, x);
  assert.deepEqual([at(0), at(center(0) - 1), at(center(0)), at(center(1) + 1), at(center(2)), at(5000)], [0, 0, 1, 2, 3, 3]);
  assert.equal(SigK.stripDropTarget.gapIndex(SigK.stripLayout.row([]), 40), 0, '紙が無い帯は先頭');
});

test('引き始めた帯の紙の上は動かす、ほかの帯は写す（横のスクロールも数える）', async (t) => {
  const SigK = await withTarget(t);
  const layout = layoutOf(SigK);
  const resolve = (x, y, extra = {}) => structuredClone(SigK.stripDropTarget.resolve({ ...layout, ...extra, x, y, sourceTabId: 1 }));
  const center = (index) => 10 + layout.line.lefts[index] + layout.line.widths[index] / 2;

  assert.deepEqual(resolve(12, 100), { kind: 'move', tabId: 1, index: 0 });
  assert.deepEqual(resolve(center(1) + 1, 300), { kind: 'copy', tabId: 2, index: 2 });
  const scrolled = { strips: layout.strips.map((strip) => ({ ...strip, scrollLeft: layout.line.lefts[1] })) };
  assert.deepEqual(resolve(12, 300, scrolled), { kind: 'copy', tabId: 2, index: 1 }, '横に送った分だけ後ろ');
});

test('見出しの上と紙の列の右の空きは末尾、帯と帯の間・帯の外は落とせない、受け口は新しい帯', async (t) => {
  const SigK = await withTarget(t);
  const layout = layoutOf(SigK);
  const resolve = (x, y) => structuredClone(SigK.stripDropTarget.resolve({ ...layout, x, y, sourceTabId: 1 }));

  assert.deepEqual(resolve(100, 210), { kind: 'copy', tabId: 2, index: 3 }, '見出しの上');
  assert.deepEqual(resolve(780, 300), { kind: 'copy', tabId: 2, index: 3 }, '右の空き');
  assert.deepEqual(resolve(100, 192), { kind: 'none' }, '帯と帯の間');
  assert.deepEqual(resolve(900, 100), { kind: 'none' }, '帯の右の外（右の欄）');
  assert.deepEqual(resolve(100, 650), { kind: 'new' });
  assert.deepEqual(resolve(100, 550), { kind: 'none' }, '最後の帯と受け口の間');
});

test('✂ の盤を広げた帯は、帯の紙の列としては落とす先にしない', async (t) => {
  const SigK = await withTarget(t);
  const layout = layoutOf(SigK);
  layout.strips[1].board = true;
  assert.deepEqual(structuredClone(SigK.stripDropTarget.resolve({ ...layout, x: 100, y: 300, sourceTabId: 1 })), { kind: 'none' });
});
