'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell, createPdfjsStub, makeSource } = require('./harness.js');

// 選んだ書き込みに 1 件ずつ当てて 1 つの annots にまとめる（spec-4b-3a 確定事項F・G・H）。画面の操作は annotate-grab.test.js などが見る。

const A = 'C:\\work\\a.pdf';

const IMPORTED = {
  0: [
    { id: '12R', subtype: 'Highlight', rect: [48, 300, 232, 310], quadPoints: [48, 310, 232, 310, 48, 300, 232, 300], color: new Uint8ClampedArray([255, 228, 90]), opacity: 1 },
    { id: '17R', subtype: 'Line', rect: [298, 298, 402, 312], color: new Uint8ClampedArray([255, 0, 0]), contentsObj: { str: '' }, titleObj: { str: '' }, lineCoordinates: [300, 300, 400, 310], lineEndings: ['None', 'None'] },
    { id: '40R', subtype: 'Square', rect: [399, 199, 501, 301], color: new Uint8ClampedArray([0, 0, 255]), borderStyle: { width: 2 }, hasAppearance: true },
  ],
};

async function withShell(t) {
  const shell = await createShell({
    pdfjs: createPdfjsStub({ annotations: IMPORTED }),
    files: { [A]: makeSource({ path: A, name: 'a.pdf' }) },
  });
  t.after(() => shell.cleanup());
  await shell.SigK.tabs.openPath(A);
  await shell.flush();
  await shell.SigK.annotationImport.settled();
  await shell.flush();
  return shell;
}

// 自前の四角を 1 つ足した annots と、その鍵。
function withOwnSquare(SigK) {
  const base = SigK.annotationState.findAnnot(SigK.viewer.getAnnotations(), SigK.viewer.getImported(), '40R');
  const annots = SigK.annotationState.addAnnot(SigK.viewer.getAnnotations(), { ...base, ref: undefined, id: 'own-1', rect: [100, 100, 200, 200], quads: [[100, 200, 200, 200, 100, 100, 200, 100]] });
  return { annots, key: 'own-1' };
}

test('updateEach は 1 件ずつ当て、自前のものは同じ鍵、読み込んだものは写しの新しい鍵を返す', async (t) => {
  const { SigK } = await withShell(t);
  const { annots, key } = withOwnSquare(SigK);
  const result = SigK.annotationBulk.updateEach(annots, SigK.viewer.getImported(), [key, '40R'], () => ({ color: '#00ff00' }));
  assert.equal(result.keys.get(key), key);
  const renamed = result.keys.get('40R');
  assert.notEqual(renamed, '40R');
  assert.ok(result.annots.removed.includes('40R'));
  for (const each of [key, renamed])
    assert.equal(SigK.annotationState.findAnnot(result.annots, SigK.viewer.getImported(), each).color, '#00ff00');
});

test('updateEach は当てる値が無いもの・断られたもの・表示のみを飛ばし、鍵はそのまま', async (t) => {
  const { SigK } = await withShell(t);
  const { annots, key } = withOwnSquare(SigK);
  const result = SigK.annotationBulk.updateEach(annots, SigK.viewer.getImported(), [key, '17R', 'gone'], (entry) => (entry.kind === 'square' ? null : { color: '#00ff00' }));
  assert.equal(result.annots, annots);
  assert.deepEqual(JSON.parse(JSON.stringify([...result.keys.entries()])), [[key, key], ['17R', '17R'], ['gone', 'gone']]);
});

test('removeEach は自前のものを外し、読み込んだもの（表示のみを含む）は removed に足す', async (t) => {
  const { SigK } = await withShell(t);
  const { annots, key } = withOwnSquare(SigK);
  const next = SigK.annotationBulk.removeEach(annots, SigK.viewer.getImported(), [key, '17R', '12R']);
  assert.equal(next.added.some((entry) => entry.id === key), false);
  assert.deepEqual([...next.removed].sort(), ['12R', '17R']);
});

test('copyEach は動かせるものだけを delta ずらして最後に足し、マークアップと表示のみは写さない（確定事項G3）', async (t) => {
  const { SigK } = await withShell(t);
  const { annots, key } = withOwnSquare(SigK);
  const result = SigK.annotationBulk.copyEach(annots, SigK.viewer.getImported(), ['12R', key, '17R', '40R'], [10, -10]);
  assert.equal(result.keys.length, 2);
  const copies = result.annots.added.slice(-2);
  assert.deepEqual([...copies.map((entry) => entry.id)], [...result.keys]);
  assert.deepEqual([...copies[0].rect], [110, 90, 210, 190]);
  assert.equal(copies[1].ref, undefined, '読み込んだものの参照は写さない');
  assert.ok(!result.annots.removed.includes('40R'), '元は残る');
});
