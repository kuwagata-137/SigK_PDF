'use strict';

// 試験用の .ttc（複数のフォントを 1 つにしたファイル。Windows の游ゴシック・メイリオ・MS ゴシックなどの形）を、.ttf から組み立てる
// （版 1.5.0 の③）。Windows のフォントのファイルは読まない（リポジトリの外のため）。同梱の Noto Sans JP の標準と太字を並べて使う。
//
// TTC の頭（'ttcf'・版・フォントの数・各フォントの表の位置）の後ろに、.ttf をそのまま 4 バイト境界で並べ、各 .ttf の表の目録の
// offset に、その .ttf を置いた位置を足す（TTC の offset はファイルの先頭から数えるため。表の中身と checksum は変わらない）。

const fs = require('node:fs');
const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

function align4(value) {
  return (value + 3) & ~3;
}

function buildTtc(fonts) {
  const header = 12 + 4 * fonts.length;
  const bases = [];
  let at = align4(header);
  for (const font of fonts) {
    bases.push(at);
    at = align4(at + font.length);
  }
  const out = Buffer.alloc(at);
  out.write('ttcf', 0, 'latin1');
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt32BE(fonts.length, 8);
  fonts.forEach((font, index) => {
    const base = bases[index];
    out.writeUInt32BE(base, 12 + 4 * index);
    Buffer.from(font).copy(out, base);
    const numTables = out.readUInt16BE(base + 4);
    for (let table = 0; table < numTables; table += 1) {
      const record = base + 12 + 16 * table;
      out.writeUInt32BE(out.readUInt32BE(record + 8) + base, record + 8);
    }
  });
  return out;
}

// 同梱の Noto Sans JP の標準（NotoSansJP-Regular）と太字（NotoSansJP-Bold）を 1 つにした .ttc。
function notoTtc() {
  return buildTtc(['NotoSansJP-Regular.ttf', 'NotoSansJP-Bold.ttf'].map((name) => fs.readFileSync(path.join(FONT_DIR, name))));
}

module.exports = { FONT_DIR, buildTtc, notoTtc };
