'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTextShell, clickAt, typeText, editorNode, placeCallout, plain } = require('./text-helpers.js');

// 吹き出しを置く・確定する・描く（spec-4b-4b 確定事項D3・D4・E6・F1・F2）。jsdom には canvas が無いので、字の幅は全角 1em・半角 0.5em。

test('吹き出しの道具で紙を押すと、枠の無い入力欄が開き、置いた直後のしっぽと本体を描く', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  SigK.annotate.setTool('callout');
  clickAt(shell, 100, 700);
  const node = editorNode(shell);
  assert.ok(node.classList.contains('callout'), '入力欄は破線の枠を出さない');
  assert.equal(node.style.background, '', '塗りは本体が描く');
  typeText(shell, '数量を確認');
  const body = document.querySelector('.annot-layer path.callout-outline');
  assert.ok(body !== null, '入力中も本体を描く');
  assert.equal(body.getAttribute('fill'), '#ffffff');
  assert.equal(body.getAttribute('stroke'), '#c00000');
});

test('確定すると、既定の書式と、本体の下・左寄りのしっぽの先を持つ吹き出しになる', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  assert.equal(entry.kind, 'text');
  assert.equal(entry.width, 'auto');
  assert.deepEqual([entry.color, entry.fill, entry.borderColor, entry.borderWidth, entry.fontSize], ['#222a35', '#ffffff', '#c00000', 1.5, 12]);
  const size = SigK.freeTextMetrics.sizeOf(entry);
  // 箱の左上 (100, 700) から右へ min(幅×0.25, 40)、下へ 高さ＋12×1.6。
  assert.deepEqual(plain(entry.callout.tip), [Math.round((100 + Math.min(size.width * 0.25, 40)) * 100) / 100, Math.round((700 - size.height - 19.2) * 100) / 100]);
  assert.equal(SigK.annotationPresets.kindOf(entry), 'callout');
});

test('吹き出しは本体の輪郭（path）と文字を描き、テキストの塗りと枠線の四角は描かない', async (t) => {
  const shell = await withTextShell(t);
  const { SigK, document } = shell;
  placeCallout(shell, 100, 700, '数量を確認');
  SigK.annotate.select(null);
  const group = document.querySelector('.annot-layer g[data-kind="text"]');
  const path = group.querySelector('path.callout-outline');
  assert.ok(path !== null);
  assert.ok(path.getAttribute('d').startsWith('M '));
  assert.equal((path.getAttribute('d').match(/C /g) ?? []).length, 4);
  assert.equal(path.getAttribute('stroke-linejoin'), 'round');
  assert.equal(group.querySelector('rect.free-text-fill'), null);
  assert.equal(group.querySelector('rect.free-text-border'), null);
  assert.equal(group.querySelectorAll('text').length, 1);
});

test('印刷の口は吹き出しの輪郭を塗って線を引いてから文字を描く', async (t) => {
  const shell = await withTextShell(t);
  const { SigK } = shell;
  const entry = placeCallout(shell, 100, 700, '数量を確認');
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push(name); },
    set: (_target, name, value) => { calls.push(`${name}=${value}`); return true; },
  });
  SigK.freeTextShape.paint(ctx, entry, SigK.viewer.getTextLayer(0).viewport);
  const fill = calls.indexOf('fill');
  const stroke = calls.indexOf('stroke');
  const text = calls.indexOf('fillText');
  assert.ok(calls.includes('bezierCurveTo'));
  assert.ok(fill >= 0 && stroke > fill && text > stroke, calls.join(' '));
  assert.equal(calls.includes('fillRect'), false);
});
