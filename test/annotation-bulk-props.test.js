'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, makeSource } = require('./harness.js');

// 2 件以上を選んでいるときの右パネル（spec-4b-3a 確定事項I。モック screenshots/phase4b-3-multi.png）。

const A = 'C:\\work\\a.pdf';

async function withShell(t) {
  const shell = await createShell({ files: { [A]: makeSource({ path: A, name: 'a.pdf' }) } });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  shell.SigK.shell.setMode(shell.document, 'annot');
  return shell;
}

function mouse(shell, type, target, [x, y]) {
  target.dispatchEvent(new shell.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

function draw(shell, kind, from, to) {
  const { SigK } = shell;
  const node = shell.document.querySelector('.pdf-page[data-page="1"]');
  const px = (point) => SigK.viewer.getTextLayer(0).viewport.convertToViewportPoint(point[0], point[1]);
  SigK.annotate.setTool('shape');
  SigK.annotate.setShapeKind(kind);
  mouse(shell, 'mousedown', node, px(from));
  mouse(shell, 'mousemove', shell.document.body, px(to));
  mouse(shell, 'mouseup', node, px(to));
  SigK.annotate.setTool(null);
  SigK.annotate.select(null);
  return SigK.viewer.getAnnotations().added.at(-1).id;
}

test('2 件以上なら見出しは「書き込み N 件（種類）」で、回転・文字の大きさ・対象の文字を隠し、ページとヒントを出し、削除を押せる（確定事項I1）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  const b = draw(shell, 'circle', [300, 700], [400, 600]);
  const c = draw(shell, 'square', [100, 500], [200, 400]);
  SigK.annotate.selectKeys([a, b, c]);
  assert.equal(document.getElementById('props-kind').textContent, '書き込み 3 件（四角・丸）');
  assert.equal(document.getElementById('props-angle-row').hidden, true);
  assert.equal(document.getElementById('props-size-row').hidden, true);
  assert.equal(document.getElementById('props-text-row').hidden, true);
  assert.equal(document.getElementById('props-page-row').hidden, false);
  assert.equal(document.getElementById('props-page').textContent, '1');
  assert.equal(document.getElementById('props-hint').textContent, SigK.annotationHints.HINTS.multi);
  assert.equal(document.getElementById('props-delete').hasAttribute('aria-disabled'), false);
  // 1 件に戻すと今までの出し方。
  SigK.annotate.select(a);
  assert.equal(document.getElementById('props-kind').textContent, '四角');
});

test('右パネルの「削除」で、選んだ全部を消す（確定事項H3）', async (t) => {
  const shell = await withShell(t);
  const { SigK, document } = shell;
  const a = draw(shell, 'square', [100, 700], [200, 600]);
  const b = draw(shell, 'square', [300, 700], [400, 600]);
  SigK.annotate.selectKeys([a, b]);
  document.getElementById('props-delete').click();
  assert.equal(SigK.viewer.getAnnotations().added.length, 0);
  assert.equal(document.getElementById('props-delete').getAttribute('aria-disabled'), 'true');
});

test('kindsOf は種類の名前を描く順に、重なりを除いてつなぐ', async (t) => {
  const shell = await withShell(t);
  const { annotationBulkProps } = shell.SigK;
  assert.equal(annotationBulkProps.kindsOf([{ kind: 'arrow' }, { kind: 'square' }, { kind: 'arrow' }, { kind: 'ink' }]), '矢印・四角・ペン');
});
