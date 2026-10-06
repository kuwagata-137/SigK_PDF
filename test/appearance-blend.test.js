'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PDFDocument, PDFName } = require('pdf-lib');
const { NORMAL_BLENDS, blendOf } = require('../worker/appearance-blend.js');

// 注釈の外観の重ね方（spec-4b-5b 確定事項13。事前調査 F）。外観と 1 段下の Form の ExtGState の /BM を読む。

async function newDoc() {
  return PDFDocument.create();
}

function form(context, content, resources = {}) {
  return context.register(context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100], Resources: resources }));
}

// /AP /N を持つ Ink の辞書。
function inkWith(context, normal) {
  return context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [0, 0, 100, 100], AP: { N: normal } });
}

test('外側の GS の /BM /Multiply を読む', async () => {
  const { context } = await newDoc();
  const normal = form(context, 'q /GS gs Q', { ExtGState: { GS: { Type: 'ExtGState', CA: 1, BM: 'Multiply' } } });
  assert.equal(blendOf(context, inkWith(context, normal)), 'Multiply');
});

test('名前の配列は先頭の名前を読み、1 段下の Form の GS も見る', async () => {
  const { context } = await newDoc();
  const array = form(context, 'q /GS gs Q', { ExtGState: { GS: { BM: [PDFName.of('Multiply'), PDFName.of('Normal')] } } });
  assert.equal(blendOf(context, inkWith(context, array)), 'Multiply');
  const inner = form(context, '/M gs 0 0 m 10 10 l S', { ExtGState: { M: { BM: 'Multiply' } } });
  const outer = form(context, 'q /G0 Do Q', { XObject: { G0: inner } });
  assert.equal(blendOf(context, inkWith(context, outer)), 'Multiply');
});

test('ふつうの重ね方だけ・/BM が無い・外観が無いものは null', async () => {
  assert.deepEqual(NORMAL_BLENDS, ['Normal', 'Compatible']);
  const { context } = await newDoc();
  const normal = form(context, 'q /GS gs Q', { ExtGState: { GS: { BM: 'Normal' }, B: { BM: 'Compatible' } } });
  assert.equal(blendOf(context, inkWith(context, normal)), null);
  const plain = form(context, 'q /GS gs Q', { ExtGState: { GS: { CA: 0.5 } } });
  assert.equal(blendOf(context, inkWith(context, plain)), null);
  const bare = form(context, '0 0 m 10 10 l S');
  assert.equal(blendOf(context, inkWith(context, bare)), null);
  assert.equal(blendOf(context, context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [0, 0, 100, 100] })), null);
  // 空の配列は読めないので数えない。
  const empty = form(context, 'q /GS gs Q', { ExtGState: { GS: { BM: context.obj([]) } } });
  assert.equal(blendOf(context, inkWith(context, empty)), null);
});

test('ほかの重ね方があればその名前を返す（乗算と交ざっていても乗算でない方）', async () => {
  const { context } = await newDoc();
  const screen = form(context, 'q /GS gs Q', { ExtGState: { GS: { BM: 'Screen' } } });
  assert.equal(blendOf(context, inkWith(context, screen)), 'Screen');
  const inner = form(context, '/D gs', { ExtGState: { D: { BM: 'Darken' } } });
  const mixed = form(context, 'q /GS gs /G0 Do Q', { ExtGState: { GS: { BM: 'Multiply' } }, XObject: { G0: inner } });
  assert.equal(blendOf(context, inkWith(context, mixed)), 'Darken');
});

test('状態の辞書の外観は /AS で選び、2 段下の Form は見ない', async () => {
  const { context } = await newDoc();
  const on = form(context, 'q /GS gs Q', { ExtGState: { GS: { BM: 'Multiply' } } });
  const off = form(context, 'q Q');
  const dict = context.obj({ Type: 'Annot', Subtype: 'Ink', Rect: [0, 0, 100, 100], AS: 'On', AP: { N: { On: on, Off: off } } });
  assert.equal(blendOf(context, dict), 'Multiply');
  dict.set(PDFName.of('AS'), PDFName.of('Off'));
  assert.equal(blendOf(context, dict), null);
  const deep = form(context, '/M gs', { ExtGState: { M: { BM: 'Multiply' } } });
  const middle = form(context, '/G1 Do', { XObject: { G1: deep } });
  const top = form(context, '/G0 Do', { XObject: { G0: middle } });
  assert.equal(blendOf(context, inkWith(context, top)), null);
});
