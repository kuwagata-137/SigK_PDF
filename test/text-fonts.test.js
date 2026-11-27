'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// テキストと吹き出しの書き込みに使うフォントの一覧（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」。docs/spec-7-11-view-font.md）。
// 画面の側（renderer/text-fonts.js）と保存の側（worker/text-fonts.js）が、同じ id と /DA のフォント名を持つかを見張る。

require('../renderer/text-fonts.js');
const screen = globalThis.SigK.textFonts;
const saving = require('../worker/text-fonts.js');

const ROOT = path.join(__dirname, '..');

test('画面の側と保存の側で、フォントの id・/DA のフォント名・既定のフォントが同じ', () => {
  assert.deepEqual(screen.TEXT_FONTS.map((font) => [font.id, font.daName]), saving.TEXT_FONTS.map((font) => [font.id, font.daName]));
  assert.equal(screen.DEFAULT_FONT_ID, saving.DEFAULT_FONT_ID);
  assert.equal(screen.defaultFont().id, saving.defaultFont().id);
});

test('一覧は Noto Sans JP（同梱）と Windows の 5 つで、Noto Sans JP の /DA のフォント名は今までの SigKJP（保存済みの PDF の読み戻しを変えない）', () => {
  assert.deepEqual(screen.TEXT_FONTS.map((font) => font.id), ['noto-sans-jp', 'yu-gothic', 'yu-mincho', 'meiryo', 'ms-gothic', 'ms-mincho']);
  assert.deepEqual(screen.TEXT_FONTS.map((font) => font.label), ['Noto Sans JP', '游ゴシック', '游明朝', 'メイリオ', 'MS ゴシック', 'MS 明朝']);
  assert.deepEqual(screen.TEXT_FONTS.map((font) => font.bundled), saving.TEXT_FONTS.map((font) => font.bundled));
  assert.deepEqual(saving.TEXT_FONTS.map((font) => font.bold === null), [false, false, false, false, true, true], 'MS ゴシック・MS 明朝には太字の書体が無い');
  for (const font of saving.TEXT_FONTS)
    assert.equal(font.daName, font.regular.resourceName, font.id);
  assert.equal(screen.defaultFont().family, 'SigK Noto Sans JP');
  assert.equal(saving.defaultFont().daName, 'SigKJP');
  assert.deepEqual([saving.defaultFont().regular.resourceName, saving.defaultFont().bold.resourceName], ['SigKJP', 'SigKJPB']);
  assert.deepEqual([saving.defaultFont().regular.baseName, saving.defaultFont().bold.baseName], ['NotoSansJP-Regular', 'NotoSansJP-Bold']);
});

test('同梱のフォントのファイルがあり、画面の側の名前（font-family）が shell.css の @font-face にある', () => {
  const css = fs.readFileSync(path.join(ROOT, 'renderer', 'shell.css'), 'utf8');
  for (const font of saving.TEXT_FONTS.filter((entry) => entry.bundled)) {
    assert.equal(fs.existsSync(font.regular.file), true, font.regular.file);
    assert.equal(fs.existsSync(font.bold.file), true, font.bold.file);
  }
  for (const font of screen.TEXT_FONTS.filter((entry) => entry.bundled))
    assert.match(css, new RegExp(`@font-face\\{\\s*font-family:'${font.family}'`), font.family);
});

test('Windows のフォントは、Windows のフォントのフォルダ（SIGK_FONT_DIR があればそこ）のファイルと PostScript 名を持つ', () => {
  const yu = saving.fontById('yu-gothic');
  assert.equal(path.dirname(yu.regular.file), saving.SYSTEM_FONT_DIR);
  assert.deepEqual([path.basename(yu.regular.file), yu.regular.postscriptName, yu.bold.postscriptName], ['YuGothR.ttc', 'YuGothic-Regular', 'YuGothic-Bold']);
  assert.deepEqual([saving.fontById('yu-mincho').bold.postscriptName, saving.fontById('ms-gothic').regular.postscriptName], ['YuMincho-Demibold', 'MS-Gothic']);
  assert.equal(saving.defaultFont().regular.postscriptName, null);
});

