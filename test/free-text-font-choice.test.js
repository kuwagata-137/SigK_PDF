'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createShell } = require('./harness.js');

// テキストの書き込みのフォント（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」・FT3 の推奨案A）。書き込みの font の欄、
// 画面の描き方、読み戻しのフォントの見分けを確かめる。このパソコンで使える Windows のフォントは、試験用シェルの systemFonts で決める。

const SYSTEM_FONTS = [{ id: 'yu-gothic', bold: true }, { id: 'ms-gothic', bold: false }];

async function withFonts(t, systemFonts = SYSTEM_FONTS) {
  const shell = await createShell({ systemFonts });
  t.after(() => shell.cleanup());
  await shell.flush();
  return shell;
}

const VIEWPORT = { scale: 1, rotation: 0, convertToViewportPoint: (x, y) => [x, 842 - y] };

function textEntry(overrides = {}) {
  return {
    src: 0, kind: 'text', color: '#1c2430', opacity: 1, rect: [100, 674.5, 224, 720.5], quads: [[100, 720.5, 224, 720.5, 100, 674.5, 224, 674.5]],
    text: 'あいう', fontSize: 10, rotation: 0, width: 'auto', ...overrides,
  };
}

test('起動の後、メインが調べた使えるフォントを一覧の控えにする', async (t) => {
  const { SigK } = await withFonts(t);
  assert.deepEqual([...SigK.textFonts.availableFonts().map((font) => font.label)], ['Noto Sans JP', '游ゴシック', 'MS ゴシック']);
});

test('書き込みの font の欄: 既定のフォントは持たず、一覧に無い id は形が違う。写し・比べ・整えでも font を扱う', async (t) => {
  const { SigK } = await withFonts(t);
  const fields = SigK.freeTextEntry;
  assert.equal(fields.validFields(textEntry({ font: 'yu-gothic' })), true);
  assert.equal(fields.validFields(textEntry({ font: 'none' })), false);
  assert.equal(fields.validFields(textEntry({ font: 'noto-sans-jp' })), false, '既定のフォントは持たない');
  assert.equal(fields.validPatchValue('font', 'noto-sans-jp'), true);
  assert.equal(fields.validPatchValue('font', 'meiryo'), true, '一覧にあれば、このパソコンに無くても形は正しい');
  assert.equal(fields.validPatchValue('font', 'none'), false);
  assert.deepEqual(fields.tidy({ font: 'noto-sans-jp' }), {});
  assert.deepEqual(fields.copyFields(textEntry({ font: 'yu-gothic' }), {}).font, 'yu-gothic');
  assert.equal(fields.sameFields(textEntry({ font: 'yu-gothic' }), textEntry()), false);
  assert.equal(fields.sameFields(textEntry({ font: 'yu-gothic' }), textEntry({ font: 'yu-gothic' })), true);
});

test('保存へ渡す欄: このパソコンで使えないフォント（ほかのパソコンで付けたテキスト）は持たず、Noto Sans JP で直す', async (t) => {
  const { SigK } = await withFonts(t);
  const layout = { lines: ['あいう'], inset: { left: 2, top: 2 } };
  assert.equal(SigK.freeTextEntry.saveFields(textEntry({ font: 'yu-gothic' }), layout).font, 'yu-gothic');
  assert.equal(SigK.freeTextEntry.saveFields(textEntry({ font: 'meiryo' }), layout).font, undefined);
});

test('画面の描き方: フォントの font-family で描き、太字の書体が無いフォントの太字は標準の書体の擬似太字（質問 FT3「案B」）。使えないフォントは Noto Sans JP', async (t) => {
  const { SigK } = await withFonts(t);
  const font = SigK.freeTextFont;
  assert.equal(font.fontOf(12, true, false, 'yu-gothic'), '700 12px "Yu Gothic"');
  assert.equal(font.fontOf(12, true, false, 'ms-gothic'), '12px "MS Gothic"');
  assert.equal(font.fontOf(12, false, true, 'meiryo'), 'italic 12px "SigK Noto Sans JP"');
  assert.equal(font.fontOf(12, true), '700 12px "SigK Noto Sans JP"');
  assert.deepEqual([font.syntheticBoldOf(true, 'ms-gothic'), font.syntheticBoldOf(true, 'yu-gothic'), font.syntheticBoldOf(false, 'ms-gothic')], [true, false, false]);
  assert.equal(font.SYNTHETIC_BOLD_RATIO, 1 / 30);
});

test('画面の描き方: 注釈の層の文字は、既定でないフォントだけ、text の要素ごとに style で font-family を指定する（shell.css は text の要素に指定している）', async (t) => {
  const { SigK, document } = await withFonts(t);
  const group = (entry) => [...SigK.freeTextShape.svgOf(document, entry, VIEWPORT).querySelectorAll('g.free-text')].at(-1)
    ?? SigK.freeTextShape.svgOf(document, entry, VIEWPORT);
  assert.equal(group(textEntry({ font: 'yu-gothic' })).querySelector('text').style.fontFamily, '"Yu Gothic", sans-serif');
  assert.equal(group(textEntry()).querySelector('text').style.fontFamily, '');
  const ms = group(textEntry({ font: 'ms-gothic', bold: true }));
  assert.equal(ms.getAttribute('font-weight'), null, '擬似太字は font-weight を付けない（字の送り幅を標準の書体のままにする）');
  const msText = ms.querySelector('text');
  assert.deepEqual(['stroke', 'stroke-width', 'stroke-linejoin', 'stroke-miterlimit'].map((name) => msText.getAttribute(name)), ['#1c2430', '0.33', 'miter', '10'],
    '文字の色で、字の大きさ 10pt の 30 分の 1 の線');
  const yu = group(textEntry({ font: 'yu-gothic', bold: true }));
  assert.equal(yu.getAttribute('font-weight'), '700');
  assert.equal(yu.querySelector('text').getAttribute('stroke'), null);
});

test('読み戻し: /DA のフォント名から、どのフォントで付けたテキストかを見分ける（Noto Sans JP は持たない）', async (t) => {
  const { SigK } = await withFonts(t);
  const annotation = (fontName) => ({
    id: '12R', subtype: 'FreeText', rect: [100, 674.5, 224, 720.5], contentsObj: { str: 'あいう' }, rotation: 0,
    defaultAppearanceData: { fontName, fontSize: 10, fontColor: new Uint8ClampedArray([28, 36, 48]) },
  });
  assert.equal(SigK.importedEntry.importedEntry(annotation('SigKYG'), 0).font, 'yu-gothic');
  assert.equal(SigK.importedEntry.importedEntry(annotation('SigKMM'), 0).font, 'ms-mincho', 'このパソコンに無いフォントも見分ける（描く時と保存の時に Noto Sans JP にする）');
  assert.equal('font' in SigK.importedEntry.importedEntry(annotation('SigKJP'), 0), false);
});
