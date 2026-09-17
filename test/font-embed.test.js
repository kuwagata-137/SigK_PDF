'use strict';

// 同梱フォント（Noto Sans JP）を pdf-lib へ埋め込む口（spec-4-2 確定事項22〜24）。
//
// fontkit の TTF サブセットは、loca が短い形式のとき奇数長のグリフを詰めず、以降の
// グリフが 1 バイトずれて pdf.js で歯抜けになる（spec-4-2 事前調査 B 不具合1）。
// 回避策が効いているかは、保存した PDF から FontFile2 を取り出して fontkit で読み直し、
// 全グリフの輪郭が残っていることで確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { PDFDocument, PDFName } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const {
  FONT_PATH, DA_FONT_NAME, FONT_ERROR, paddedFontkit, subsetTag, createFontSource, embedBundledFont, measureOf,
} = require('../worker/font-embed.js');

const ROOT = path.resolve(__dirname, '..');

// 事前調査 B で歯抜けになった並び（奇数長のグリフを含む）。
const SAMPLE = 'ぁあぃいうえ日本語テキスト Noto 123';

// 保存した PDF から最初の FontFile2 を取り出す（Flate は伸長する）。
async function fontFileOf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.get?.(PDFName.of('Type'))?.encodedName !== '/FontDescriptor')
      continue;
    const ref = obj.get(PDFName.of('FontFile2'));
    if (ref === undefined)
      continue;
    const stream = doc.context.lookup(ref);
    const filter = stream.dict.get(PDFName.of('Filter'))?.encodedName;
    const contents = filter === '/FlateDecode' ? zlib.inflateSync(Buffer.from(stream.contents)) : stream.contents;
    return new Uint8Array(contents);
  }
  return null;
}

// /Type0 のフォント辞書の /BaseFont を集める。
async function baseFontsOf(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj?.get?.(PDFName.of('Subtype'))?.encodedName !== '/Type0')
      continue;
    names.push(obj.get(PDFName.of('BaseFont')).encodedName);
  }
  return names;
}

// fontkit のサブセットを書き出す（pdf-lib の serializeFont と同じ読み方）。
function encodeSubset(subset) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    subset.encodeStream()
      .on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      .on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
      .on('error', reject);
  });
}

function brokenGlyphsOf(fontBytes) {
  const font = fontkit.create(fontBytes);
  const broken = [];
  for (let gid = 1; gid < font.numGlyphs; gid += 1) {
    const size = font.loca.offsets[gid + 1] - font.loca.offsets[gid];
    let commands;
    try {
      commands = font.getGlyph(gid).path.commands.length;
    } catch (error) {
      commands = error.message;
    }
    // 空白（大きさ 0）は輪郭が無くて正しい。中身があるのに輪郭が無いか読めないのが壊れたグリフ。
    if (size > 0 && (commands === 0 || typeof commands === 'string'))
      broken.push(`${gid}:${commands}`);
  }
  return { broken, offsets: font.loca.offsets, numGlyphs: font.numGlyphs };
}

test('FONT_PATH はリポジトリの同梱フォントを指し、/DA のフォント名は SigKJP', () => {
  assert.equal(path.relative(ROOT, FONT_PATH).split(path.sep).join('/'), 'assets/fonts/NotoSansJP-Regular.ttf');
  assert.ok(fs.existsSync(FONT_PATH));
  assert.equal(DA_FONT_NAME, 'SigKJP');
});

test('subsetTag は大文字 6 文字で、乱数から決まる', () => {
  assert.match(subsetTag(), /^[A-Z]{6}$/);
  assert.equal(subsetTag(() => 0), 'AAAAAA');
  assert.equal(subsetTag(() => 0.999), 'ZZZZZZ');
  let step = 0;
  assert.equal(subsetTag(() => (step += 1) / 26), 'BCDEFG');
});

test('paddedFontkit は fontkit の create を包み、奇数長のグリフを 2 バイト境界へ詰める', async () => {
  const font = paddedFontkit(fontkit).create(fs.readFileSync(FONT_PATH));
  const subset = font.createSubset();
  for (const glyph of font.layout(SAMPLE).glyphs)
    subset.includeGlyph(glyph.id);
  const bytes = await encodeSubset(subset);
  const sizes = subset.glyf.map((buffer) => buffer.length);
  assert.ok(sizes.length > 10);
  assert.ok(sizes.every((size) => size % 2 === 0), `奇数長のグリフが残っている: ${sizes.join(',')}`);
  assert.equal(subset.offset, sizes.reduce((sum, size) => sum + size, 0));
  assert.deepEqual(brokenGlyphsOf(bytes).broken, []);

  // 元の fontkit には手を入れていない（同じ字を素で詰めると奇数長が混じり、輪郭が壊れる）。
  const plain = fontkit.create(fs.readFileSync(FONT_PATH)).createSubset();
  for (const glyph of font.layout(SAMPLE).glyphs)
    plain.includeGlyph(glyph.id);
  const plainBytes = await encodeSubset(plain);
  assert.ok(plain.glyf.some((buffer) => buffer.length % 2 === 1));
  assert.ok(brokenGlyphsOf(plainBytes).broken.length > 0);
});

