'use strict';

// 注釈を /Annots へ書く・から外す層（spec-4-1 確定事項22〜27、spec-4-2 確定事項22〜26）。
//
// 書いた結果は保存して読み直してから見る。組み立て途中の状態ではなく
// 「ファイルとして」正しいかを確かめるためである（op-extract.test.js と同じ流儀）。

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { parseRef, applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource, FONT_ERROR } = require('../worker/font-embed.js');
const { pick } = require('../worker/pdf-tree-reader.js');

const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 8, 15, 12, 0, 0);
const fontSource = createFontSource({ fontkit });

// /M の時差は実行環境の時間帯で変わる（手元は +09'00'、CI は UTC で +00'00'）ので、期待値は NOW から組む。
function zoneOf(date) {
  const offset = -date.getTimezoneOffset();
  const pad = (value) => String(Math.abs(value)).padStart(2, '0');
  return `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}'${pad(Math.abs(offset) % 60)}'`;
}

const QUAD = [48, 753, 232, 753, 48, 743, 232, 743];
const RECT = [48, 743, 232, 753];

function markup(overrides = {}) {
  return { src: 0, kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [QUAD], rect: RECT, ...overrides };
}

async function makeDoc(pageCount) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1)
    doc.addPage([595.28, 841.89]);
  return doc;
}

async function roundTrip(doc) {
  const bytes = await doc.save({ addDefaultPage: false });
  return PDFDocument.load(bytes, { updateMetadata: false });
}

// ページの /Annots を { ref, dict } の並びで読む。
function annotsOf(doc, pageIndex) {
  const page = doc.getPages()[pageIndex];
  const annots = doc.context.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined)
    return [];
  return annots.asArray().map((ref) => ({ ref, dict: doc.context.lookup(ref) }));
}

function nameOf(dict, key) {
  return pick(dict, key)?.asString?.() ?? null;
}

function numbersOf(doc, value) {
  return doc.context.lookup(value).asArray().map((item) => item.asNumber());
}

test('parseRef は pdf.js の id を番号と世代に読む', () => {
  assert.deepEqual(parseRef('86R'), { num: 86, gen: 0 });
  assert.deepEqual(parseRef('86R2'), { num: 86, gen: 2 });
  assert.equal(parseRef('R'), null);
  assert.equal(parseRef('sigk-1'), null);
  assert.equal(parseRef(undefined), null);
});

test('add で /Annots に辞書と外観が入る', async () => {
  const doc = await makeDoc(2);
  const result = await applyAnnotations(doc, { add: [markup(), markup({ src: 1, kind: 'underline', color: '#d92c2c' })] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 2, removed: 0 });

  const saved = await roundTrip(doc);
  const first = annotsOf(saved, 0);
  assert.equal(first.length, 1);
  const dict = first[0].dict;
  assert.equal(nameOf(dict, '/Subtype'), '/Highlight');
  assert.equal(nameOf(dict, '/Type'), '/Annot');
  assert.deepEqual(numbersOf(saved, pick(dict, '/QuadPoints')), QUAD);
  assert.deepEqual(numbersOf(saved, pick(dict, '/Rect')), RECT);
  assert.deepEqual(numbersOf(saved, pick(dict, '/C')).map((v) => Math.round(v * 100) / 100), [1, 0.89, 0.35]);
  assert.equal(pick(dict, '/F').asNumber(), 4);
  assert.match(pick(dict, '/NM').decodeText(), /^sigk-[0-9a-z]+-1$/);
  assert.equal(pick(dict, '/M').decodeText(), `D:20260915120000${zoneOf(NOW)}`);
  // 外観は Form XObject で、ハイライトは Multiply。
  const ap = saved.context.lookup(pick(dict, '/AP'));
  const normal = saved.context.lookup(pick(ap, '/N'));
  assert.equal(nameOf(normal.dict, '/Subtype'), '/Form');
  const gs = saved.context.lookup(pick(saved.context.lookup(pick(normal.dict, '/Resources')), '/ExtGState'));
  assert.equal(nameOf(saved.context.lookup(pick(gs, '/GS')), '/BM'), '/Multiply');
  assert.match(Buffer.from(normal.contents).toString('latin1'), /re f$/);

  const second = annotsOf(saved, 1);
  assert.equal(nameOf(second[0].dict, '/Subtype'), '/Underline');
  const ap2 = saved.context.lookup(pick(second[0].dict, '/AP'));
  const gs2 = saved.context.lookup(pick(saved.context.lookup(pick(saved.context.lookup(pick(ap2, '/N')).dict, '/Resources')), '/ExtGState'));
  assert.equal(pick(saved.context.lookup(pick(gs2, '/GS')), '/BM'), undefined);
});

