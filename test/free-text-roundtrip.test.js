'use strict';

// 新しい形のテキストの往復（spec-4b-4a 完了の判定5・テストの範囲「往復」）。画面の部品（折り返し・箱・ワーカーへ渡す形・読み戻し）と、
// ワーカーの保存（op-annotate）・口（annotation-dict-reader）をつなぎ、保存して読み戻すと同じ書き込みになることを 3 回続けて見る。
//
// 画面では字の送り幅を canvas で測るが、ここでは同梱フォントの字幅（hmtx）で測る（canvas と一致する。事前調査 E）。
// pdf.js の代わりに、保存した辞書から /Rect・/Contents・/DA の大きさと色・/Rotate を読む（imported-entry.js の importedText と同じ欄）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFRef } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { applyAnnotations } = require('../worker/op-annotate.js');
const { createFontSource, FONT_PATH, BOLD_FONT_PATH } = require('../worker/font-embed.js');
const { detailsOf } = require('../worker/annotation-dict-reader.js');
const { pick } = require('../worker/pdf-tree-reader.js');

require('../renderer/free-text-geometry.js');
require('../renderer/imported-values.js');
require('../renderer/free-text-wrap.js');
require('../renderer/free-text-layout.js');
require('../renderer/free-text-entry.js');
require('../renderer/imported-text-details.js');

const { freeTextGeometry: geometry, freeTextLayout: layout, freeTextEntry: fields, importedTextDetails } = globalThis.SigK;
const TOOLS = { PDFName, PDFString, PDFHexString, PDFArray, PDFRef };
const NOW = new Date(2026, 9, 2, 12, 0, 0);
const fontSource = createFontSource({ fontkit });
const PAGE = [595.28, 841.89];

// 字（書記素）の送り幅（em）。同梱フォントの hmtx。
const FONTS = { regular: fontkit.create(fs.readFileSync(FONT_PATH)), bold: fontkit.create(fs.readFileSync(BOLD_FONT_PATH)) };
function advanceOf(unit, bold = false) {
  const font = bold ? FONTS.bold : FONTS.regular;
  return [...unit].reduce((sum, ch) => sum + font.glyphForCodePoint(ch.codePointAt(0)).advanceWidth, 0) / font.unitsPerEm;
}

const pageLengthOf = (_src, rotation) => (rotation % 180 === 0 ? PAGE[0] : PAGE[1]);

// 画面が箱を組む（annotate-text.js が entry を作るときと同じ式）。origin は表示の左上。
function placed(entry, origin) {
  const result = layout.layoutOf(entry, { advanceOf: (unit) => advanceOf(unit, entry.bold === true), pageLength: pageLengthOf(entry.src, entry.rotation) });
  return { entry: { ...entry, ...layout.frameOf(origin, result.size, entry.rotation) }, layout: result };
}

function saveEntryOf(entry, result) {
  const { src, kind, color, opacity, rect, text, fontSize, rotation } = entry;
  return { src, kind, color, opacity, rect: [...rect], text, fontSize, rotation, ...fields.saveFields(entry, result) };
}

const hex = (part) => Math.round(part * 255).toString(16).padStart(2, '0');

// 保存して読み直し、1 件目の注釈を pdf.js から組んだ形（今までの形）と口の答えにする。
async function saveAndRead(saveEntry) {
  const doc = await PDFDocument.create();
  doc.addPage(PAGE);
  const result = await applyAnnotations(doc, { add: [saveEntry] }, TOOLS, { now: NOW, fontSource });
  assert.deepEqual(result, { ok: true, added: 1, removed: 0 });
  const saved = await PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
  const page = saved.getPages()[0];
  const dict = saved.context.lookup(saved.context.lookup(page.node.get(PDFName.of('Annots'))).get(0));
  const da = pick(dict, '/DA').decodeText().split(/\s+/);
  const rgb = da.slice(-4, -1).map(Number);
  const rect = saved.context.lookup(pick(dict, '/Rect')).asArray().map((value) => Math.round(value.asNumber() * 100) / 100);
  const rotation = pick(dict, '/Rotate')?.asNumber() ?? 0;
  const imported = {
    ref: '9R', src: 0, kind: 'text', color: `#${rgb.map(hex).join('')}`, opacity: 1, rect, quads: [geometry.quadOfRect(rect)],
    text: pick(dict, '/Contents').decodeText(), fontSize: Number(da[1]), rotation,
  };
  return { imported, detail: detailsOf(dict, saved.context) };
}

