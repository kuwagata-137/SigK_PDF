'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { embeddable, faceUsable, listUsableFonts, createFontCatalog, FONTKIT_PATH } = require('../font-catalog.js');
const { fontById } = require('../worker/text-fonts.js');
const { notoTtc } = require('./ttc-fixture.js');

// このパソコンで使えるテキストのフォントを調べる（版 1.5.0 の③。質問 FT1「案B Windows フォント使用」）。Windows のフォントのファイルは
// 読まず、ファイルの読み込みとフォントの解析を差し替えて確かめる（同梱の Noto Sans JP から組み立てた .ttc で、本物の fontkit も使う）。

const fontkit = require(FONTKIT_PATH);

// path → バイト列の偽のファイル読み込み。無いファイルは読めない。
function fakeFs(files) {
  return {
    promises: {
      readFile: async (filePath) => {
        const name = path.basename(filePath);
        if (!Object.hasOwn(files, name))
          throw Object.assign(new Error(`ENOENT: ${name}`), { code: 'ENOENT' });
        return files[name];
      },
    },
  };
}

// ファイル名 → { postscriptName → fsType } の偽の fontkit。
function fakeFontkit(table) {
  return {
    create(bytes, postscriptName) {
      const fonts = table[bytes.toString()];
      const name = postscriptName ?? Object.keys(fonts)[0];
      return Object.hasOwn(fonts, name) ? { postscriptName: name, 'OS/2': { fsType: fonts[name] } } : null;
    },
  };
}

test('埋め込みの決まり（fsType）: インストール可・編集可は使える。埋め込み不可・表示と印刷だけ・サブセット不可・ビットマップだけは使えない', () => {
  assert.equal(embeddable(0), true, 'インストールしてよい');
  assert.equal(embeddable(0x0008), true, '編集できる文書に埋め込んでよい（游ゴシック・メイリオ・MS ゴシックなど）');
  assert.equal(embeddable(0x000c), true, '表示と印刷・編集の両方なら緩い方');
  assert.equal(embeddable(0x0004), false, '表示と印刷だけ（Windows の BIZ UD など）');
  assert.equal(embeddable(0x0002), false, '埋め込み不可');
  assert.equal(embeddable(0x0108), false, 'サブセットにしてはいけない');
  assert.equal(embeddable(0x0208), false, 'ビットマップだけ');
  assert.equal(embeddable(undefined), false);
  assert.equal(embeddable({ noEmbedding: false, viewOnly: false, editable: true, noSubsetting: false, bitmapOnly: false }), true, 'fontkit の形');
  assert.equal(embeddable({ noEmbedding: false, viewOnly: true, editable: false, noSubsetting: false, bitmapOnly: false }), false);
});

test('ファイルがあり、PostScript 名のフォントが見つかり、埋め込めるフォントだけを一覧の順で返す。太字の書体も同じように調べる', async () => {
  const files = { 'YuGothR.ttc': Buffer.from('YuGothR'), 'YuGothB.ttc': Buffer.from('YuGothB'), 'msgothic.ttc': Buffer.from('msgothic'), 'meiryo.ttc': Buffer.from('meiryo'), 'yumin.ttf': Buffer.from('yumin') };
  const table = {
    YuGothR: { 'YuGothic-Regular': 0x0008, 'YuGothic-UI-Regular': 0x0008 },
    YuGothB: { 'YuGothic-Bold': 0x0008 },
    msgothic: { 'MS-Gothic': 0x0008 },
    meiryo: { 'Meiryo': 0x0004 },
    yumin: { 'YuMincho-Regular': 0x0008 },
  };
  const list = await listUsableFonts({ fsLike: fakeFs(files), fontkit: fakeFontkit(table) });
  assert.deepEqual(list, [
    { id: 'noto-sans-jp', bold: true },
    { id: 'yu-gothic', bold: true },
    { id: 'yu-mincho', bold: false },
    { id: 'ms-gothic', bold: false },
  ], '游明朝は太字のファイルが無い・メイリオは表示と印刷だけ・MS 明朝はファイルが無い');
});

test('.ttc は PostScript 名でフォントを選ぶ（本物の fontkit。Noto Sans JP の標準と太字を 1 つにした .ttc）', async () => {
  const fsLike = fakeFs({ 'YuGothR.ttc': notoTtc() });
  const regular = { ...fontById('yu-gothic').regular, postscriptName: 'NotoSansJP-Regular' };
  const bold = { ...fontById('yu-gothic').regular, postscriptName: 'NotoSansJP-Bold' };
  const missing = { ...fontById('yu-gothic').regular, postscriptName: 'YuGothic-Regular' };
  assert.equal(await faceUsable(regular, { fsLike, fontkit }), true);
  assert.equal(await faceUsable(bold, { fsLike, fontkit }), true);
  assert.equal(await faceUsable(missing, { fsLike, fontkit }), false, 'PostScript 名のフォントが無い');
});

test('1 回だけ調べて覚える。調べるのに失敗したら、同梱の Noto Sans JP だけにする', async () => {
  let reads = 0;
  const fsLike = { promises: { readFile: async () => { reads += 1; throw new Error('ENOENT'); } } };
  const catalog = createFontCatalog({ fsLike, fontkit: fakeFontkit({}) });
  assert.deepEqual(await catalog.list(), [{ id: 'noto-sans-jp', bold: true }]);
  const first = reads;
  await catalog.list();
  assert.equal(reads, first);
  const broken = createFontCatalog({ fontkit: { create() { throw new Error('x'); } }, fsLike: { promises: null } });
  assert.deepEqual(await broken.list(), [{ id: 'noto-sans-jp', bold: true }]);
});
