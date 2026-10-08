'use strict';

// 起動確認の JPEG の検体（main.js の makeSmokeJpeg。SIGK_SMOKE_CONVERT_JPEG=1）。配布物には test/ を同梱しないので、
// test/fixtures/image-wide.png が無いときは smokeSampleBitmap が描く横長の絵から作る。
// main.js は Electron なしでは読み込めないので、smokeSampleBitmap と makeSmokeJpeg は本文を文字で切り出して vm で動かす。
// makeSmokeJpeg には作り物の fs と nativeImage を渡し、呼ばれ方を控えて分かれ道を見る。本物の JPEG にする所は起動確認で確かめる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`\\n {2}function ${name}\\([\\s\\S]*?\\n {2}\\}\\r?\\n`).exec(MAIN);
  assert.ok(match, `main.js から ${name} の本文を切り出せる（2 字下げの function ${name}( 〜 2 字下げの } の行）`);
  return match[0];
}

// 切り出すのはこのリポジトリの main.js の関数だけ。Buffer のほかは何も渡さない別の文脈で動かす。
function loadSmokeSampleBitmap() {
  return vm.runInNewContext(`${functionSource('smokeSampleBitmap')}\nsmokeSampleBitmap;`, { Buffer });
}

// makeSmokeJpeg を、smokeSampleBitmap と一緒に別の文脈で動かす。fs・nativeImage は作り物で、呼ばれ方を calls に控える。
// fixtureExists は作り物の fs.existsSync が返す値（image-wide.png があるか）。
function runMakeSmokeJpeg({ fixtureExists, dir }) {
  const calls = { existsSync: [], readFileSync: [], writeFileSync: [], createFromBuffer: [], createFromBitmap: [] };
  const png = Buffer.from('作り物の PNG');
  const jpeg = { buffer: Buffer.from('作り物の JPEG（PNG から）'), bitmap: Buffer.from('作り物の JPEG（合成の絵から）') };
  const imageOf = (from) => ({ toJPEG: (quality) => { calls[`toJPEG:${from}`] = quality; return jpeg[from]; } });
  const fakeFs = {
    existsSync: (file) => { calls.existsSync.push(file); return fixtureExists; },
    readFileSync: (file) => { calls.readFileSync.push(file); return png; },
    writeFileSync: (file, data) => { calls.writeFileSync.push({ file, data }); },
  };
  const nativeImage = {
    createFromBuffer: (buffer) => { calls.createFromBuffer.push(buffer); return imageOf('buffer'); },
    createFromBitmap: (bitmap, size) => { calls.createFromBitmap.push({ bitmap, size }); return imageOf('bitmap'); },
  };
  const source = `${functionSource('smokeSampleBitmap')}\n${functionSource('makeSmokeJpeg')}\nmakeSmokeJpeg;`;
  const makeSmokeJpeg = vm.runInNewContext(source, { fs: fakeFs, nativeImage, path, __dirname: ROOT, Buffer });
  return { target: makeSmokeJpeg(dir), calls, png, jpeg };
}

// BGRA の並びの (x, y) の 1 画素を [青, 緑, 赤, 不透明度] で返す。
function pixelAt(bitmap, width, x, y) {
  const offset = (y * width + x) * 4;
  return [...bitmap.subarray(offset, offset + 4)];
}

const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'image-wide.png');
const OUT_DIR = path.join(ROOT, 'smoke-out');

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

test('makeSmokeJpeg は image-wide.png が無い（配布物）とき、PNG を読まずに横長の合成の絵（400×240）から JPEG を作る', () => {
  const { target, calls, jpeg } = runMakeSmokeJpeg({ fixtureExists: false, dir: OUT_DIR });
  assert.deepEqual(calls.existsSync, [FIXTURE], 'image-wide.png があるかを 1 度だけ見る');
  assert.deepEqual(calls.readFileSync, [], '無い PNG を読みに行かない（読むと配布物では ENOENT で止まる）');
  assert.deepEqual(calls.createFromBuffer, []);
  assert.equal(calls.createFromBitmap.length, 1);
  const [{ bitmap, size }] = calls.createFromBitmap;
  // size は vm の文脈で作った物なので、こちらの文脈の物に写してから比べる（deepStrictEqual は原型まで見る）。
  assert.deepEqual({ ...size }, { width: 400, height: 240 });
  assert.ok(size.width > size.height, `合成の絵も横長（${size.width}×${size.height}）。「横長の JPEG は自動で横向きに置く」を通すため`);
  assert.ok(Buffer.isBuffer(bitmap));
  assert.equal(bitmap.length, 400 * 240 * 4);
  assert.ok(bitmap.equals(loadSmokeSampleBitmap()(400, 240)), 'createFromBitmap に渡るのは smokeSampleBitmap の絵');
  assert.equal(calls['toJPEG:bitmap'], 90);
  assert.equal(target, path.join(OUT_DIR, 'smoke-wide.jpg'));
  assert.equal(calls.writeFileSync.length, 1);
  assert.equal(calls.writeFileSync[0].file, target);
  assert.equal(calls.writeFileSync[0].data, jpeg.bitmap, '合成の絵の toJPEG の結果を smoke-wide.jpg に書く');
});

test('makeSmokeJpeg は image-wide.png がある（開発ツリー）とき、その PNG から JPEG を作り、合成の絵は使わない', () => {
  const { target, calls, png, jpeg } = runMakeSmokeJpeg({ fixtureExists: true, dir: OUT_DIR });
  assert.deepEqual(calls.existsSync, [FIXTURE]);
  assert.deepEqual(calls.readFileSync, [FIXTURE]);
  assert.equal(calls.createFromBuffer.length, 1);
  assert.equal(calls.createFromBuffer[0], png, 'createFromBuffer に渡るのは読んだ PNG');
  assert.deepEqual(calls.createFromBitmap, []);
  assert.equal(calls['toJPEG:buffer'], 90);
  assert.deepEqual(calls.writeFileSync.map(({ file, data }) => [file, data]), [[target, jpeg.buffer]]);
  assert.equal(target, path.join(OUT_DIR, 'smoke-wide.jpg'));
  // fixtures の image-wide.png も横長である（開発ツリーで使う側）。
  const real = fs.readFileSync(FIXTURE);
  assert.ok(real.readUInt32BE(16) > real.readUInt32BE(20));
});
