'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../renderer/free-text-geometry.js');
require('../renderer/shape-rotation.js');
require('../renderer/free-text-turn.js');
const { withTextShell, placeText, plain } = require('./text-helpers.js');

// 回したテキストの箱の純粋層（spec-4b-4b 確定事項A2・B・C1・D1）と、回転のつまみ・回転の行でテキストを回す画面の流れ。

const SigK = globalThis.SigK;
const turn = SigK.freeTextTurn;
const rotation = SigK.shapeRotation;

function near(actual, expected, eps = 0.011) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= eps, `${actual} ≠ ${expected}`));
}

const TEXT = { kind: 'text', rect: [100, 650, 220, 700], rotation: 0, fontSize: 12, text: 'あい', width: 'auto' };

test('quadsOf は回していなければ箱の四角、回していれば回した 4 隅', () => {
  assert.deepEqual(turn.quadsOf([0, 0, 10, 20]), [[0, 20, 10, 20, 0, 0, 10, 0]]);
  assert.deepEqual(turn.quadsOf([0, 0, 10, 20], 30), [rotation.quadOf([0, 0, 10, 20], 30)]);
});

test('turnedFrame は、回したテキストの組み直した箱の中心を回し直し、表示の左上を紙の上で動かさない（確定事項B1）', () => {
  // 回す前の表示の左上 (100, 700) を据え置いて、右と下へ伸ばした箱。
  const grown = { rect: [100, 600, 300, 700] };
  assert.deepEqual(turn.turnedFrame(TEXT, grown), { rect: [100, 600, 300, 700], quads: [[100, 700, 300, 700, 100, 600, 300, 600]] });
  for (const angle of [30, 90, 137, 300]) {
    const entry = { ...TEXT, angle };
    const next = turn.turnedFrame(entry, grown);
    assert.equal(Math.round((next.rect[2] - next.rect[0]) * 100) / 100, 200);
    near(turn.originOnPaper({ ...entry, rect: next.rect }), turn.originOnPaper(entry));
    assert.deepEqual(next.quads, [rotation.quadOf(next.rect, angle)]);
  }
});

test('onPaper・originOnPaper は回したテキストの点を箱の中心まわりに回す', () => {
  assert.deepEqual(turn.originOnPaper(TEXT), [100, 700]);
  near(turn.originOnPaper({ ...TEXT, angle: 90 }), rotation.rotatePoint([100, 700], [160, 675], 90));
  near(turn.originOnPaper({ ...TEXT, rotation: 90, rect: [100, 600, 150, 720], angle: 30 }), rotation.rotatePoint([100, 600], [125, 660], 30));
  assert.deepEqual(turn.onPaper(TEXT, [1, 2]), [1, 2]);
});

test('anglePatch は新しい形なら角度と回した 4 隅だけ、今までの形は固定の幅の新しい形へ移す（確定事項A2）', (t) => {
  assert.deepEqual(turn.anglePatch(TEXT, 30), { angle: 30, rect: TEXT.rect, quads: [rotation.quadOf(TEXT.rect, 30)] });
  assert.deepEqual(turn.anglePatch({ ...TEXT, angle: 30 }, 360), { angle: 0, rect: TEXT.rect, quads: [[100, 700, 220, 700, 100, 650, 220, 650]] });
  const saved = { style: SigK.freeTextStyle, metrics: SigK.freeTextMetrics };
  SigK.freeTextStyle = { fixedWidthOf: () => 96 };
  SigK.freeTextMetrics = { reframe: (entry, patch) => ({ rect: patch.width === 96 ? [100, 650, 200, 700] : null }) };
  t.after(() => {
    SigK.freeTextStyle = saved.style;
    SigK.freeTextMetrics = saved.metrics;
  });
  const legacy = { ...TEXT };
  delete legacy.width;
  assert.deepEqual(turn.anglePatch(legacy, 45), { angle: 45, width: 96, rect: [100, 650, 200, 700], quads: [rotation.quadOf([100, 650, 200, 700], 45)] });
});

test('回転の行と回転のつまみでテキストを回せ、1 世代ずつ積まれ、今までの形にも出す（確定事項C5・C6）', async (t) => {
  const shell = await withTextShell(t);
  const { document, window } = shell;
  const entry = placeText(shell, 100, 700, 'あいう');
  const row = document.getElementById('props-angle-row');
  assert.equal(row.hidden, false, 'テキストを 1 つ選んでいれば回転の行を出す');
  const number = document.getElementById('props-angle');
  number.value = '30';
  number.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const turned = shell.SigK.viewer.getAnnotations().added.at(-1);
  assert.equal(turned.angle, 30);
  assert.deepEqual(plain(turned.rect), plain(entry.rect), '回す前の箱は変えない');
  assert.deepEqual(plain(turned.quads), plain([shell.SigK.shapeRotation.quadOf(entry.rect, 30)]));
  const group = document.querySelector(`.annot-layer g[data-annot="${turned.id}"] g.free-text`);
  assert.match(group.getAttribute('transform'), / rotate\(30\)$/);
  shell.SigK.pageEdit.undo();
  assert.equal('angle' in shell.SigK.viewer.getAnnotations().added.at(-1), false);
  shell.SigK.annotate.setTool(null);
  shell.SigK.annotate.select(null);
  assert.equal(row.hidden, true);
});
