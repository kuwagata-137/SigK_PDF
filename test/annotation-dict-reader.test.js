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

  assert.deepEqual(at('0:Square@60,700'), { ca: 0.5, interior: null, stroke: [1, 0, 0], borderWidth: 2, borderStyle: 'S', dash: null, cloudy: false, cloudIntensity: null, rectDifference: null, rotation: null, blend: null });
  assert.equal(at('0:Circle@220,700').ca, 0.5);
  assert.equal(at('0:PolyLine@380,700').ca, 0.5);
  assert.equal(at('0:Text@540,760').ca, 0.5, 'ノートの不透明度も読める（pdf.js は返さない）');
  assert.deepEqual(at('0:Square@60,580').interior, [1, 1, 0]);
  assert.equal(at('0:Square@220,580').borderWidth, 0);
  assert.equal(at('0:Square@380,580').borderStyle, 'D');
  assert.deepEqual(at('0:Square@380,580').dash, [3, 2]);
  assert.equal(at('0:Circle@60,460').cloudy, true);
  assert.equal(at('0:Circle@60,460').cloudIntensity, 1, '雲形の強さ /BE /I（spec-4b-1b 確定事項38）');
  assert.deepEqual(at('0:Square@220,460').rectDifference, [5, 5, 5, 5]);
  assert.equal(at('0:PolyLine@380,494').borderWidth, 12, 'pdf.js が 1 に置き換える太い線も元の値で読める');
  // 2 ページ目（spec-4b-1b）: 強さ 2 の雲形と /RD、CMYK と灰の塗り、線の無い楕円。
  assert.equal(at('1:Square@60,600').cloudIntensity, 2);
  assert.deepEqual(at('1:Square@60,600').rectDifference, [10, 10, 10, 10]);
  assert.deepEqual(at('1:Square@300,600').interior, [0, 0, 1, 0]);
  assert.deepEqual(at('1:Circle@300,450').interior, [0.8]);
  assert.equal(at('1:Circle@300,450').stroke, null);
  assert.deepEqual(at('1:PolyLine@59,449').dash, [4, 2]);
  // 世代 1 の参照（3 ページ目）も読める。直に置いた辞書は id が無いので頼めない。
  assert.match(ids['0:Square@60,700'], /^\d+R$/);
  assert.match(ids['2:Square@60,700'], /^\d+R1$/);
  assert.equal(ids['2:Square@220,700'], 'direct');
  const gen1 = Object.entries(result.details).find(([id]) => /R1$/.test(id));
  assert.ok(gen1 !== undefined, '世代 1 の参照を読んだ');
  assert.equal(gen1[1].ca, 0.6);
  assert.equal(Object.values(ids).includes('direct'), true);
});

test('辞書でないもの・/Subtype の無いもの・無い番号は答えに入れず、読めなかった参照（unread）に並べる', async () => {
  const file = fixturePath('styled.pdf');
  // 1R は文書の目録など（注釈ではない）。99999R は無い。暗号化した文書で、辞書がオブジェクトストリームの中にあって読めないときも同じ
  // （spec-4b-5b 点検 4。レンダラーは口が答えなかったときと同じに扱う）。
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: ['1R', '99999R'] });
  assert.deepEqual(result, { ok: true, details: {}, unread: ['1R', '99999R'] });
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

// ---- 回した四角・丸（spec-4b-2 確定事項34） ----

const { buildEncryptedRotatedPdf } = require('./fixtures/rotated-shapes.js');

// ページごとの注釈の id（/Annots の並び）。
async function idsByPage(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map((page) => (page.node.Annots()?.asArray() ?? []).map((item) => `${item.objectNumber}R`));
}

function nearBox(actual, expected) {
  assert.ok(Array.isArray(actual) && actual.every((value, index) => Math.abs(value - expected[index]) <= 0.011), `${actual} ≠ ${expected}`);
}

