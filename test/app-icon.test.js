'use strict';

// 出来上がりのアイコン（docs/spec-5-2-open-with-icon.md 確定事項B3・B4・B6）。
// ICO は scripts/build-icons.js（npm run icons）が build/ の SVG から作り、リポジトリに置いてある。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');

const { readIco, pngInfo } = require('../scripts/ico-file.js');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const SVGS = ['icon-app', 'icon-app-small', 'icon-pdf-file', 'icon-pdf-file-small'];
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const icoOf = (file) => readIco(fs.readFileSync(path.join(ROOT, file)));

// 8 ビット RGBA・インターレースなしの PNG をほどいて、画素の並び（RGBA）を返す。
function decodePng(png) {
  const { width, height } = pngInfo(png);
  const idat = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT')
      idat.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      // PNG の行の filter（0 なし・1 左・2 上・3 平均・4 Paeth）。
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      assert.ok(predictor !== undefined, `PNG の行の filter ${filter}`);
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + predictor) & 0xff;
    }
  }
  const at = (x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  let ink = 0;
  for (let i = 3; i < pixels.length; i += 4)
    ink += pixels[i] !== 0 ? 1 : 0;
  return { width, height, at, inkRatio: ink / (width * height) };
}

for (const file of ['assets/icon.ico', 'build/pdf-file.ico']) {
  test(`${file} に 16〜256px の 8 つの大きさが、透明の地の PNG で入っている`, () => {
    const entries = icoOf(file);
    assert.deepEqual(entries.map(({ width }) => width), SIZES);
    for (const { width, height, bitCount, png, data } of entries) {
      assert.ok(png !== null, `${width}px が PNG でない`);
      assert.deepEqual([png.width, png.height], [width, height], `${width}px の目録と中身の大きさが違う`);
      assert.deepEqual([png.colorType, png.bitDepth, bitCount], [6, 8, 32], `${width}px が 8 ビットの RGBA でない`);
      // 角は透明（地が白などで塗られていない）で、絵の画素は 3 割以上ある（描きかけでない）。
      const image = decodePng(data);
      for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]])
        assert.equal(image.at(x, y)[3], 0, `${width}px の角 (${x},${y}) が透明でない`);
      assert.ok(image.inkRatio >= 0.3, `${width}px の絵の画素が ${Math.round(image.inkRatio * 100)}%`);
    }
  });
}

test('2 つの ICO は取り違えていない（アプリは青い札、PDF ファイルは白い紙）', () => {
  const app = decodePng(icoOf('assets/icon.ico').at(-1).data);
  const file = decodePng(icoOf('build/pdf-file.ico').at(-1).data);
  const [r, g, b, a] = app.at(20, 128);
  assert.ok(a === 255 && b > 200 && r < 120 && g < 160, `アプリの札の左の縁が青くない: ${[r, g, b, a]}`);
  const [pr, pg, pb, pa] = file.at(60, 40);
  assert.ok(pa === 255 && pr > 240 && pg > 240 && pb > 240, `PDF ファイルの紙の左上が白くない: ${[pr, pg, pb, pa]}`);
  assert.equal(file.at(20, 128)[3], 0, 'PDF ファイルの絵は紙の外が透明');
});

test('元の SVG は XML として正しい（コメントの「--」なども、jsdom の XML の読み取りで見つける）', () => {
  const parser = new (new JSDOM('').window.DOMParser)();
  for (const name of SVGS) {
    const svg = fs.readFileSync(path.join(ROOT, 'build', `${name}.svg`), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256">/, name);
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.getElementsByTagName('parsererror').length, 0, `${name} が XML として読めない`);
  }
  // 見張りが効くこと: コメントにハイフン 2 つがあると読めない。
  assert.ok(parser.parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><!-- a -- b --></svg>', 'image/svg+xml').getElementsByTagName('parsererror').length > 0);
});

test('ICO は今の SVG から作ってある（SVG を直して npm run icons を回し忘れていない）', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'icon-sources.json'), 'utf8'));
  const expected = Object.fromEntries(SVGS.map((name) => {
    const text = fs.readFileSync(path.join(ROOT, 'build', `${name}.svg`), 'utf8').replace(/\r\n/g, '\n');
    return [`build/${name}.svg`, crypto.createHash('sha256').update(text).digest('hex')];
  }));
  assert.deepEqual(sources, expected);
});

test('electron-builder がアプリのアイコンを exe に入れ、PDF ファイルの絵を resources へ出す', () => {
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  // アプリのアイコンは assets/** で app.asar にも入り、窓の左上とバージョン情報が読む。
  assert.ok(pkg.build.files.includes('assets/**'));
  // シェルは app.asar の中を読めないので、PDF ファイルの絵は resources\pdf-file.ico に出す（installer.nsh の SIGK_PDF_FILE_ICON）。
  assert.deepEqual(pkg.build.extraResources, [{ from: 'build/pdf-file.ico', to: 'pdf-file.ico' }]);
  assert.equal(pkg.scripts.icons, 'electron scripts/build-icons.js');
});
