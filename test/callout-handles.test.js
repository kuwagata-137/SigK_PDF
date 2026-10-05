'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, placeCallout, pageNode, plain } = require('./text-helpers.js');

// 吹き出しのしっぽの先のつまみ・回す・動かす・当たり（spec-4b-4b 確定事項B3・C4・F4）。jsdom はレイアウトしないので、ページの枠の
// 左上は (0,0) で、clientX/Y がそのまま .pdf-page 基準の CSS px になる。

function mouse(shell, type, target, [x, y], extra = {}) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra }));
}

function handleOf(shell, id) {
  return shell.SigK.annotationFrame.shown().shape.handles.find((handle) => handle.id === id);
}

function pull(shell, id, delta, { shift = false } = {}) {
  const at = handleOf(shell, id).at;
  const to = [at[0] + delta[0], at[1] + delta[1]];
  mouse(shell, 'mousedown', pageNode(shell), at, { shiftKey: shift });
  mouse(shell, 'mousemove', shell.document.body, to, { shiftKey: shift });
  mouse(shell, 'mouseup', pageNode(shell), to, { shiftKey: shift });
}

const near = (a, b, tolerance = 0.02) => assert.ok(a.every((value, index) => Math.abs(value - b[index]) <= tolerance), `${a} ≠ ${b}`);

test('選んだ吹き出しには、しっぽの先に白いつまみが出て、引くと先が動いて 1 世代積む', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  SigK.annotate.setTool('select');
  SigK.annotate.select(entry.id);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const tip = handleOf(shell, 'tip');
  assert.deepEqual([tip.kind, tip.cursor], ['tip', 'move']);
  near(tip.at, viewport.convertToViewportPoint(...entry.callout.tip));
  const before = SigK.pageEdit.getHistory?.() ?? null;
  pull(shell, 'tip', [30, 20]);
  const moved = SigK.annotate.selectedEntry();
  near(plain(moved.callout.tip), viewport.convertToPdfPoint(tip.at[0] + 30, tip.at[1] + 20));
  assert.deepEqual(plain(moved.rect), plain(entry.rect), '本体は動かない');
  assert.ok(before === null || before !== SigK.pageEdit.getHistory?.());
});

test('Shift を押しながら引くと、先は本体の向き（回した軸）の水平か垂直にだけ動く', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const placed = placeCallout(shell, 100, 700, '数量を確認');
  SigK.annotateTransform.commit(placed, SigK.freeTextTurn.anglePatch(placed, 90));
  const entry = SigK.viewer.getAnnotations().added.at(-1);
  SigK.annotate.setTool('select');
  SigK.annotate.select(entry.id);
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  const start = handleOf(shell, 'tip').at;
  // 90° 回した本体の右は表示の下向き。斜めに引くと、大きい方（表示の縦＝本体の水平）だけが残る。
  pull(shell, 'tip', [12, 40], { shift: true });
  const moved = SigK.annotate.selectedEntry();
  near(plain(moved.callout.tip), viewport.convertToPdfPoint(start[0], start[1] + 40));
});

test('吹き出しを回すと、しっぽの先も箱の中心のまわりに回り、動かすと一緒に動く', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  const center = SigK.shapeRotation.centerOf(entry.rect);
  const patch = SigK.freeTextTurn.anglePatch(entry, 30);
  near(plain(patch.callout.tip), SigK.shapeRotation.rotatePoint(plain(entry.callout.tip), center, 30));
  const turned = { ...entry, ...patch };
  const back = SigK.freeTextTurn.anglePatch(turned, 0);
  near(plain(back.callout.tip), plain(entry.callout.tip));
  const moved = SigK.annotationMoves.movedPatch(turned, [10, -5]);
  near(plain(moved.callout.tip), [patch.callout.tip[0] + 10, patch.callout.tip[1] - 5]);
});

test('しっぽの三角を押しても吹き出しに当たり、しっぽの外は当たらない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  const viewport = SigK.viewer.getTextLayer(0).viewport;
  // 先と付け根の間（先の少し上）。
  const tip = entry.callout.tip;
  const inTail = viewport.convertToViewportPoint(tip[0] + 2, tip[1] + 6);
  assert.equal(SigK.annotationHit.hitTest(0, inTail), entry.id);
  const outside = viewport.convertToViewportPoint(tip[0] + 40, tip[1] + 2);
  assert.equal(SigK.annotationHit.hitTest(0, outside), null);
});
