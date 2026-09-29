'use strict';

// 注釈の辞書を直に読む口（spec-4b-1a 確定事項20〜23）。検体 styled.pdf（他のアプリの見た目を持つ注釈）を読み、
// pdf.js が返さない欄（/CA・/IC・/BE・/RD）と、線の欄（/C・/BS）が読めることを見る。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument } = require('pdf-lib');
const { REFS_MAX, requestOf, runAnnotationDetails } = require('../worker/annotation-dict-reader.js');
const { runTask } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

// ファイルを開いたときの控え（画面の state.file と同じ形）。
function expectOf(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

// 検体の注釈を「ページ:種類@左下」で引ける id（pdf.js と同じ 12R・12R1 の形）にする。直に置いた辞書は 'direct'。
async function idsOf(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  const ids = {};
  for (const [pageIndex, page] of doc.getPages().entries()) {
    const annots = page.node.Annots();
    for (const item of annots?.asArray() ?? []) {
      const dict = doc.context.lookup(item);
      const rect = dict.lookup(doc.context.obj('Rect'))?.asArray?.().map((value) => value.asNumber()) ?? [];
      const subtype = String(dict.get(doc.context.obj('Subtype'))).slice(1);
      const key = `${pageIndex}:${subtype}@${rect[0]},${rect[1]}`;
      ids[key] = typeof item.objectNumber === 'number' ? `${item.objectNumber}R${item.generationNumber === 0 ? '' : item.generationNumber}` : 'direct';
    }
  }
  return ids;
}

test('requestOf は spec の形を確かめ、同じ id は 1 つにまとめる', () => {
  const expect = { size: 10, mtimeMs: 1 };
  assert.deepEqual(requestOf({ source: 'a.pdf', expect, refs: ['12R', '12R', '52R1'] }), { source: 'a.pdf', expect, refs: ['12R', '52R1'] });
  assert.equal(requestOf(null), null);
  assert.equal(requestOf({ source: '', expect, refs: ['12R'] }), null);
  assert.equal(requestOf({ source: 'a.pdf', expect: { size: -1, mtimeMs: 1 }, refs: ['12R'] }), null);
  assert.equal(requestOf({ source: 'a.pdf', expect: { size: 1 }, refs: ['12R'] }), null);
  assert.equal(requestOf({ source: 'a.pdf', expect, refs: [] }), null);
  assert.equal(requestOf({ source: 'a.pdf', expect, refs: ['annot_p1_1'] }), null, '直に置いた辞書の id は読めない');
  assert.equal(requestOf({ source: 'a.pdf', expect, refs: Array.from({ length: REFS_MAX + 1 }, (_, index) => `${index + 1}R`) }), null);
});

test('styled.pdf の不透明度・塗り・線幅 0・破線・雲形・/RD・太い線・世代 1 の参照を読む', async () => {
  const file = fixturePath('styled.pdf');
  const ids = await idsOf(file);
  const refs = Object.values(ids).filter((id) => id !== 'direct');
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs });
  assert.equal(result.ok, true);
  const at = (key) => result.details[ids[key]];

  assert.deepEqual(at('0:Square@60,700'), { ca: 0.5, interior: null, stroke: [1, 0, 0], borderWidth: 2, borderStyle: 'S', dash: null, cloudy: false, rectDifference: null });
  assert.equal(at('0:Circle@220,700').ca, 0.5);
  assert.equal(at('0:PolyLine@380,700').ca, 0.5);
  assert.equal(at('0:Text@540,760').ca, 0.5, 'ノートの不透明度も読める（pdf.js は返さない）');
  assert.deepEqual(at('0:Square@60,580').interior, [1, 1, 0]);
  assert.equal(at('0:Square@220,580').borderWidth, 0);
  assert.equal(at('0:Square@380,580').borderStyle, 'D');
  assert.deepEqual(at('0:Square@380,580').dash, [3, 2]);
  assert.equal(at('0:Circle@60,460').cloudy, true);
  assert.deepEqual(at('0:Square@220,460').rectDifference, [5, 5, 5, 5]);
  assert.equal(at('0:PolyLine@380,494').borderWidth, 12, 'pdf.js が 1 に置き換える太い線も元の値で読める');
  // 世代 1 の参照（3 ページ目）も読める。直に置いた辞書は id が無いので頼めない。
  assert.match(ids['0:Square@60,700'], /^\d+R$/);
  assert.match(ids['2:Square@60,700'], /^\d+R1$/);
  assert.equal(ids['2:Square@220,700'], 'direct');
  const gen1 = Object.entries(result.details).find(([id]) => /R1$/.test(id));
  assert.ok(gen1 !== undefined, '世代 1 の参照を読んだ');
  assert.equal(gen1[1].ca, 0.6);
  assert.equal(Object.values(ids).includes('direct'), true);
});

test('辞書でないもの・/Subtype の無いもの・無い番号は答えに入れない', async () => {
  const file = fixturePath('styled.pdf');
  // 1R は文書の目録など（注釈ではない）。99999R は無い。
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: ['1R', '99999R'] });
  assert.deepEqual(result, { ok: true, details: {} });
});

test('開いたあとで大きさか更新時刻が変わっていれば読まない（changed）', async () => {
  const file = fixturePath('styled.pdf');
  const expect = expectOf(file);
  assert.deepEqual(await runAnnotationDetails({ source: file, expect: { ...expect, size: expect.size + 1 }, refs: ['12R'] }), { ok: false, reason: 'changed' });
  assert.deepEqual(await runAnnotationDetails({ source: file, expect: { ...expect, mtimeMs: expect.mtimeMs - 1000 }, refs: ['12R'] }), { ok: false, reason: 'changed' });
});

test('読めないファイルは unreadable、崩れた spec は invalid を返す', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-details-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const broken = path.join(dir, 'broken.pdf');
  fs.writeFileSync(broken, 'PDF ではない');
  assert.deepEqual(await runAnnotationDetails({ source: broken, expect: expectOf(broken), refs: ['12R'] }), { ok: false, reason: 'unreadable' });
  const missing = path.join(dir, 'missing.pdf');
  assert.deepEqual(await runAnnotationDetails({ source: missing, expect: { size: 1, mtimeMs: 1 }, refs: ['12R'] }), { ok: false, reason: 'unreadable' });
  assert.deepEqual(await runAnnotationDetails({ source: broken, refs: ['12R'] }), { ok: false, reason: 'invalid' });
});

test('暗号化された PDF も開いて読める（ignoreEncryption。数の欄は暗号化されない）', async () => {
  const file = fixturePath('encrypted.pdf');
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: ['1R'] });
  assert.equal(result.ok, true);
});

test('ワーカーの入口（runTask）は annotation-details を読み戻しへ回し、進捗を送らない', async () => {
  const file = fixturePath('styled.pdf');
  const sent = [];
  const result = await runTask({ kind: 'annotation-details', source: file, expect: expectOf(file), refs: ['12R'] }, { send: (message) => sent.push(message) });
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.ms));
  assert.deepEqual(sent, []);
});