test('既に /Annots があるページには後ろに足す', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [markup()] }, TOOLS, { now: NOW });
  await applyAnnotations(doc, { add: [markup({ kind: 'strikeout', color: '#000000' })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  assert.deepEqual(annotsOf(saved, 0).map((a) => nameOf(a.dict, '/Subtype')), ['/Highlight', '/StrikeOut']);
});

test('remove は pdf.js の id で外し、外観ごと消えて孤児が残らない', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [markup(), markup({ kind: 'underline', color: '#d92c2c' })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const before = annotsOf(saved, 0);
  const objectsBefore = saved.context.enumerateIndirectObjects().length;
  const id = `${before[0].ref.objectNumber}R`;

  const result = await applyAnnotations(saved, { remove: [id, '9999R'] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 0, removed: 1 });
  const again = await roundTrip(saved);
  const after = annotsOf(again, 0);
  assert.equal(after.length, 1);
  assert.equal(nameOf(after[0].dict, '/Subtype'), '/Underline');
  // 辞書と外観の 2 つが減る。
  assert.equal(again.context.enumerateIndirectObjects().length, objectsBefore - 2);
});

test('remove は /Popup を持つ注釈のポップアップも一緒に外す', async () => {
  const doc = await makeDoc(1);
  const page = doc.getPages()[0];
  const context = doc.context;
  const popupRef = context.register(context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 100, 100], Open: false }));
  const annotRef = context.register(context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: RECT, QuadPoints: QUAD, C: [1, 1, 0], Popup: popupRef }));
  context.lookup(popupRef).set(PDFName.of('Parent'), annotRef);
  page.node.set(PDFName.of('Annots'), context.obj([annotRef, popupRef]));
  const saved = await roundTrip(doc);
  const id = `${annotsOf(saved, 0)[0].ref.objectNumber}R`;

  const result = await applyAnnotations(saved, { remove: [id] }, TOOLS, { now: NOW });
  assert.equal(result.removed, 1);
  const again = await roundTrip(saved);
  assert.deepEqual(annotsOf(again, 0), []);
});

test('remove で消し、同じ保存で add も足せる', async () => {
  const doc = await makeDoc(2);
  await applyAnnotations(doc, { add: [markup()] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const id = `${annotsOf(saved, 0)[0].ref.objectNumber}R`;
  const result = await applyAnnotations(saved, { add: [markup({ src: 1 })], remove: [id] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 1 });
  const again = await roundTrip(saved);
  assert.equal(annotsOf(again, 0).length, 0);
  assert.equal(annotsOf(again, 1).length, 1);
});

test('形が違えば何も書かずに断る', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(await applyAnnotations(doc, { add: [markup({ src: 3 })] }, TOOLS), { error: '注釈 1 のページ番号が文書に合いません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [markup(), markup({ kind: 'stamp' })] }, TOOLS), { error: '注釈 2 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { remove: ['abc'] }, TOOLS), { error: '消す注釈の指定が読めません。' });
  assert.deepEqual(annotsOf(await roundTrip(doc), 0), []);
});

test('何も無ければ何もしない', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(await applyAnnotations(doc, {}, TOOLS), { ok: true, added: 0, removed: 0 });
  assert.deepEqual(await applyAnnotations(doc, undefined, TOOLS), { ok: true, added: 0, removed: 0 });
});

// ---- フリーテキスト（spec-4-2 確定事項22〜26） ----

const TEXT_RECT = [100, 700, 200, 720.5];

function text(overrides = {}) {
  return { src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: TEXT_RECT, text: 'こんにちは\n世界', fontSize: 12, rotation: 0, ...overrides };
}

// /Type0 のフォント辞書を集める。
function type0FontsOf(doc) {
  const fonts = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.get?.(PDFName.of('Subtype'))?.encodedName === '/Type0')
      fonts.push(obj);
  }
  return fonts;
}

function contentOf(doc, stream) {
  const filter = stream.dict.get(PDFName.of('Filter'))?.encodedName;
  const bytes = filter === '/FlateDecode' ? zlib.inflateSync(Buffer.from(stream.contents)) : Buffer.from(stream.contents);
  return bytes.toString('latin1');
}

