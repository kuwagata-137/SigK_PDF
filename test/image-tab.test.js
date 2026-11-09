'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 画像のタブの見分け（spec-7-1）。純関数なので require だけで試す。
require('../renderer/image-tab.js');

const { imageTab } = globalThis.SigK;
const fileOf = (kind) => ({ path: `C:\\work\\a.${kind}`, image: { kind, frames: [{ width: 3, height: 2 }] } });

test('画像のタブかは file.image の有無で見分ける', () => {
  assert.equal(imageTab.isImageFile(fileOf('png')), true);
  assert.equal(imageTab.isImageFile({ path: 'C:\\work\\a.pdf' }), false);
  assert.equal(imageTab.isImageFile(null), false);
});

test('上書きで同じ形式に書けるのは PNG と JPEG だけ（確定事項B1）', () => {
  assert.equal(imageTab.overwriteFormatOf(fileOf('png')), 'png');
  assert.equal(imageTab.overwriteFormatOf(fileOf('jpeg')), 'jpeg');
  for (const kind of ['bmp', 'gif', 'tiff'])
    assert.equal(imageTab.overwriteFormatOf(fileOf(kind)), null, kind);
  assert.equal(imageTab.overwriteFormatOf({ path: 'C:\\work\\a.pdf' }), null);
});

test('名前を付けて保存の形式は、元の形式を先頭に PNG・JPEG・PDF。ページが 1 枚でなければ PDF だけ（確定事項B2・B3）', () => {
  assert.deepEqual(imageTab.saveFormatsOf(fileOf('png'), 1), ['png', 'jpeg', 'pdf']);
  assert.deepEqual(imageTab.saveFormatsOf(fileOf('jpeg'), 1), ['jpeg', 'png', 'pdf']);
  assert.deepEqual(imageTab.saveFormatsOf(fileOf('tiff'), 1), ['png', 'jpeg', 'pdf']);
  assert.deepEqual(imageTab.saveFormatsOf(fileOf('tiff'), 3), ['pdf']);
  assert.deepEqual(imageTab.saveFormatsOf(fileOf('png'), 2), ['pdf']);
});

test('既定のパスは同じフォルダの同じ名前で、拡張子は形式のもの。JPEG は元の .jpeg を残す', () => {
  assert.equal(imageTab.defaultPathFor('C:\\work\\shot.png', 'png'), 'C:\\work\\shot.png');
  assert.equal(imageTab.defaultPathFor('C:\\work\\scan.TIFF', 'png'), 'C:\\work\\scan.png');
  assert.equal(imageTab.defaultPathFor('C:\\work\\photo.jpeg', 'jpeg'), 'C:\\work\\photo.jpeg');
  assert.equal(imageTab.defaultPathFor('C:\\work\\shot.png', 'jpeg'), 'C:\\work\\shot.jpg');
  assert.equal(imageTab.defaultPathFor('C:\\work\\fax.tif', 'pdf'), 'C:\\work\\fax.pdf');
  assert.equal(imageTab.defaultPathFor('C:\\work.d\\noext', 'png'), 'C:\\work.d\\noext.png', 'フォルダの点は拡張子にしない');
});

test('MIME と品質。JPEG だけ 0.95', () => {
  assert.equal(imageTab.mimeOf('png'), 'image/png');
  assert.equal(imageTab.mimeOf('jpeg'), 'image/jpeg');
  assert.equal(imageTab.mimeOf('pdf'), null);
  assert.equal(imageTab.qualityOf('jpeg'), 0.95);
  assert.equal(imageTab.qualityOf('png'), undefined);
});

test('画像のタブで使えない道具は、ハイライト・下線・取り消し線・ノート（確定事項C1）', () => {
  for (const tool of ['highlight', 'underline', 'strikeout', 'note'])
    assert.equal(imageTab.blocksTool(fileOf('png'), tool), true, tool);
  for (const tool of ['text', 'callout', 'shape', 'pen', 'marker', 'eraser', 'mosaic', 'trim', 'select', 'hand'])
    assert.equal(imageTab.blocksTool(fileOf('png'), tool), false, tool);
  assert.equal(imageTab.blocksTool({ path: 'C:\\work\\a.pdf' }, 'highlight'), false, 'PDF では使える');
});
