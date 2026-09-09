'use strict';

// 画像を覗く・選ぶ経路（spec-3-1 確定事項2・4）。依存なしで回る層で、fs と dialog は偽物を渡す。

const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_IMAGE_BYTES, HEAD_BYTES, IMAGE_FILTERS, inspectImage, pickImageSources, createImageIo } = require('../image-io.js');
const { makePng, makeJpeg, GIF89A } = require('./fixtures/images.js');

const IN_A = 'C:/in/a.png';
const IN_B = 'C:/in/b.jpg';

// 偽の fs。open() で先頭だけ読んだ回数と readFile() の回数を数え、「先頭で足りたか」を見る。
function fsFor(files, { fail = null } = {}) {
  const counts = { head: 0, whole: 0 };
  const enoent = (target) => Object.assign(new Error(`ENOENT ${target}`), { code: 'ENOENT' });
  return {
    counts,
    fsLike: {
      promises: {
        stat: async (target) => {
          if (fail?.code !== undefined)
            throw Object.assign(new Error(fail.code), { code: fail.code });
          if (!(target in files))
            throw enoent(target);
          const entry = files[target];
          return { isFile: () => entry.dir !== true, size: entry.dir === true ? 0 : entry.bytes.length };
        },
        open: async (target) => {
          counts.head += 1;
          const bytes = files[target].bytes;
          return {
            read: async (buffer, offset, length, position) => {
              const slice = bytes.subarray(position, position + length);
              slice.copy(buffer, offset);
              return { bytesRead: slice.length };
            },
            close: async () => {},
          };
        },
        readFile: async (target) => {
          counts.whole += 1;
          return files[target].bytes;
        },
      },
    },
  };
}

test('先頭だけ読んで形式・画素数・名前を返す', async () => {
  const { fsLike, counts } = fsFor({ [IN_A]: { bytes: makePng({ width: 1200, height: 800 }) }, [IN_B]: { bytes: makeJpeg({ width: 4032, height: 3024 }) } });
  const png = await inspectImage(IN_A, { fsLike });
  assert.deepEqual(png, { ok: true, path: IN_A, name: 'a.png', size: png.size, kind: 'png', width: 1200, height: 800 });
  const jpeg = await inspectImage(IN_B, { fsLike });
  assert.equal(jpeg.kind, 'jpeg');
  assert.deepEqual([jpeg.width, jpeg.height], [4032, 3024]);
  assert.equal(counts.head, 2);
  assert.equal(counts.whole, 0, '先頭で足りれば全体は読まない');
});

test('先頭 64KB に寸法が無ければ全体を読み直す', async () => {
  // APP1 を 40KB × 2 本入れた JPEG（セグメントの長さは 65535 まで）。SOF は先頭 64KB より後ろに来る。
  const app1 = () => {
    const segment = Buffer.alloc(40 * 1024, 0);
    segment[0] = 0xff; segment[1] = 0xe1;
    segment.writeUInt16BE(segment.length - 2, 2);
    return segment;
  };
  const jpeg = makeJpeg({ width: 300, height: 200 });
  const padded = Buffer.concat([jpeg.subarray(0, 2), app1(), app1(), jpeg.subarray(2)]);
  assert.ok(padded.length > HEAD_BYTES);
  const { fsLike, counts } = fsFor({ [IN_B]: { bytes: padded } });
  const result = await inspectImage(IN_B, { fsLike });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual([result.width, result.height], [300, 200]);
  assert.equal(counts.whole, 1);
});

test('断る理由は形式ごとに返し、kind を添える', async () => {
  const { fsLike } = fsFor({ 'C:/in/c.gif': { bytes: GIF89A }, 'C:/in/d.pdf': { bytes: Buffer.from('%PDF-1.7\n') }, 'C:/in/p.jpg': { bytes: makeJpeg({ marker: 0xc2 }) } });
  const gif = await inspectImage('C:/in/c.gif', { fsLike });
  assert.match(gif.error, /GIF はまだ変換できません/);
  assert.equal(gif.kind, 'gif');
  assert.match((await inspectImage('C:/in/d.pdf', { fsLike })).error, /PDF は画像ではありません/);
  assert.match((await inspectImage('C:/in/p.jpg', { fsLike })).error, /プログレッシブ/);
});

test('上限・無い・フォルダー・権限は読む前に断る', async () => {
  const big = { bytes: Buffer.alloc(8) };
  const { fsLike } = fsFor({ [IN_A]: big, 'C:/in/dir': { dir: true } });
  assert.match((await inspectImage(IN_A, { fsLike, maxBytes: 4 })).error, /大きすぎます。0MB まで/);
  assert.match((await inspectImage('C:/in/dir', { fsLike })).error, /ファイルではありません/);
  assert.match((await inspectImage('C:/in/none.png', { fsLike })).error, /見つかりません/);
  assert.match((await inspectImage('', { fsLike })).error, /指定されていません/);
  const denied = fsFor({}, { fail: { code: 'EACCES' } });
  const logs = [];
  assert.match((await inspectImage(IN_A, { fsLike: denied.fsLike, onError: (entry) => logs.push(entry) })).error, /権限/);
  assert.equal(logs.length, 1);
  assert.ok(MAX_IMAGE_BYTES < 200 * 1024 * 1024, 'PDF の上限より小さい');
});

test('pickImageSources は画像のフィルターで複数選択させ、親の有無で呼び分ける', async () => {
  const calls = [];
  const dialogLike = {
    showOpenDialog: async (...args) => {
      calls.push(args);
      return { canceled: false, filePaths: [IN_B, IN_A, ''] };
    },
  };
  assert.deepEqual(await pickImageSources({ dialogLike, defaultPath: 'C:/in' }), { paths: [IN_B, IN_A] });
  assert.equal(calls[0].length, 1, '親が無ければ options だけ');
  assert.deepEqual(calls[0][0].properties, ['openFile', 'multiSelections']);
  assert.deepEqual(calls[0][0].filters, IMAGE_FILTERS);
  assert.equal(calls[0][0].defaultPath, 'C:/in');

  const parent = { id: 1 };
  await pickImageSources({ dialogLike, parentWindow: parent });
  assert.equal(calls[1][0], parent, '親があれば先頭に渡す');

  assert.deepEqual(await pickImageSources({ dialogLike: { showOpenDialog: async () => ({ canceled: true }) } }), { canceled: true });
  assert.deepEqual(await pickImageSources({ dialogLike: { showOpenDialog: async () => ({ canceled: false, filePaths: [] }) } }), { canceled: true });
});

test('createImageIo は inspect と pickSources をまとめる', async () => {
  const io = createImageIo({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [IN_A] }) } });
  assert.deepEqual(await io.pickSources(null, {}), { paths: [IN_A] });
  assert.equal(io.MAX_IMAGE_BYTES, MAX_IMAGE_BYTES);
  assert.match((await io.inspect('C:/in/none.png')).error, /見つかりません/);
});