test('text は FreeText の辞書と外観・フォントのサブセット付きで書かれる', async () => {
  const doc = await makeDoc(1);
  const result = await applyAnnotations(doc, { add: [text()] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });

  const saved = await roundTrip(doc);
  const [{ dict }] = annotsOf(saved, 0);
  assert.equal(nameOf(dict, '/Subtype'), '/FreeText');
  assert.equal(nameOf(dict, '/Type'), '/Annot');
  // /Rect は表示の右へ 1pt 伸びる（確定事項14・18）
  assert.deepEqual(numbersOf(saved, pick(dict, '/Rect')), [100, 700, 201, 720.5]);
  // /Contents は UTF-16BE で改行のまま
  assert.ok(pick(dict, '/Contents') instanceof PDFHexString);
  assert.equal(pick(dict, '/Contents').decodeText(), 'こんにちは\n世界');
  assert.equal(pick(dict, '/DA').decodeText(), '/SigKJP 12 Tf 0.11 0.14 0.19 rg');
  assert.deepEqual(numbersOf(saved, pick(dict, '/Border')), [0, 0, 0]);
  assert.equal(pick(dict, '/Rotate'), undefined);
  assert.equal(pick(dict, '/F').asNumber(), 4);
  assert.equal(pick(dict, '/CA').asNumber(), 1);
  assert.match(pick(dict, '/NM').decodeText(), /^sigk-[0-9a-z]+-1$/);
  assert.equal(pick(dict, '/M').decodeText(), `D:20260915120000${zoneOf(NOW)}`);
  // 書かないもの
  for (const key of ['/C', '/QuadPoints', '/DS', '/RC', '/IT', '/Q'])
    assert.equal(pick(dict, key), undefined, key);

  // 外観は Form XObject。Resources にフォントが付き、content は cm → clip → BT … Tj … ET
  const normal = saved.context.lookup(pick(saved.context.lookup(pick(dict, '/AP')), '/N'));
  assert.equal(nameOf(normal.dict, '/Subtype'), '/Form');
  assert.deepEqual(numbersOf(saved, pick(normal.dict, '/BBox')), [100, 700, 201, 720.5]);
  const resources = saved.context.lookup(pick(normal.dict, '/Resources'));
  const fontDict = saved.context.lookup(pick(saved.context.lookup(pick(resources, '/Font')), '/SigKJP'));
  assert.equal(nameOf(fontDict, '/Subtype'), '/Type0');
  assert.match(nameOf(fontDict, '/BaseFont'), /^\/[A-Z]{6}\+NotoSansJP-Regular$/);
  const content = contentOf(saved, normal);
  assert.match(content, /^q\n\/GS gs\n1 0 0 1 0 0 cm\n100 700 101 20.5 re W n\nBT\n/);
  assert.match(content, /\/SigKJP 12 Tf\n15 TL\n102 705.77 Td\n<[0-9a-f]{20}> Tj\nT\*\n<[0-9a-f]{8}> Tj\nET\nQ$/i);
  // フォントは 1 つ（サブセット。FontFile2 が付く）
  const fonts = type0FontsOf(saved);
  assert.equal(fonts.length, 1);
  const descendant = saved.context.lookup(saved.context.lookup(fonts[0].get(PDFName.of('DescendantFonts'))).get(0));
  const descriptor = saved.context.lookup(descendant.get(PDFName.of('FontDescriptor')));
  assert.ok(descriptor.get(PDFName.of('FontFile2')) !== undefined);
});

test('回転した表示で置いた text は /Rotate と cm を持つ', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [text({ rect: [40, 100, 79, 300], rotation: 90, fontSize: 14 })] }, TOOLS, { now: NOW, fontSource });
  const saved = await roundTrip(doc);
  const [{ dict }] = annotsOf(saved, 0);
  assert.equal(pick(dict, '/Rotate').asNumber(), 90);
  assert.deepEqual(numbersOf(saved, pick(dict, '/Rect')), [40, 100, 79, 301]);
  const normal = saved.context.lookup(pick(saved.context.lookup(pick(dict, '/AP')), '/N'));
  assert.match(contentOf(saved, normal), /\n0 1 -1 0 0 0 cm\n100 -79 201 39 re W n\n/);
});