test('createFontSource はフォントを一度だけ読み、読めなければ文言を返す', () => {
  let reads = 0;
  const fsLike = { readFileSync: (file) => { reads += 1; return fs.readFileSync(file); } };
  const source = createFontSource({ fsLike, fontkit });
  const first = source.load();
  assert.equal(first.ok, true);
  assert.ok(first.bytes instanceof Uint8Array);
  assert.equal(typeof first.fontkit.create, 'function');
  assert.equal(source.load(), first);
  assert.equal(reads, 1);

  const missing = createFontSource({ fsLike: { readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } }, fontkit });
  assert.deepEqual(missing.load(), { ok: false, error: FONT_ERROR });
  assert.equal(FONT_ERROR, '日本語フォントを読めなかったため、テキスト注釈を保存できません。');
});

test('embedBundledFont はサブセットのフォントと「文字を知る口」を返す', async () => {
  const doc = await PDFDocument.create();
  const result = await embedBundledFont(doc, createFontSource({ fontkit }), { random: () => 0 });
  assert.equal(result.error, undefined);
  const { font, measure } = result;
  assert.equal(measure.name, DA_FONT_NAME);
  // 1 文字 = 2 バイトのグリフ番号（hex 4 桁）。空行は空の hex。
  assert.match(measure.encode('あ'), /^[0-9a-f]{4}$/i);
  assert.equal(measure.encode('あい').length, 8);
  assert.equal(measure.encode(''), '');
  // 全角は 1em、半角の数字は約 0.57em（Noto Sans JP の幅）。
  assert.equal(measure.width('あ', 12), 12);
  assert.ok(Math.abs(measure.width('1', 10) - 5.7) < 0.2);
  assert.equal(measure.width('', 12), 0);
  assert.equal(measure.font, font);
  // サブセットのタグ付きの名で埋まる。
  assert.deepEqual(await baseFontsOf(await doc.save({ addDefaultPage: false })), ['/AAAAAA+NotoSansJP-Regular']);
});

test('embedBundledFont が読めないときは error だけを返し、文書に触らない', async () => {
  const doc = await PDFDocument.create();
  const source = createFontSource({ fsLike: { readFileSync: () => { throw new Error('EACCES'); } }, fontkit });
  assert.deepEqual(await embedBundledFont(doc, source), { error: FONT_ERROR });
  assert.equal(doc.fonts.length, 0);
});

test('保存したサブセットは全グリフの輪郭が残り、loca が偶数境界に並ぶ', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  const { font, measure } = await embedBundledFont(doc, createFontSource({ fontkit }));
  measure.encode(SAMPLE);
  page.drawText(SAMPLE, { x: 10, y: 50, size: 12, font });
  const saved = await doc.save({ addDefaultPage: false });

  const fontBytes = await fontFileOf(saved);
  assert.ok(fontBytes !== null, 'FontFile2 が無い');
  const { broken, offsets, numGlyphs } = brokenGlyphsOf(fontBytes);
  assert.deepEqual(broken, [], `輪郭の無いグリフ: ${broken.join(' ')}`);
  assert.ok(offsets.every((offset) => offset % 2 === 0));
  // .notdef ＋ 使った字（重複は 1 つ）。
  const distinct = new Set(fontkit.create(fs.readFileSync(FONT_PATH)).layout(SAMPLE).glyphs.map((glyph) => glyph.id));
  assert.equal(numGlyphs, distinct.size + 1);
  // サブセットの重さは 100 文字で 15KB 級（事前調査 B）。全体（5.4MB）を埋めていない。
  assert.ok(fontBytes.length < 60_000, `サブセットが重い: ${fontBytes.length}`);
});

test('measureOf は pdf-lib のフォントから encode と width を組む', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(paddedFontkit(fontkit));
  const font = await doc.embedFont(fs.readFileSync(FONT_PATH), { subset: true, customName: 'TESTAA+NotoSansJP-Regular' });
  const measure = measureOf(font);
  assert.deepEqual(Object.keys(measure).sort(), ['encode', 'font', 'name', 'width']);
  assert.equal(measure.encode('A').length, 4);
  assert.ok(measure.width('AAA', 10) > measure.width('A', 10));
});
