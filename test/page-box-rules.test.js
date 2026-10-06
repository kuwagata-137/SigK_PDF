'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName } = require('pdf-lib');
const rules = require('../worker/page-box-rules.js');

// ページの箱と、ページ木から受け継ぐ欄の決まり（spec-4b-6a 確定事項9・21〜23。事前調査 C）。

const TOOLS = { PDFName };

function boxOf(page, key) {
  const value = page.node.get(PDFName.of(key));
  return value === undefined ? undefined : page.node.context.lookup(value).asArray().map((item) => item.asNumber());
}

// 根 → 中間の /Pages（MediaBox・CropBox・Rotate を持つ）→ ページ count 枚、の木（事前調査 C の検体と同じ形）。
async function inheritedDoc(count = 2) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < count; index += 1)
    doc.addPage([600, 800]);
  const ctx = doc.context;
  const pages = doc.getPages();
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const mid = ctx.obj({ Type: 'Pages', Parent: rootRef, Kids: pages.map((page) => page.ref), Count: count,
    MediaBox: [0, 0, 600, 800], CropBox: [100, 200, 400, 600], Rotate: 90 });
  const midRef = ctx.register(mid);
  for (const page of pages) {
    page.node.delete(PDFName.of('MediaBox'));
    page.node.set(PDFName.of('Parent'), midRef);
  }
  doc.catalog.Pages().set(PDFName.of('Kids'), ctx.obj([midRef]));
  // 組んだばかりの中間のノードは素の辞書なので、書いて読み直してページ木として扱わせる。
  return PDFDocument.load(await doc.save());
}

test('normalizeBox は並べ直して小数 2 桁に丸め、sameBox は各辺 0.01pt まで同じと見なす', () => {
  assert.deepEqual(rules.normalizeBox([400, 600.004, 100, 200]), [100, 200, 400, 600]);
  assert.equal(rules.normalizeBox([1, 1, 1, 5]), null);
  assert.equal(rules.sameBox([0, 0, 10, 10], [0.01, 0, 10, 10]), true);
  assert.equal(rules.sameBox([0, 0, 10, 10], [0.02, 0, 10, 10]), false);
});

test('pushDownInherited は受け継いでいる MediaBox・CropBox・Rotate をページに直に写す', async () => {
  const doc = await inheritedDoc();
  const page = doc.getPages()[0];
  assert.equal(page.node.get(PDFName.of('MediaBox')), undefined);
  rules.pushDownInherited(page, TOOLS);
  assert.deepEqual(boxOf(page, 'MediaBox'), [0, 0, 600, 800]);
  assert.deepEqual(boxOf(page, 'CropBox'), [100, 200, 400, 600]);
  assert.equal(page.node.get(PDFName.of('Rotate')).asNumber(), 90);
});

test('pushDownInherited はページ自身が持っている欄には触れない', async () => {
  const doc = await inheritedDoc();
  const page = doc.getPages()[0];
  page.setCropBox(10, 20, 30, 40);
  rules.pushDownInherited(page, TOOLS);
  assert.deepEqual(boxOf(page, 'CropBox'), [10, 20, 40, 60]);
});

test('mediaBoxOf は受け継いだ MediaBox も読み、mediaBoxesOf はページ順に並べる', async () => {
  const doc = await inheritedDoc(2);
  assert.deepEqual(rules.mediaBoxOf(doc.getPages()[0]), [0, 0, 600, 800]);
  assert.deepEqual(rules.mediaBoxesOf(doc), [[0, 0, 600, 800], [0, 0, 600, 800]]);
});

test('applyCrop は MediaBox との重なりに収めて /CropBox を書く', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  assert.deepEqual(rules.applyCrop(page, [-50, 100, 300, 900], TOOLS), { ok: true, box: [0, 100, 300, 800] });
  assert.deepEqual(boxOf(page, 'CropBox'), [0, 100, 300, 800]);
});

test('applyCrop は MediaBox と同じなら /CropBox を消す', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.setCropBox(10, 10, 100, 100);
  assert.deepEqual(rules.applyCrop(page, [0, 0, 600, 800.004], TOOLS), { ok: true, box: null });
  assert.equal(page.node.get(PDFName.of('CropBox')), undefined);
});

test('applyCrop は消すと親の CropBox を受け継いでしまうなら、MediaBox と同じ値を直に書く', async () => {
  const doc = await inheritedDoc();
  const page = doc.getPages()[0];
  assert.deepEqual(rules.applyCrop(page, [0, 0, 600, 800], TOOLS), { ok: true, box: [0, 0, 600, 800] });
  assert.deepEqual(boxOf(page, 'CropBox'), [0, 0, 600, 800]);
});

test('applyCrop は重ならない・1pt 未満・形の違う値を断る', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  for (const crop of [[700, 0, 900, 100], [0, 0, 0.5, 100], [0, 0, 'a', 1], null])
    assert.match(rules.applyCrop(page, crop, TOOLS).error, /切り方が正しくありません/, JSON.stringify(crop));
  assert.equal(page.node.get(PDFName.of('CropBox')), undefined);
});

test('applyCrop は箱の値をそのまま書き、幅を足し戻す端数（559.1699999999998 など）を出さない', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  assert.deepEqual(rules.applyCrop(page, [39.81, 380.43, 559.17, 790.55], TOOLS), { ok: true, box: [39.81, 380.43, 559.17, 790.55] });
  assert.deepEqual(boxOf(page, 'CropBox'), [39.81, 380.43, 559.17, 790.55]);
});