test('使えるフォントの控え: 初めは同梱の Noto Sans JP だけ。メインの答えで増え、知らない id は捨てる。使えないフォントは Noto Sans JP で描く', () => {
  assert.deepEqual(screen.availableFonts().map((font) => font.id), ['noto-sans-jp']);
  assert.equal(screen.usableFont('yu-gothic').id, 'noto-sans-jp');
  screen.setAvailable([{ id: 'noto-sans-jp', bold: true }, { id: 'ms-gothic', bold: false }, { id: 'yu-gothic', bold: true }, { id: 'none', bold: true }]);
  assert.deepEqual(screen.availableFonts().map((font) => font.id), ['noto-sans-jp', 'yu-gothic', 'ms-gothic'], '並びは一覧の順');
  assert.equal(screen.usableFont('yu-gothic').family, 'Yu Gothic');
  assert.equal(screen.usableFont(undefined).id, 'noto-sans-jp');
  assert.deepEqual([screen.hasBold('yu-gothic'), screen.hasBold('ms-gothic'), screen.hasBold('meiryo')], [true, false, true], 'メイリオは使えないので Noto Sans JP の太字');
  screen.setAvailable([]);
  assert.deepEqual(screen.availableFonts().map((font) => font.id), ['noto-sans-jp']);
});

test('保存の側: 書き込みの font の欄から書体を引く。太字の書体が無いフォントの太字は、標準の書体の擬似太字（質問 FT3「案B」）', () => {
  assert.equal(saving.faceOfEntry({}).face.resourceName, 'SigKJP');
  assert.equal(saving.faceOfEntry({ bold: true }).face.resourceName, 'SigKJPB');
  assert.equal(saving.faceOfEntry({ font: 'yu-mincho', bold: true }).face.postscriptName, 'YuMincho-Demibold');
  const msBold = saving.faceOfEntry({ font: 'ms-gothic', bold: true });
  assert.deepEqual([msBold.bold, msBold.synthetic, msBold.face.resourceName], [false, true, 'SigKMG']);
  assert.equal(saving.faceOfEntry({ font: 'yu-gothic', bold: true }).synthetic, false);
  assert.equal(saving.faceOfEntry({ font: 'ms-gothic' }).synthetic, false);
  assert.equal(saving.SYNTHETIC_BOLD_RATIO, 1 / 30);
  assert.equal(saving.faceOfEntry({ font: 'none' }), null);
});

test('fontById・fontByDaName・isOwnDaName は一覧から引き、無ければ null・false', () => {
  assert.equal(screen.fontById('noto-sans-jp').daName, 'SigKJP');
  assert.equal(screen.fontById('none'), null);
  assert.equal(screen.fontByDaName('SigKJP').id, 'noto-sans-jp');
  assert.equal(screen.fontByDaName('Helv'), null);
  assert.equal(screen.isOwnDaName('SigKJP'), true);
  assert.equal(screen.isOwnDaName('SigKJPB'), false, '太字の Resources の名前は /DA には書かない');
  assert.equal(screen.isOwnDaName(undefined), false);
  assert.equal(saving.fontById('noto-sans-jp').id, 'noto-sans-jp');
  assert.equal(saving.fontById('none'), null);
});

test('font-embed.js の名前とファイルは、保存の側の一覧の既定のフォントから取る', () => {
  const embed = require('../worker/font-embed.js');
  const font = saving.defaultFont();
  assert.deepEqual([embed.FONT_PATH, embed.BOLD_FONT_PATH], [font.regular.file, font.bold.file]);
  assert.deepEqual([embed.DA_FONT_NAME, embed.BOLD_FONT_NAME], [font.regular.resourceName, font.bold.resourceName]);
  assert.deepEqual([embed.FONT_BASE_NAME, embed.BOLD_BASE_NAME], [font.regular.baseName, font.bold.baseName]);
});
