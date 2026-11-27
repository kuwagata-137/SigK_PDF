'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');

const { createFontSource, embedBundledFont, FONTKIT_PATH, FONT_ERROR } = require('../worker/font-embed.js');
const { wrappedAppearanceOf, isWrappedEntry } = require('../worker/free-text-wrapped.js');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { notoTtc } = require('./ttc-fixture.js');

// Windows のフォント（.ttc から PostScript 名で選ぶ）をテキストの書き込みのフォントごとに埋める（版 1.5.0 の③。質問 FT1「案B」）。
// Windows のフォントのファイルは読まない。游ゴシックのファイル（YuGothR.ttc・YuGothB.ttc）の代わりに、同梱の Noto Sans JP の標準と太字を
// 1 つにした .ttc を渡し、PostScript 名 YuGothic-Regular・YuGothic-Bold を NotoSansJP-Regular・NotoSansJP-Bold に読み替える。

const realFontkit = require(FONTKIT_PATH);
const RENAME = { 'YuGothic-Regular': 'NotoSansJP-Regular', 'YuGothic-Bold': 'NotoSansJP-Bold', 'MS-Gothic': 'NotoSansJP-Regular' };
const fontkit = { create: (bytes, name) => realFontkit.create(bytes, RENAME[name] ?? name) };
const TTC = notoTtc();
const reads = [];
const fsLike = {
  readFileSync(filePath) {
    reads.push(path.basename(filePath));
    if (['YuGothR.ttc', 'YuGothB.ttc', 'msgothic.ttc'].includes(path.basename(filePath)))
      return TTC;
    return require('node:fs').readFileSync(filePath);
  },
};

function wrapped(overrides = {}) {
  return {
    src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: [100, 674.5, 224, 720.5], text: 'あいう\nab',
    fontSize: 10, rotation: 0, width: 'auto', lines: ['あいう', 'ab'], inset: [2, 2], ...overrides,
  };
}

test('.ttc から PostScript 名のフォントを選んで埋め、サブセットの名前と外観の Resources の名前はそのフォントのもの', async () => {
  const doc = await PDFDocument.create();
  const source = createFontSource({ fsLike, fontkit });
  const regular = await embedBundledFont(doc, source, { random: () => 0, fontId: 'yu-gothic' });
  const bold = await embedBundledFont(doc, source, { random: () => 0, fontId: 'yu-gothic', bold: true });
  assert.equal(regular.measure.name, 'SigKYG');
  assert.equal(bold.measure.name, 'SigKYGB');
  await regular.font.embed();
  await bold.font.embed();
  const baseNames = [regular.font.ref, bold.font.ref].map((ref) => doc.context.lookup(ref).get(PDFName.of('BaseFont')).decodeText());
  assert.deepEqual(baseNames, ['AAAAAA+YuGothic-Regular', 'AAAAAA+YuGothic-Bold']);
  assert.ok(regular.measure.width('あいう', 10) > 0);
  assert.notEqual(regular.measure.width('ab', 100), bold.measure.width('ab', 100), '標準と太字で別のフォントを選んだ');
});

test('太字の書体が無いフォントの太字は読めない（呼ぶ側は標準の書体を使う。worker/text-fonts.js の faceOfEntry）。知らないフォントも読めない', async () => {
  const doc = await PDFDocument.create();
  const source = createFontSource({ fsLike, fontkit });
  assert.deepEqual(await embedBundledFont(doc, source, { fontId: 'ms-gothic', bold: true }).then((r) => r.error), FONT_ERROR);
  assert.deepEqual(await embedBundledFont(doc, source, { fontId: 'none' }).then((r) => r.error), FONT_ERROR);
  const missing = createFontSource({ fsLike: { readFileSync: () => { throw new Error('ENOENT'); } }, fontkit });
  assert.equal((await embedBundledFont(doc, missing, { fontId: 'yu-gothic' })).error, FONT_ERROR);
});

test('新しい形のテキストの /DA と /DS は、フォントの /DA の名前と /DS の名前', () => {
  const measure = { name: 'SigKYG', encode: () => '0000', width: () => 0 };
  const appearance = wrappedAppearanceOf(wrapped({ font: 'yu-gothic' }), measure);
  assert.match(appearance.da, /^\/SigKYG 10 Tf /);
  assert.equal(appearance.ds, 'font: 10pt "Yu Gothic"; color: #1C2430');
  assert.equal(isWrappedEntry(wrapped({ font: 'none' })), false, '一覧に無いフォントは読めない形');
  assert.equal(isWrappedEntry(wrapped({ font: 3 })), false);
  assert.equal(isWrappedEntry(wrapped({ font: 'ms-mincho' })), true);
});

test('保存: フォントと太字ごとに 1 度だけ埋め、太字の書体が無いフォントの太字は標準の書体で描く', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  reads.length = 0;
  const add = [
    wrapped({ font: 'yu-gothic' }),
    wrapped({ font: 'yu-gothic', bold: true }),
    wrapped({ font: 'yu-gothic' }),
    wrapped({ font: 'ms-gothic', bold: true }),
    wrapped({}),
  ];
  const result = await applyAnnotations(doc, { add }, { PDFName, PDFString, PDFHexString, PDFArray, PDFRef }, { fontSource: createFontSource({ fsLike, fontkit }) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(reads, ['YuGothR.ttc', 'msgothic.ttc', 'NotoSansJP-Regular.ttf', 'YuGothB.ttc'], '標準の書体を先に、同じ書体は 1 度だけ読む');
  const annots = doc.getPages()[0].node.Annots().asArray().map((ref) => doc.context.lookup(ref));
  const das = annots.map((dict) => dict.get(PDFName.of('DA')).decodeText().split(' ')[0]);
  assert.deepEqual(das, ['/SigKYG', '/SigKYG', '/SigKYG', '/SigKMG', '/SigKJP']);
});
