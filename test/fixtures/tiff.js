'use strict';

// テストに使う TIFF をその場で組み立てる（spec-3-2 事前調査 F）。
//
// utif を検証するための検体なので、utif の encode は使わない。書くのは II／MM の
// ヘッダー・IFD の鎖・ストリップかタイルで、圧縮は無圧縮・PackBits・Deflate・LZW を
// 自前で行う（CCITT と JPEG は Node だけでは作れないので ccitt.js の検体を使う）。
//
// pages: [{ width, height, bitsPerSample, photometric, compression, rowsPerStrip, pixels, tile, strips, extra }]
//   pixels は行を packed にしたバイト列（行末はバイト境界）。tile: { width, height } を
//   渡すとタイルに切る。strips を渡すとそのまま（JPEG の1ストリップなど）。
//   extra は [[tag, type, values], …] で任意のタグを足す。

const zlib = require('node:zlib');

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

// PackBits（圧縮 32773）
function packBits(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    let run = 1;
    while (at + run < bytes.length && bytes[at + run] === bytes[at] && run < 128)
      run += 1;
    if (run >= 2) {
      out.push(257 - run, bytes[at]);
      at += run;
      continue;
    }
    const start = at;
    while (at < bytes.length && at - start < 128 && !(at + 1 < bytes.length && bytes[at + 1] === bytes[at]))
      at += 1;
    out.push(at - start - 1, ...bytes.subarray(start, at));
  }
  return Uint8Array.from(out);
}

// TIFF の LZW（圧縮 5）。MSB-first、Clear 256、EOI 257。幅の切り替えと Clear の
// 位置は libtiff の書き手に揃えてある（4094 を足したら Clear）。
function lzwEncode(bytes) {
  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let table = new Map();
  let next = 258;
  let width = 9;
  const emit = (code) => {
    bitBuffer = (bitBuffer << width) | code;
    bitCount += width;
    while (bitCount >= 8) {
      out.push((bitBuffer >> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
    bitBuffer &= (1 << bitCount) - 1;
  };
  const clear = () => { emit(256); table = new Map(); next = 258; width = 9; };
  clear();
  let prefix = null;
  for (const value of bytes) {
    if (prefix === null) {
      prefix = { key: String(value), code: value };
      continue;
    }
    const key = `${prefix.key},${value}`;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = { key, code: known };
      continue;
    }
    emit(prefix.code);
    table.set(key, next);
    next += 1;
    if (next === 512 || next === 1024 || next === 2048)
      width += 1;
    if (next === 4095)
      clear();
    prefix = { key: String(value), code: value };
  }
  if (prefix !== null)
    emit(prefix.code);
  emit(257);
  if (bitCount > 0)
    out.push((bitBuffer << (8 - bitCount)) & 0xff);
  return Uint8Array.from(out);
}

function compress(method, bytes) {
  if (method === 1 || method === 7) return bytes;
  if (method === 32773) return packBits(bytes);
  if (method === 8 || method === 32946) return new Uint8Array(zlib.deflateSync(bytes));
  if (method === 5) return lzwEncode(bytes);
  throw new Error(`fixture が作れない圧縮です: ${method}`);
}

function rowBytesOf(page) {
  const bits = page.bitsPerSample.reduce((sum, value) => sum + value, 0);
  return Math.ceil(page.width * bits / 8);
}

// 行を RowsPerStrip ごとに切る。
function stripsOf(page) {
  if (page.strips !== undefined)
    return page.strips;
  const rowBytes = rowBytesOf(page);
  const rows = page.rowsPerStrip ?? page.height;
  const strips = [];
  for (let y = 0; y < page.height; y += rows)
    strips.push(page.pixels.subarray(y * rowBytes, Math.min(y + rows, page.height) * rowBytes));
  return strips;
}

// タイルに切る。端のタイルは 0 で埋める。
function tilesOf(page) {
  const bits = page.bitsPerSample.reduce((sum, value) => sum + value, 0);
  const rowBytes = rowBytesOf(page);
  const tileRowBytes = Math.ceil(page.tile.width * bits / 8);
  const tiles = [];
  for (let ty = 0; ty < page.height; ty += page.tile.height) {
    for (let tx = 0; tx < page.width; tx += page.tile.width) {
      const tile = new Uint8Array(tileRowBytes * page.tile.height);
      for (let y = 0; y < page.tile.height && ty + y < page.height; y += 1) {
        const from = (ty + y) * rowBytes + Math.floor(tx * bits / 8);
        tile.set(page.pixels.subarray(from, Math.min(from + tileRowBytes, (ty + y + 1) * rowBytes)), y * tileRowBytes);
      }
      tiles.push(tile);
    }
  }
  return tiles;
}

function packValues(type, values, le) {
  if (type === TYPE.ASCII)
    return new Uint8Array(Buffer.from(`${values[0]}\0`, 'latin1'));
  if (type === TYPE.BYTE || type === TYPE.UNDEFINED)
    return Uint8Array.from(values);
  const out = new Uint8Array(values.length * TYPE_SIZE[type]);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    if (type === TYPE.SHORT) view.setUint16(index * 2, value, le);
    else if (type === TYPE.LONG) view.setUint32(index * 4, value, le);
    else { view.setUint32(index * 8, value[0], le); view.setUint32(index * 8 + 4, value[1], le); }
  });
  return out;
}

