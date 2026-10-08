'use strict';

// 起動確認の JPEG の検体（main.js の makeSmokeJpeg。SIGK_SMOKE_CONVERT_JPEG=1）。配布物には test/ を同梱しないので、
// test/fixtures/image-wide.png が無いときは smokeSampleBitmap が描く横長の絵から作る。
// main.js は Electron なしでは読み込めないので、smokeSampleBitmap は本文を文字で切り出して動かし、
// makeSmokeJpeg の分かれ道は文字で見る。JPEG にする所（nativeImage）は起動確認で確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`\\n {2}function ${name}\\([\\s\\S]*?\\n {2}\\}\\r?\\n`).exec(MAIN);
  assert.ok(match, `main.js に ${name} がある`);
  return match[0];
}

// 切り出すのはこのリポジトリの main.js の 1 関数だけ。Buffer のほかは何も渡さない別の文脈で動かす。
function loadSmokeSampleBitmap() {
  return vm.runInNewContext(`${functionSource('smokeSampleBitmap')}\nsmokeSampleBitmap;`, { Buffer });
}

// BGRA の並びの (x, y) の 1 画素を [青, 緑, 赤, 不透明度] で返す。
function pixelAt(bitmap, width, x, y) {
  const offset = (y * width + x) * 4;
  return [...bitmap.subarray(offset, offset + 4)];
}

test('smokeSampleBitmap は幅×高さ×4 バイトの BGRA を返し、どの画素も不透明', () => {
  const bitmap = loadSmokeSampleBitmap()(400, 240);
  assert.ok(Buffer.isBuffer(bitmap));
  assert.equal(bitmap.length, 400 * 240 * 4);
  for (let offset = 3; offset < bitmap.length; offset += 4)
    assert.equal(bitmap[offset], 0xff, `不透明度（${offset} バイト目）`);
});

test('smokeSampleBitmap の絵は、白地に濃い枠・上の青の帯・左下の赤の四角', () => {
  const bitmap = loadSmokeSampleBitmap()(400, 240);
  const at = (x, y) => pixelAt(bitmap, 400, x, y);
  const frame = [0x30, 0x24, 0x1c, 0xff];
  assert.deepEqual([at(0, 0), at(399, 0), at(0, 239), at(399, 239), at(200, 2)], [frame, frame, frame, frame, frame]);
  assert.deepEqual(at(200, 20), [0xeb, 0x6f, 0x2f, 0xff], '上の帯は青（RGB #2f6feb）');
  assert.deepEqual(at(60, 180), [0x45, 0x45, 0xd6, 0xff], '左下の四角は赤（RGB #d64545）');
  assert.deepEqual([at(300, 180), at(60, 80)], [[0xff, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff]], 'ほかは白');
  // 赤の四角は左半分だけにあり、右半分には無い（左右の向きが分かる）。
  assert.deepEqual(at(340, 180), [0xff, 0xff, 0xff, 0xff]);
});

test('makeSmokeJpeg は image-wide.png があればそれを使い、無ければ横長の合成の絵から作る', () => {
  const source = functionSource('makeSmokeJpeg');
  assert.match(source, /const fixture = path\.join\(__dirname, 'test', 'fixtures', 'image-wide\.png'\);/);
  assert.match(source, /fs\.existsSync\(fixture\)\s*\? nativeImage\.createFromBuffer\(fs\.readFileSync\(fixture\)\)\s*: nativeImage\.createFromBitmap\(smokeSampleBitmap\(size\.width, size\.height\), size\)/);
  const [, width, height] = /const size = \{ width: (\d+), height: (\d+) \};/.exec(source).map(Number);
  assert.ok(width > height, `合成の絵も横長（${width}×${height}）。「横長の JPEG は自動で横向きに置く」を通すため`);
  // fixtures の image-wide.png も横長である（開発ツリーで使う側）。
  const png = fs.readFileSync(path.join(__dirname, 'fixtures', 'image-wide.png'));
  assert.ok(png.readUInt32BE(16) > png.readUInt32BE(20));
});