test('1 回の保存で text が何個あってもフォントは 1 つ。text が無ければ埋めない', async () => {
  const doc = await makeDoc(2);
  const result = await applyAnnotations(doc, { add: [text(), text({ src: 1, text: 'abc' }), markup()] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 3, removed: 0 });
  const saved = await roundTrip(doc);
  assert.equal(type0FontsOf(saved).length, 1);
  assert.deepEqual(annotsOf(saved, 0).map((a) => nameOf(a.dict, '/Subtype')), ['/FreeText', '/Highlight']);

  const plain = await makeDoc(1);
  await applyAnnotations(plain, { add: [markup()] }, TOOLS, { now: NOW, fontSource });
  assert.equal(type0FontsOf(await roundTrip(plain)).length, 0);
});

test('2 回目の保存では別のサブセットが 1 つ増え、前の注釈は触らない（確定事項24）', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [text()] }, TOOLS, { now: NOW, fontSource });
  const saved = await roundTrip(doc);
  await applyAnnotations(saved, { add: [text({ text: 'さようなら', rect: [100, 600, 200, 620.5] })] }, TOOLS, { now: NOW, fontSource });
  const again = await roundTrip(saved);
  const fonts = type0FontsOf(again);
  assert.equal(fonts.length, 2);
  assert.notEqual(nameOf(fonts[0], '/BaseFont'), nameOf(fonts[1], '/BaseFont'));
  assert.deepEqual(annotsOf(again, 0).map((a) => pick(a.dict, '/Contents').decodeText()), ['こんにちは\n世界', 'さようなら']);
});

test('フォントを読めなければ text のある保存だけ断り、何も書かない', async () => {
  const doc = await makeDoc(1);
  const broken = createFontSource({ fsLike: { readFileSync: () => { throw new Error('ENOENT'); } }, fontkit });
  assert.deepEqual(await applyAnnotations(doc, { add: [markup(), text()] }, TOOLS, { now: NOW, fontSource: broken }), { error: FONT_ERROR });
  assert.deepEqual(await applyAnnotations(doc, { add: [text()] }, TOOLS, { now: NOW }), { error: FONT_ERROR });
  assert.deepEqual(annotsOf(await roundTrip(doc), 0), []);
  // マークアップだけなら読めなくても通る
  assert.deepEqual(await applyAnnotations(doc, { add: [markup()] }, TOOLS, { now: NOW, fontSource: broken }), { ok: true, added: 1, removed: 0 });
});

test('text の形が違えば断る', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(await applyAnnotations(doc, { add: [text({ text: '' })] }, TOOLS, { now: NOW, fontSource }), { error: '注釈 1 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [text({ rotation: 45 })] }, TOOLS, { now: NOW, fontSource }), { error: '注釈 1 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [markup(), text({ fontSize: 0 })] }, TOOLS, { now: NOW, fontSource }), { error: '注釈 2 の形が読めません。' });
  assert.equal(type0FontsOf(doc).length, 0);
});

test('text を remove で消すと辞書と外観は消え、フォントは残る', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [text()] }, TOOLS, { now: NOW, fontSource });
  const saved = await roundTrip(doc);
  const id = `${annotsOf(saved, 0)[0].ref.objectNumber}R`;
  const result = await applyAnnotations(saved, { remove: [id] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 0, removed: 1 });
  const again = await roundTrip(saved);
  assert.deepEqual(annotsOf(again, 0), []);
  assert.equal(type0FontsOf(again).length, 1);
});

// ---- 図形・ペン（spec-4-3 確定事項20〜23） ----

function shape(overrides = {}) {
  return { src: 0, kind: 'square', color: '#d92c2c', opacity: 1, rect: [100, 600, 300, 700], lineWidth: 2, ...overrides };
}

function arrow(overrides = {}) {
  return { src: 0, kind: 'arrow', color: '#2c5cd9', opacity: 1, rect: [98.5, 543.55, 301.5, 601.5], lineWidth: 3, paths: [[[100, 600], [300, 550]]], ...overrides };
}

function ink(overrides = {}) {
  return { src: 1, kind: 'ink', color: '#2f9e5a', opacity: 1, rect: [99, 479, 151, 511], lineWidth: 2, paths: [[[100, 500], [120, 480], [150, 510]]], ...overrides };
}