// IFD を組む。4 バイトを超える値は IFD の直後に置く。next IFD は呼ぶ側が埋める。
function buildIfd(entries, at, le) {
  const sorted = entries.slice().sort((a, b) => a[0] - b[0]);
  const head = 2 + sorted.length * 12 + 4;
  const tail = [];
  let tailAt = at + head;
  const table = new Uint8Array(head);
  const view = new DataView(table.buffer);
  view.setUint16(0, sorted.length, le);
  sorted.forEach(([tag, type, values], index) => {
    const packed = packValues(type, values, le);
    const count = type === TYPE.ASCII ? packed.length : values.length;
    const entry = 2 + index * 12;
    view.setUint16(entry, tag, le);
    view.setUint16(entry + 2, type, le);
    view.setUint32(entry + 4, count, le);
    if (packed.length <= 4) {
      table.set(packed, entry + 8);
      return;
    }
    view.setUint32(entry + 8, tailAt, le);
    tail.push(packed.length % 2 === 1 ? Uint8Array.from([...packed, 0]) : packed);
    tailAt += tail[tail.length - 1].length;
  });
  return { table, tail, size: tailAt - at };
}

function pageEntries(page, chunks, offsets, tiled) {
  const entries = [
    [256, TYPE.LONG, [page.width]],
    [257, TYPE.LONG, [page.height]],
    [258, TYPE.SHORT, page.bitsPerSample],
    [259, TYPE.SHORT, [page.compression ?? 1]],
    [262, TYPE.SHORT, [page.photometric]],
    [277, TYPE.SHORT, [page.bitsPerSample.length]],
    ...(page.extra ?? []),
  ];
  if (tiled)
    entries.push([322, TYPE.LONG, [page.tile.width]], [323, TYPE.LONG, [page.tile.height]], [324, TYPE.LONG, offsets], [325, TYPE.LONG, chunks.map((c) => c.length)]);
  else
    entries.push([273, TYPE.LONG, offsets], [278, TYPE.LONG, [page.rowsPerStrip ?? page.height]], [279, TYPE.LONG, chunks.map((c) => c.length)]);
  return entries;
}

function makeTiff(pages, { littleEndian = true } = {}) {
  const le = littleEndian;
  const parts = [new Uint8Array(le ? [0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0] : [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 0])];
  const ifdAt = [];
  const ifdTables = [];
  let at = 8;
  for (const page of pages) {
    const tiled = page.tile !== undefined;
    const chunks = (tiled ? tilesOf(page) : stripsOf(page)).map((chunk) => compress(page.compression ?? 1, chunk));
    const offsets = [];
    for (const chunk of chunks) {
      offsets.push(at);
      parts.push(chunk);
      at += chunk.length;
      if (at % 2 === 1) { parts.push(new Uint8Array(1)); at += 1; }
    }
    const ifd = buildIfd(pageEntries(page, chunks, offsets, tiled), at, le);
    ifdAt.push(at);
    ifdTables.push(ifd.table);
    parts.push(ifd.table, ...ifd.tail);
    at += ifd.size;
  }
  ifdTables.forEach((table, index) => {
    const view = new DataView(table.buffer);
    view.setUint32(table.length - 4, ifdAt[index + 1] ?? 0, le);
  });
  const file = new Uint8Array(at);
  let cursor = 0;
  for (const part of parts) { file.set(part, cursor); cursor += part.length; }
  new DataView(file.buffer).setUint32(4, ifdAt[0], le);
  return Buffer.from(file);
}

module.exports = { TYPE, packBits, lzwEncode, makeTiff };