// 3 回続けて、置いた形 → 保存 → 読み戻し → その形で保存し直す。毎回同じ箱・幅・書式に戻ること。
async function roundTrips(entry, origin) {
  const first = placed(entry, origin);
  let current = first.entry;
  let result = first.layout;
  for (let round = 1; round <= 3; round += 1) {
    const { imported, detail } = await saveAndRead(saveEntryOf(current, result));
    const read = importedTextDetails.withTextDetails(imported, detail, { advanceOf, pageLengthOf });
    assert.ok(read !== null, `${round} 回目に表示のみになった`);
    for (const key of ['width', 'bold', 'italic', 'color', 'fontSize', 'rotation', 'text', 'fill', 'borderColor', 'borderWidth'])
      assert.deepEqual(read[key], first.entry[key], `${round} 回目の ${key}`);
    assert.deepEqual(read.rect, first.entry.rect, `${round} 回目の箱`);
    const again = placed(read, geometry.frameOrigin(read.rect, read.rotation));
    assert.deepEqual(again.entry.rect, first.entry.rect, `${round} 回目に組み直した箱`);
    assert.deepEqual(again.layout.lines, first.layout.lines, `${round} 回目の行`);
    current = again.entry;
    result = again.layout;
  }
  return first;
}

function text(overrides = {}) {
  return { src: 0, kind: 'text', color: '#222a35', opacity: 1, text: '打ち合わせ資料（Model-X200）の確認をお願いします。', fontSize: 12, rotation: 0, width: 'auto', ...overrides };
}

test('自動の幅のテキストは 12 字で折り返し、3 回往復しても自動のまま同じ箱と行に戻る', async () => {
  const first = await roundTrips(text(), [72, 760]);
  assert.ok(first.layout.lines.length > 1);
  await roundTrips(text({ text: '短い' }), [72, 700]);
});

test('固定の幅・太字・斜体・半端な大きさでも 3 回往復して同じに戻る', async () => {
  await roundTrips(text({ width: 87.35 }), [72, 760]);
  await roundTrips(text({ bold: true, color: '#c00000' }), [72, 600]);
  await roundTrips(text({ italic: true, fontSize: 10.5, width: 63.13 }), [72, 500]);
  await roundTrips(text({ bold: true, italic: true, fontSize: 10.5 }), [72, 400]);
});

test('回した表示で置いたテキストと、紙の幅で抑えた大きな文字も 3 回往復して同じに戻る', async () => {
  await roundTrips(text({ rotation: 90 }), [100, 100]);
  const big = await roundTrips(text({ fontSize: 200, text: 'あいうえおかきくけこ' }), [0, 800]);
  assert.equal(big.layout.lines[0], 'あい', '紙の幅 595pt に 200pt の全角は 2 字');
});

test('塗り・枠線・半透明のテキストも 3 回往復して同じに戻る（spec-4b-4a 確定事項I・J2）', async () => {
  await roundTrips(text({ fill: '#fff2cc', borderColor: '#c00000', borderWidth: 2 }), [72, 760]);
  await roundTrips(text({ width: 90.5, fill: '#ffff00', opacity: 0.6, italic: true }), [72, 600]);
  await roundTrips(text({ borderColor: '#4472c4', borderWidth: 1, bold: true, fontSize: 10.5, rotation: 270 }), [500, 700]);
});