test('図形は Square・Circle・PolyLine・Ink の辞書と外観で書かれ、フォントは埋めない', async () => {
  const doc = await makeDoc(2);
  const result = await applyAnnotations(doc, { add: [shape(), shape({ kind: 'circle' }), arrow({ kind: 'line', rect: [98.5, 548.5, 301.5, 601.5] }), arrow(), ink()] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 5, removed: 0 });

  const saved = await roundTrip(doc);
  const first = annotsOf(saved, 0);
  assert.deepEqual(first.map(({ dict }) => nameOf(dict, '/Subtype')), ['/Square', '/Circle', '/PolyLine', '/PolyLine']);
  const [square, circle, line, arrowDict] = first.map(({ dict }) => dict);
  // 共通の欄
  for (const dict of [square, circle, line, arrowDict]) {
    assert.equal(nameOf(dict, '/Type'), '/Annot');
    assert.equal(pick(dict, '/F').asNumber(), 4);
    assert.equal(pick(dict, '/CA').asNumber(), 1);
    assert.equal(pick(dict, '/Contents').decodeText(), '');
    assert.match(pick(dict, '/NM').decodeText(), /^sigk-[0-9a-z]+-\d$/);
    assert.equal(pick(dict, '/M').decodeText(), `D:20260915120000${zoneOf(NOW)}`);
    const bs = saved.context.lookup(pick(dict, '/BS'));
    assert.equal(nameOf(bs, '/S'), '/S');
    for (const key of ['/IC', '/L', '/QuadPoints', '/IT', '/DA'])
      assert.equal(pick(dict, key), undefined, key);
  }
  // 矩形: /Rect は箱そのもの、/C は線の色、/BS /W と /Border は線幅
  assert.deepEqual(numbersOf(saved, pick(square, '/Rect')), [100, 600, 300, 700]);
  assert.deepEqual(numbersOf(saved, pick(square, '/C')).map((v) => Math.round(v * 100) / 100), [0.85, 0.17, 0.17]);
  assert.equal(pick(saved.context.lookup(pick(square, '/BS')), '/W').asNumber(), 2);
  assert.deepEqual(numbersOf(saved, pick(square, '/Border')), [0, 0, 2]);
  const squareAp = saved.context.lookup(pick(saved.context.lookup(pick(square, '/AP')), '/N'));
  assert.equal(nameOf(squareAp.dict, '/Subtype'), '/Form');
  assert.deepEqual(numbersOf(saved, pick(squareAp.dict, '/BBox')), [100, 600, 300, 700]);
  assert.equal(contentOf(saved, squareAp), '/GS gs\n0.85 0.17 0.17 RG\n2 w 101 601 198 98 re S');
  assert.equal(pick(saved.context.lookup(pick(squareAp.dict, '/Resources')), '/Font'), undefined);
  // 楕円
  assert.match(contentOf(saved, saved.context.lookup(pick(saved.context.lookup(pick(circle, '/AP')), '/N'))), /c\nh S$/);
  // 直線: /Vertices は向きのまま、/LE は無し
  assert.deepEqual(numbersOf(saved, pick(line, '/Vertices')), [100, 600, 300, 550]);
  assert.equal(pick(line, '/LE'), undefined);
  assert.deepEqual(numbersOf(saved, pick(line, '/Rect')), [98.5, 548.5, 301.5, 601.5]);
  // 矢印: /LE は終点だけ OpenArrow
  assert.deepEqual(numbersOf(saved, pick(arrowDict, '/Vertices')), [100, 600, 300, 550]);
  assert.deepEqual(saved.context.lookup(pick(arrowDict, '/LE')).asArray().map((name) => name.asString()), ['/None', '/OpenArrow']);
  assert.equal(pick(saved.context.lookup(pick(arrowDict, '/BS')), '/W').asNumber(), 3);
  assert.match(contentOf(saved, saved.context.lookup(pick(saved.context.lookup(pick(arrowDict, '/AP')), '/N'))), /^\/GS gs\n0\.17 0\.36 0\.85 RG\n3 w 1 J 1 j\n100 600 m 300 550 l S\n[\d.]+ [\d.]+ m 300 550 l [\d.]+ [\d.]+ l S$/);
  // ペン（2 ページ目）: /InkList は path ごとの平たい並び
  const [{ dict: inkDict }] = annotsOf(saved, 1);
  assert.equal(nameOf(inkDict, '/Subtype'), '/Ink');
  const inkList = saved.context.lookup(pick(inkDict, '/InkList')).asArray();
  assert.equal(inkList.length, 1);
  assert.deepEqual(numbersOf(saved, inkList[0]), [100, 500, 120, 480, 150, 510]);
  assert.equal(contentOf(saved, saved.context.lookup(pick(saved.context.lookup(pick(inkDict, '/AP')), '/N'))), '/GS gs\n0.18 0.62 0.35 RG\n2 w 1 J 1 j\n100 500 m 120 480 l 150 510 l S');
  // フォントは埋まらない
  assert.equal(type0FontsOf(saved).length, 0);
});