test('rotated-shapes.pdf の SigK PDF の書き方で回した四角・丸は、箱と角度を返す', async () => {
  const file = fixturePath('rotated-shapes.pdf');
  const [page1] = await idsByPage(file);
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: page1 });
  const rotations = page1.map((id) => result.details[id].rotation);
  assert.deepEqual(rotations.map((rotation) => rotation.angle), [30, 45, 15, 300, 90]);
  nearBox(rotations[0].box, [60, 640, 220, 740]);
  nearBox(rotations[1].box, [320, 640, 500, 720]);
  nearBox(rotations[4].box, [200, 160, 400, 240]);
});

test('rotated-shapes.pdf の他のアプリの回転は、読めるものは箱と角度、読めないものは skewed を返す', async () => {
  const file = fixturePath('rotated-shapes.pdf');
  const [, readable, unreadable] = await idsByPage(file);
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: [...readable, ...unreadable] });
  const [p1, p3, p9, p10, p12, local] = readable.map((id) => result.details[id].rotation);
  for (const rotation of [p1, p3, p9, p10, p12, local])
    assert.equal(rotation.angle, 30);
  nearBox(p1.box, [60, 660, 210, 750]);
  nearBox(p3.box, [330, 660, 480, 750]);
  nearBox(p9.box, [60, 440, 210, 530]);
  nearBox(p10.box, [370, 480, 520, 570]);
  nearBox(p12.box, [58, 198, 212, 292]);
  nearBox(local.box, [330, 200, 480, 290]);
  const [p2, p4, p5, p6, p11, mirror] = unreadable.map((id) => result.details[id].rotation);
  assert.equal(p2, 'skewed', '外観の中身の cm で回したもの');
  assert.equal(p4, null, 'Polygon は回転を読まない');
  assert.equal(p5, null, '回っていない伸び縮みは今までどおり');
  assert.equal(p6, 'skewed', '/Rect が外接より広く、外観がゆがむもの');
  assert.equal(p11, 'skewed');
  assert.equal(mirror, 'skewed');
});

test('暗号化した PDF でも /BBox・/Matrix・/Rect から回転を読み、中身の cm は見分けない', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-details-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { bytes, box } = buildEncryptedRotatedPdf();
  const file = path.join(dir, 'rotated-encrypted.pdf');
  fs.writeFileSync(file, bytes);
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: ['7R', '9R'] });
  assert.equal(result.ok, true);
  assert.equal(result.details['7R'].rotation.angle, 30);
  nearBox(result.details['7R'].rotation.box, box);
  assert.equal(result.details['9R'].rotation, null, '暗号化された中身は読めないので、cm の回転は見分けない（既知の限界）');
});

test('直線・テキストなど四角・丸でないものは回転を返さない', async () => {
  const file = fixturePath('styled.pdf');
  const ids = await idsOf(file);
  const result = await runAnnotationDetails({ source: file, expect: expectOf(file), refs: [ids['0:PolyLine@380,700'], ids['0:Text@540,760']] });
  assert.equal(result.details[ids['0:PolyLine@380,700']].rotation, null);
  assert.equal(result.details[ids['0:Text@540,760']].rotation, null);
});

// ---- 自前の FreeText の回転（spec-4b-4b 確定事項H1・H2。事前調査 P） ----

const zlib = require('node:zlib');
const { PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource } = require('../worker/font-embed.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { pick } = require('../worker/pdf-tree-reader.js');

// 保存して読み直した 1 件目の FreeText の辞書と context。after(context, dict) で外観を他のアプリ風に書き換えられる。
async function savedFreeText(entry, after = null) {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const tools = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
  const result = await applyAnnotations(doc, { add: [entry] }, tools, { now: new Date(2026, 9, 2), fontSource: createFontSource({ fontkit }) });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });
  const saved = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const page = saved.getPages()[0];
  const dict = saved.context.lookup(saved.context.lookup(page.node.get(PDFName.of('Annots'))).get(0));
  if (after !== null)
    after(saved.context, dict);
  return detailsOf(dict, saved.context);
}

