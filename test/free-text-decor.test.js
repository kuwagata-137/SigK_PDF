'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decorOps, readableTextOps } = require('../worker/free-text-decor.js');

// テキストの塗りと枠線の外観の演算子（spec-4b-4a 確定事項I2・I3）。

test('decorOps は塗りを箱いっぱいの re f、枠線を太さの半分入れた re S で描く', () => {
  assert.deepEqual(decorOps({ clip: [100, 670, 124, 30], fill: [1, 1, 0], border: [0.753, 0, 0], borderWidth: 2 }), [
    '1 1 0 rg', '100 670 124 30 re f',
    '0.753 0 0 RG', '2 w', '0 j', '101 671 122 28 re S',
  ]);
  assert.deepEqual(decorOps({ clip: [0, 0, 10, 10], fill: null, border: null, borderWidth: 0 }), []);
});

test('readableTextOps は何も描かない文字の命令（書体・大きさ・文字の色）', () => {
  assert.equal(readableTextOps({ name: 'SigKJPB', fontSize: 10.5, rgb: [1, 0, 0] }), 'BT /SigKJPB 10.5 Tf 1 0 0 rg ET');
});
