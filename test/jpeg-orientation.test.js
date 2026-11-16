'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { jpegOrientation, rotationOf, withoutOrientation } = require('../worker/jpeg-orientation.js');
const { makeJpeg } = require('./fixtures/images.js');
const { jpegWithExif } = require('./fixtures/jpeg-exif.js');

// JPEG の EXIF の向き（spec-7-4 確定事項X1〜X3）。

test('EXIF の向きを読む（II と MM の両方）。向きが無ければ 1', () => {
  assert.equal(jpegOrientation(jpegWithExif(6)), 6);
  assert.equal(jpegOrientation(jpegWithExif(8, { bigEndian: true })), 8);
  assert.equal(jpegOrientation(jpegWithExif(3)), 3);
  assert.equal(jpegOrientation(new Uint8Array(makeJpeg())), 1);
});

test('読めない向きは 1 とみなす（範囲の外・型の違い・壊れた APP1・JPEG でないもの）', () => {
  assert.equal(jpegOrientation(jpegWithExif(9)), 1);
  assert.equal(jpegOrientation(jpegWithExif(6, { type: 4 })), 1);
  const broken = jpegWithExif(6).slice(0, 20);
  assert.equal(jpegOrientation(broken), 1);
  assert.equal(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 1);
  assert.equal(jpegOrientation(new Uint8Array(0)), 1);
});

test('回す角度は 3→180・6→90・8→270。そのまま（1）と鏡に映した向き（2・4・5・7）は 0', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(rotationOf), [0, 0, 180, 0, 0, 90, 0, 270]);
});

test('withoutOrientation は向きを 1 に書き換えた写しを返し、受け取ったものは変えない', () => {
  for (const options of [{}, { bigEndian: true }]) {
    const source = jpegWithExif(6, options);
    const before = [...source];
    const neutral = withoutOrientation(source);
    assert.notEqual(neutral, source);
    assert.equal(jpegOrientation(neutral), 1);
    assert.deepEqual([...source], before, '元のバイト列は書き換えない');
    assert.equal(neutral.length, source.length, '向きの 2 バイトのほかは変えない');
    assert.equal(neutral.filter((value, index) => value !== source[index]).length, 1);
  }
});

test('withoutOrientation は、向きが無い・1 のときは同じものを返す', () => {
  const plain = new Uint8Array(makeJpeg());
  assert.equal(withoutOrientation(plain), plain);
  const upright = jpegWithExif(1);
  assert.equal(withoutOrientation(upright), upright);
});