function freeText(rotation, extra = {}) {
  const rect = rotation % 180 === 0 ? [100, 600, 140, 616] : [100, 600, 116, 640];
  return { src: 0, kind: 'text', color: '#222a35', opacity: 1, rect, text: 'あいう', fontSize: 12, rotation, width: 'auto', lines: ['あいう'], inset: [2, 2], ...extra };
}

test('置いた向き 90°・270° の自前のテキストは、中身の 4 方向の cm を回転とも「ゆがみ」とも読まない', async () => {
  for (const rotation of [0, 90, 180, 270]) {
    assert.equal((await savedFreeText(freeText(rotation))).rotation, null, `新しい形 ${rotation}`);
    assert.equal((await savedFreeText(freeText(rotation, { opacity: 0.6 }))).rotation, null, `半透明 ${rotation}`);
    const legacy = freeText(rotation);
    delete legacy.width;
    delete legacy.lines;
    delete legacy.inset;
    assert.equal((await savedFreeText(legacy)).rotation, null, `今までの形 ${rotation}`);
  }
});

test('回した自前のテキストは、回す前の箱（/BBox のまま）と角度を返す', async () => {
  for (const [rotation, angle] of [[0, 30], [0, 359], [90, 30], [270, 200]]) {
    const entry = freeText(rotation, { angle });
    assert.deepEqual((await savedFreeText(entry)).rotation, { box: entry.rect, angle }, `置いた向き ${rotation}・${angle}°`);
  }
  const faded = freeText(0, { angle: 30, opacity: 0.6 });
  assert.deepEqual((await savedFreeText(faded)).rotation, { box: faded.rect, angle: 30 });
});

test('中身を 30° 回す・ゆがめる・裏返す他のアプリ風の FreeText は skewed', async () => {
  const foreign = (cm) => (context, dict) => {
    const ap = context.lookup(pick(dict, '/AP'));
    const stream = context.lookup(pick(ap, '/N'));
    const raw = Buffer.from(stream.getContents());
    const body = (pick(stream.dict, '/Filter') === undefined ? raw : zlib.inflateSync(raw)).toString('latin1');
    const fresh = context.stream(body.replace(/^q\r?\n/, `q\n${cm} cm\n`), {
      Type: 'XObject', Subtype: 'Form', BBox: context.lookup(pick(stream.dict, '/BBox')), Resources: stream.dict.get(PDFName.of('Resources')),
    });
    ap.set(PDFName.of('N'), context.register(fresh));
  };
  for (const cm of ['0.866 -0.5 0.5 0.866 0 0', '1 0 0.3 1 0 0', '0 1 1 0 0 0'])
    assert.equal((await savedFreeText(freeText(0), foreign(cm))).rotation, 'skewed', cm);
});

// 吹き出し（spec-4b-4b 確定事項H2）。回した吹き出しは、/BBox を /RD で縮めた箱をそのまま回す前の箱にする。
test('回した自前の吹き出しは、回す前の箱（/BBox を /RD で縮めたもの）と角度を返し、/IT と /CL も読む', async () => {
  const callout = (angle) => freeText(0, { fill: '#ffffff', borderColor: '#c00000', borderWidth: 1.5, callout: { tip: [80, 560] }, ...(angle ? { angle } : {}) });
  const plain = await savedFreeText(callout(0));
  assert.equal(plain.rotation, null);
  assert.equal(plain.intent, 'FreeTextCallout');
  assert.deepEqual(plain.calloutLine.slice(0, 2), [80, 560]);
  for (const angle of [30, 200, 359]) {
    const entry = callout(angle);
    assert.deepEqual((await savedFreeText(entry)).rotation, { box: entry.rect, angle }, `${angle}°`);
  }
});
