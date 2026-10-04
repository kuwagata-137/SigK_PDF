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

test('turnedFrame は吹き出しの先を紙の上で動かさない（確定事項B3。回していなければ回す前の座標のまま）', () => {
  const callout = { ...TEXT, tip: [130, 600] };
  const grown = { rect: [100, 600, 300, 700] };
  assert.deepEqual(turn.turnedFrame(callout, grown).tip, [130, 600]);
  const turned = { ...callout, angle: 30 };
  const frame = turn.turnedFrame(turned, grown);
  const before = rotation.rotatePoint(turned.tip, rotation.centerOf(turned.rect), 30);
  near(rotation.rotatePoint(frame.tip, rotation.centerOf(frame.rect), 30), before);
  assert.equal('tip' in turn.turnedFrame(TEXT, grown), false, '吹き出しでなければ tip を持たない');
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

test('回したテキストを打ち直す・大きさを変える・書式を付けると、回した左上が紙の上で動かない（確定事項B1・D1。決定59 ①）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeText(shell, 100, 700, 'あいう');
  SigK.annotationAngleRow.setAngle(30);
  const latest = () => SigK.viewer.getAnnotations().added.at(-1);
  const corner = (entry) => plain(SigK.freeTextTurn.originOnPaper(entry));
  const start = corner(latest());

  // 打ち直す。入力欄は回した左上に、同じ角度で回して出る。
  SigK.annotateText.editSelected();
  const node = shell.document.querySelector('textarea.free-text-editor');
  assert.match(node.style.transform, /rotate\(30deg\)/);
  const [x, y] = SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(...start);
  assert.equal(node.style.left, `${x - SigK.freeTextEditor.BORDER}px`);
  assert.equal(node.style.top, `${y - SigK.freeTextEditor.BORDER}px`);
  node.value = 'あいうえおかきくけこさしすせそたちつてと';
  node.dispatchEvent(new shell.window.Event('input', { bubbles: true }));
  SigK.freeTextEditor.finish();
  assert.ok(latest().rect[1] < 690, '行が増えて箱が伸びた');
  near(corner(latest()), start);
  assert.equal(latest().angle, 30);
  assert.deepEqual(plain(latest().quads), plain([SigK.shapeRotation.quadOf(latest().rect, 30)]));

  SigK.annotateTextStyle.setFontSize(18);
  near(corner(latest()), start);
  // 余白が広がっても、中身の左上（文字の位置）は紙の上で動かない（spec-4b-4a 確定事項B5 を回したテキストでも）。
  const content = (entry) => {
    const inset = SigK.freeTextLayout.insetOf(entry);
    const origin = SigK.freeTextGeometry.frameOrigin(entry.rect, entry.rotation);
    return plain(SigK.freeTextTurn.onPaper(entry, SigK.freeTextLayout.shiftOrigin(origin, entry.rotation, [inset.left, inset.top])));
  };
  const text = content(latest());
  SigK.annotateTextStyle.setTextFill('#fff2cc');
  SigK.annotateTextStyle.setBorder('#c00000');
  assert.ok(Math.hypot(corner(latest())[0] - start[0], corner(latest())[1] - start[1]) > 1, '余白が広がると箱の左上は外へ出る');
  near(content(latest()), text);
});

test('回したテキストの幅のつまみは反対の辺を紙の上で動かさず、動かすと回した絵がそのままずれる（確定事項B1）', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  placeText(shell, 100, 700, 'あいうえおかきくけこさしすせそ');
  SigK.annotationAngleRow.setAngle(90);
  const entry = SigK.viewer.getAnnotations().added.at(-1);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const box = SigK.freeTextHandles.boxOf(entry, viewport);
  // 左のつまみを表示の右の向きへ 20px 引く（中身の右が動かない）。
  const press = [0, 0];
  const point = [box.right[0] * 20, box.right[1] * 20];
  const patch = SigK.freeTextResize.widthPatch(entry, 'left', press, point, viewport);
  const next = { ...entry, ...patch };
  const rightEdge = (target) => {
    const b = SigK.freeTextHandles.boxOf(target, viewport);
    return [(b.topRight[0] + b.bottomRight[0]) / 2, (b.topRight[1] + b.bottomRight[1]) / 2];
  };
  const before = rightEdge(entry);
  const after = rightEdge({ ...next, rect: next.rect, width: next.width });
  assert.ok(Math.abs(after[0] - before[0]) <= 0.02 && Math.abs(after[1] - before[1]) <= 0.02, `${after} ≠ ${before}`);
  // 動かす: 箱の中心が delta だけ動き、角度と大きさは変わらない。
  const moved = SigK.annotationMoves.movedPatch(entry, [10, -20]);
  const center = SigK.shapeRotation.centerOf(entry.rect);
  near(SigK.shapeRotation.centerOf(moved.rect), [center[0] + 10, center[1] - 20]);
  assert.deepEqual(plain(moved.quads), plain([SigK.shapeRotation.quadOf(moved.rect, 90)]));
});
