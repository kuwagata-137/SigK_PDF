'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// 画像のタブの上書きの確認（spec-7-1 確定事項B6）。窓を開いた・閉じたの流れは image-save.test.js が見る。ここは文面と、窓が無いときの答え。
require('../renderer/confirm-image-save.js');

const { confirmImageSave } = globalThis.SigK;

test('文面: 焼き込む先の名前・失うもの・控え（作るときだけ）', () => {
  assert.deepEqual(confirmImageSave.textsOf({ name: 'shot.png', backup: true }), [
    '書き込みを「shot.png」の画像に焼き込んで、上書き保存します。',
    '保存したあとは、書き込みを移動・編集できません。書き込みの下にあった画像も元に戻せません。',
    '元の画像は、バックアップファイル（shot.png.bak）に残します。',
  ]);
  assert.equal(confirmImageSave.textsOf({ name: 'shot.png', backup: false })[2], '');
});

test('窓を組み立てられない環境では、焼き込まない（false）', async () => {
  assert.equal(await confirmImageSave.ask({ name: 'shot.png', backup: true }), false);
  assert.equal(confirmImageSave.isOpen(), false);
});
