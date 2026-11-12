'use strict';

// EXIF の向き（Orientation）を持つ検証用の JPEG（spec-7-4 確定事項X1〜X3）。

const { makeJpeg } = require('./images.js');

// 向きのタグだけを持つ APP1。bigEndian なら MM（モトローラの並び）で書く。type は向きの項目の型（3 が SHORT）。
function exifSegment(orientation, { bigEndian = false, type = 3 } = {}) {
  const u16 = (value) => (bigEndian ? [value >> 8, value & 0xff] : [value & 0xff, value >> 8]);
  const u32 = (value) => (bigEndian ? [0, 0, value >> 8, value & 0xff] : [value & 0xff, value >> 8, 0, 0]);
  const tiff = [...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8), ...u16(1),
    ...u16(0x0112), ...u16(type), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  return Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
}

// SOI の直後に APP1 を入れた JPEG（Uint8Array）。
function jpegWithExif(orientation, { width = 30, height = 20, ...options } = {}) {
  const jpeg = makeJpeg({ width, height });
  return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), exifSegment(orientation, options), jpeg.subarray(2)]));
}

module.exports = { exifSegment, jpegWithExif };
