'use strict';

// ICO の読み書き（docs/spec-5-2-open-with-icon.md 確定事項B3・B5）。
// 中身は PNG だけを入れる（Windows Vista 以降は、どの大きさでも PNG 入りの ICO を読む）。
// 形は「6 バイトの頭（0・種類 1・枚数）」＋「1 枚 16 バイトの目録 × 枚数」＋「PNG の中身」だけなので、依存を足さずに書く。

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;
const MAX_SIZE = 256;

// PNG の頭（IHDR）から幅・高さ・ビットの深さ・色の型を読む。
function pngInfo(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR')
    throw new Error('PNG ではありません');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bitDepth: png[24], colorType: png[25] };
}

// 目録の幅・高さは 1 バイトで、256 は 0 と書く決まり。
const sizeByte = (size) => (size === MAX_SIZE ? 0 : size);

// 正方形の PNG を小さい順に並べて 1 つの ICO にする。
function packIco(pngs) {
  if (!Array.isArray(pngs) || pngs.length === 0)
    throw new Error('絵がありません');
  const images = pngs.map((png) => ({ png, ...pngInfo(png) })).sort((a, b) => a.width - b.width);
  for (const { width, height, bitDepth, colorType } of images) {
    if (width !== height || width < 1 || width > MAX_SIZE)
      throw new Error(`正方形で ${MAX_SIZE}px 以下の絵にしてください: ${width}×${height}`);
    // 目録には 32 ビット（透明あり）と書くので、中身も 8 ビットの RGBA に限る。
    if (colorType !== 6 || bitDepth !== 8)
      throw new Error(`8 ビットの RGBA（透明あり）の PNG にしてください: 色の型 ${colorType}・${bitDepth} ビット`);
  }
  const sizes = images.map(({ width }) => width);
  if (new Set(sizes).size !== sizes.length)
    throw new Error(`同じ大きさの絵が 2 つあります: ${sizes.join(', ')}`);

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
  const entries = images.map(({ png, width }) => {
    const entry = Buffer.alloc(ENTRY_BYTES);
    entry[0] = sizeByte(width);
    entry[1] = sizeByte(width);
    entry.writeUInt16LE(1, 4); // 色の面の数
    entry.writeUInt16LE(32, 6); // 1 画素のビット数（透明あり）
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

// ICO の目録と中身を読む。PNG でない中身（BMP）は png を null で返す。
function readIco(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1)
    throw new Error('ICO ではありません');
  const count = buffer.readUInt16LE(4);
  if (count === 0)
    throw new Error('絵が 1 枚も入っていません');
  const dataStart = HEADER_BYTES + ENTRY_BYTES * count;
  if (buffer.length < dataStart)
    throw new Error('目録が途中で切れています');
  return Array.from({ length: count }, (_, index) => {
    const at = HEADER_BYTES + ENTRY_BYTES * index;
    const bytes = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    if (bytes === 0 || offset < dataStart)
      throw new Error(`${index + 1} 枚目の中身の位置か大きさがおかしい（位置 ${offset}・${bytes} バイト）`);
    if (offset + bytes > buffer.length)
      throw new Error(`${index + 1} 枚目の中身がファイルの外を指しています`);
    const data = buffer.subarray(offset, offset + bytes);
    const isPng = data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE);
    let png = null;
    if (isPng) {
      try {
        png = pngInfo(data);
      } catch (err) {
        throw new Error(`${index + 1} 枚目: ${err.message}`);
      }
    }
    return {
      width: buffer[at] || MAX_SIZE,
      height: buffer[at + 1] || MAX_SIZE,
      entry: buffer.subarray(at, at + ENTRY_BYTES),
      bitCount: buffer.readUInt16LE(at + 6),
      data,
      png,
    };
  });
}

module.exports = { packIco, readIco, pngInfo };