test('図形とテキストを同じ保存で足すとフォントは 1 つで、図形の外観にフォントは付かない', async () => {
  const doc = await makeDoc(1);
  const result = await applyAnnotations(doc, { add: [shape(), text()] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 2, removed: 0 });
  const saved = await roundTrip(doc);
  assert.equal(type0FontsOf(saved).length, 1);
  const [{ dict }] = annotsOf(saved, 0);
  const normal = saved.context.lookup(pick(saved.context.lookup(pick(dict, '/AP')), '/N'));
  assert.equal(pick(saved.context.lookup(pick(normal.dict, '/Resources')), '/Font'), undefined);
});

test('図形の形が違えば何も書かずに断る', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(await applyAnnotations(doc, { add: [shape({ lineWidth: 0 })] }, TOOLS), { error: '注釈 1 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [arrow({ paths: [[[1, 2]]] })] }, TOOLS), { error: '注釈 1 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [shape(), ink({ src: 0, paths: [] })] }, TOOLS), { error: '注釈 2 の形が読めません。' });
  assert.equal(annotsOf(await roundTrip(doc), 0).length, 0);
});

test('図形を remove で消すと辞書と外観が消える', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [arrow()] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const [{ ref }] = annotsOf(saved, 0);
  const result = await applyAnnotations(saved, { remove: [`${ref.objectNumber}R`] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 0, removed: 1 });
  const again = await roundTrip(saved);
  assert.equal(annotsOf(again, 0).length, 0);
  let forms = 0;
  for (const [, obj] of again.context.enumerateIndirectObjects()) {
    if (obj?.dict?.get?.(PDFName.of('Subtype'))?.encodedName === '/Form')
      forms += 1;
  }
  assert.equal(forms, 0);
});

// ---- ノート（spec-4-4 確定事項23〜27） ----

const NOTE_RECT = [100, 680, 120, 700];

function note(overrides = {}) {
  return { src: 0, kind: 'note', color: '#ffe45a', opacity: 1, rect: NOTE_RECT, text: 'メモ\n2 行目', author: '総務', ...overrides };
}

function extGStateOf(saved, dict) {
  const ap = saved.context.lookup(pick(dict, '/AP'));
  const normal = saved.context.lookup(pick(ap, '/N'));
  const resources = saved.context.lookup(pick(normal.dict, '/Resources'));
  const gs = saved.context.lookup(pick(saved.context.lookup(pick(resources, '/ExtGState')), '/GS'));
  return { normal, resources, gs };
}

