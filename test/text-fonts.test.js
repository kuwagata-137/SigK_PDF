'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// テキストと吹き出しの書き込みに使うフォントの一覧（版 1.5.0 の③の下準備。docs/spec-7-11-view-font.md）。
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

test('今のフォントは Noto Sans JP の 1 つで、/DA のフォント名は今までの SigKJP（保存済みの PDF の読み戻しを変えない）', () => {
  assert.deepEqual(screen.TEXT_FONTS.map((font) => font.id), ['noto-sans-jp']);
  assert.equal(screen.defaultFont().family, 'SigK Noto Sans JP');
  assert.equal(saving.defaultFont().daName, 'SigKJP');
  assert.deepEqual([saving.defaultFont().regular.resourceName, saving.defaultFont().bold.resourceName], ['SigKJP', 'SigKJPB']);
  assert.deepEqual([saving.defaultFont().regular.baseName, saving.defaultFont().bold.baseName], ['NotoSansJP-Regular', 'NotoSansJP-Bold']);
});

test('保存の側のフォントのファイルがあり、画面の側の名前（font-family）が shell.css の @font-face にある', () => {
  const css = fs.readFileSync(path.join(ROOT, 'renderer', 'shell.css'), 'utf8');
  for (const font of saving.TEXT_FONTS) {
    assert.equal(fs.existsSync(font.regular.file), true, font.regular.file);
    assert.equal(fs.existsSync(font.bold.file), true, font.bold.file);
  }
  for (const font of screen.TEXT_FONTS)
    assert.match(css, new RegExp(`@font-face\\{\\s*font-family:'${font.family}'`), font.family);
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
