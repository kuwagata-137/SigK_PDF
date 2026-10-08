'use strict';

// 出来上がりのアイコン（docs/spec-5-2-open-with-icon.md 確定事項B3・B4・B6）。
// ICO は scripts/build-icons.js（npm run icons）が build/ の SVG から作り、リポジトリに置いてある。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readIco } = require('../scripts/ico-file.js');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

for (const file of ['assets/icon.ico', 'build/pdf-file.ico']) {
  test(`${file} に 16〜256px の 8 つの大きさが、透明の地の PNG で入っている`, () => {
    const entries = readIco(fs.readFileSync(path.join(ROOT, file)));
    assert.deepEqual(entries.map(({ width }) => width), SIZES);
    for (const { width, height, bitCount, png } of entries) {
      assert.ok(png !== null, `${width}px が PNG でない`);
      assert.deepEqual([png.width, png.height], [width, height], `${width}px の目録と中身の大きさが違う`);
      assert.equal(png.colorType, 6, `${width}px が透明の地（RGBA）でない`);
      assert.equal(bitCount, 32);
    }
  });
}

test('元の SVG が在り、XML のコメントにハイフン 2 つの並びが無い（あると SVG ごと読めない）', () => {
  for (const name of ['icon-app', 'icon-app-small', 'icon-pdf-file', 'icon-pdf-file-small']) {
    const svg = fs.readFileSync(path.join(ROOT, 'build', `${name}.svg`), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256">/, name);
    for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g))
      assert.equal(body.includes('--'), false, `${name} のコメント`);
  }
});

test('electron-builder がアプリのアイコンを exe に入れ、PDF ファイルの絵を resources へ出す', () => {
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  // アプリのアイコンは assets/** で app.asar にも入り、窓の左上とバージョン情報が読む。
  assert.ok(pkg.build.files.includes('assets/**'));
  // シェルは app.asar の中を読めないので、PDF ファイルの絵は resources\pdf-file.ico に出す（installer.nsh の SIGK_PDF_FILE_ICON）。
  assert.deepEqual(pkg.build.extraResources, [{ from: 'build/pdf-file.ico', to: 'pdf-file.ico' }]);
  assert.equal(pkg.scripts.icons, 'electron scripts/build-icons.js');
});