test('note は /Text の辞書と外観、/Popup 付きで書かれ、フォントは埋めない', async () => {
  const doc = await makeDoc(1);
  const result = await applyAnnotations(doc, { add: [note()] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });

  const saved = await roundTrip(doc);
  const annots = annotsOf(saved, 0);
  assert.deepEqual(annots.map((a) => nameOf(a.dict, '/Subtype')), ['/Text', '/Popup']);
  const [text, popup] = annots;
  assert.equal(nameOf(text.dict, '/Type'), '/Annot');
  assert.deepEqual(numbersOf(saved, pick(text.dict, '/Rect')), NOTE_RECT);
  assert.equal(pick(text.dict, '/Contents').decodeText(), 'メモ\n2 行目');
  assert.equal(pick(text.dict, '/T').decodeText(), '総務');
  assert.deepEqual(numbersOf(saved, pick(text.dict, '/C')).map((v) => Math.round(v * 100) / 100), [1, 0.89, 0.35]);
  assert.equal(pick(text.dict, '/CA').asNumber(), 1);
  assert.equal(pick(text.dict, '/F').asNumber(), 28);
  assert.equal(nameOf(text.dict, '/Name'), '/Comment');
  assert.equal(pick(text.dict, '/Open').asBoolean(), false);
  assert.equal(pick(text.dict, '/CreationDate').decodeText(), `D:20260915120000${zoneOf(NOW)}`);
  assert.equal(pick(text.dict, '/M').decodeText(), `D:20260915120000${zoneOf(NOW)}`);
  assert.match(pick(text.dict, '/NM').decodeText(), /^sigk-[0-9a-z]+-1$/);
  assert.equal(pick(text.dict, '/Popup').objectNumber, popup.ref.objectNumber);
  // ポップアップは親を指し、アイコンの右隣に閉じた状態で置く。
  assert.equal(nameOf(popup.dict, '/Type'), '/Annot');
  assert.equal(pick(popup.dict, '/Parent').objectNumber, text.ref.objectNumber);
  assert.deepEqual(numbersOf(saved, pick(popup.dict, '/Rect')), [122, 600, 302, 700]);
  assert.equal(pick(popup.dict, '/Open').asBoolean(), false);
  assert.equal(pick(popup.dict, '/F').asNumber(), 28);
  assert.equal(pick(popup.dict, '/AP'), undefined);
  // 外観は塗って線を引く Form XObject で、フォントは付かない。
  const { normal, resources, gs } = extGStateOf(saved, text.dict);
  assert.equal(nameOf(normal.dict, '/Subtype'), '/Form');
  assert.deepEqual(numbersOf(saved, pick(normal.dict, '/BBox')), NOTE_RECT);
  assert.match(Buffer.from(normal.contents).toString('latin1'), /h B\n/);
  assert.equal(pick(resources, '/Font'), undefined);
  assert.equal(pick(gs, '/CA').asNumber(), 1);
  let fonts = 0;
  for (const [, obj] of saved.context.enumerateIndirectObjects()) {
    if (obj?.get?.(PDFName.of('Type'))?.encodedName === '/Font')
      fonts += 1;
  }
  assert.equal(fonts, 0);
});

test('note は作成者が空なら /T を書かず、本文が空でも書ける', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [note({ author: '', text: '' })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const [text] = annotsOf(saved, 0);
  assert.equal(pick(text.dict, '/T'), undefined);
  assert.equal(pick(text.dict, '/Contents').decodeText(), '');
});

test('note と図形の不透明度は /CA と外観の ExtGState に同じ値で書かれる', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [note({ opacity: 0.5 }), shape({ opacity: 0.25 })] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const [text, , squareAnnot] = annotsOf(saved, 0);
  assert.equal(pick(text.dict, '/CA').asNumber(), 0.5);
  assert.equal(pick(extGStateOf(saved, text.dict).gs, '/CA').asNumber(), 0.5);
  assert.equal(pick(extGStateOf(saved, text.dict).gs, '/ca').asNumber(), 0.5);
  assert.equal(nameOf(squareAnnot.dict, '/Subtype'), '/Square');
  assert.equal(pick(squareAnnot.dict, '/CA').asNumber(), 0.25);
  assert.equal(pick(extGStateOf(saved, squareAnnot.dict).gs, '/CA').asNumber(), 0.25);
  assert.equal(pick(extGStateOf(saved, squareAnnot.dict).gs, '/ca').asNumber(), 0.25);
});

test('note を remove で消すと辞書・外観・ポップアップの 3 つが消える', async () => {
  const doc = await makeDoc(1);
  await applyAnnotations(doc, { add: [note()] }, TOOLS, { now: NOW });
  const saved = await roundTrip(doc);
  const before = saved.context.enumerateIndirectObjects().length;
  const [{ ref }] = annotsOf(saved, 0);
  const result = await applyAnnotations(saved, { remove: [`${ref.objectNumber}R`] }, TOOLS, { now: NOW });
  assert.deepEqual(result, { ok: true, added: 0, removed: 1 });
  const again = await roundTrip(saved);
  assert.deepEqual(annotsOf(again, 0), []);
  assert.equal(again.context.enumerateIndirectObjects().length, before - 3);
});

test('note の形が違えば何も書かずに断る', async () => {
  const doc = await makeDoc(1);
  assert.deepEqual(await applyAnnotations(doc, { add: [note({ text: 5 })] }, TOOLS, { now: NOW }), { error: '注釈 1 の形が読めません。' });
  assert.deepEqual(await applyAnnotations(doc, { add: [note({ rect: [120, 700, 100, 680] })] }, TOOLS, { now: NOW }), { error: '注釈 1 の形が読めません。' });
  assert.equal(annotsOf(doc, 0).length, 0);
});
