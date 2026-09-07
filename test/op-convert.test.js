'use strict';

// 画像→PDF の層のテスト（spec-3-1 確定事項22〜25・28〜31）。
//
// 前半は op-convert.js を読み口の差し替えで（ディスクを触らない）、後半は runConvert を
// fixture の PNG でファイルとして通す。fixture だけを使う（.claude/CLAUDE.md 付則C）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFPage, rgb } = require('pdf-lib');
const { toBytes } = require('../file-io.js');
const { loadImage, convertToSingle, convertToEach } = require('../worker/op-convert.js');
const { runConvert, runTask } = require('../worker/pdf-task.js');
const { tempPathFor } = require('../pdf-write.js');
const { fixturePath } = require('./fixtures/build.js');
const { makePng, makeJpeg, GIF89A } = require('./fixtures/images.js');

const TOOLS = { PDFDocument, PDFPage, rgb };
const A4 = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: A4.height, height: A4.width };
const MARGIN = 56.69;
const layoutFor = (page) => ({ page, box: { x: MARGIN, y: MARGIN, width: page.width - 2 * MARGIN, height: page.height - 2 * MARGIN }, allowUpscale: true });

function readerFor(files) {
  return {
    readFile: async (target) => {
      if (!(target in files))
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return toBytes(files[target]);
    },
  };
}

function entriesFor(files, layout = layoutFor(A4)) {
  const reader = readerFor(files);
  return Object.keys(files).map((name) => ({ name, layout, load: () => loadImage(name, reader) }));
}

async function reload(doc) {
  return PDFDocument.load(await doc.save({ addDefaultPage: false }), { updateMetadata: false });
}

// ---- loadImage（確定事項30） ----

test('読めるもの・断るものを名前無しの文言で返す', async () => {
  const reader = readerFor({ 'a.png': makePng(), 'b.jpg': makeJpeg(), 'c.gif': GIF89A, 'd.pdf': Buffer.from('%PDF-1.7\n'), 'p.jpg': makeJpeg({ marker: 0xc2 }) });
  assert.equal((await loadImage('a.png', reader)).kind, 'png');
  assert.equal((await loadImage('b.jpg', reader)).kind, 'jpeg');
  assert.match((await loadImage('c.gif', reader)).error, /GIF はまだ変換できません/);
  assert.match((await loadImage('d.pdf', reader)).error, /PDF は画像ではありません/);
  assert.match((await loadImage('p.jpg', reader)).error, /プログレッシブ/);
  assert.match((await loadImage('missing.png', reader)).error, /読めませんでした/);
});

// ---- convertToSingle（確定事項23・29） ----

test('N 枚が順に N ページになり、紙は layout のとおり', async () => {
  const files = { 'wide.png': makePng({ width: 120, height: 80 }), 'tall.png': makePng({ width: 60, height: 90 }), 'tiny.jpg': makeJpeg({ width: 16, height: 8 }) };
  const entries = entriesFor(files);
  entries[0].layout = layoutFor(A4_LANDSCAPE);
  const progress = [];
  const result = await convertToSingle(entries, TOOLS, { onProgress: (done, total) => progress.push(`${done}/${total}`) });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 3);
  assert.deepEqual(progress, ['1/3', '2/3', '3/3']);

  const back = await reload(result.doc);
  assert.equal(back.getPageCount(), 3);
  assert.deepEqual(back.getPage(0).getSize(), A4_LANDSCAPE);
  assert.deepEqual(back.getPage(1).getSize(), A4);
  assert.deepEqual(back.getPage(2).getSize(), A4);
});

test('断る画像はファイル名を添えて全体を止める', async () => {
  const entries = entriesFor({ 'a.png': makePng(), 'b.gif': GIF89A, 'c.png': makePng() });
  const result = await convertToSingle(entries, TOOLS);
  assert.match(result.error, /^「b\.gif」GIF はまだ変換できません/);
  assert.equal(result.doc, undefined);
});

test('入力が無い・紙が決まっていないものは断る', async () => {
  assert.match((await convertToSingle([], TOOLS)).error, /画像がありません/);
  const entries = entriesFor({ 'a.png': makePng() });
  entries[0].layout = { page: A4, box: { x: 0, y: 0, width: 0, height: 10 } };
  assert.match((await convertToSingle(entries, TOOLS)).error, /「a\.png」紙の大きさ/);
});

// ---- convertToEach（確定事項23〜25） ----

test('1枚ごとに別の文書を onPart へ渡し、呼ぶ側が書く', async () => {
  const entries = entriesFor({ 'a.png': makePng({ width: 40, height: 20 }), 'b.png': makePng({ width: 20, height: 40 }) });
  const parts = [];
  const result = await convertToEach(entries, TOOLS, {
    onPart: async (index, doc) => {
      parts.push({ index, pages: doc.getPageCount(), size: doc.getPage(0).getSize() });
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: true, written: 2 });
  assert.deepEqual(parts.map((part) => [part.index, part.pages]), [[0, 1], [1, 1]]);
});

test('途中で onPart が断ったら、そこで止めて書けた本数を添える', async () => {
  const entries = entriesFor({ 'a.png': makePng(), 'b.png': makePng(), 'c.png': makePng() });
  let calls = 0;
  const result = await convertToEach(entries, TOOLS, {
    onPart: async (index) => {
      calls += 1;
      return index === 1 ? { error: '2 本目を書けませんでした。' } : { ok: true };
    },
  });
  assert.deepEqual(result, { error: '2 本目を書けませんでした。', written: 1 });
  assert.equal(calls, 2, '3本目には進まない');
});

test('読めない画像が2枚目なら、1本書いたところで止まる', async () => {
  const entries = entriesFor({ 'a.png': makePng(), 'b.gif': GIF89A });
  const result = await convertToEach(entries, TOOLS);
  assert.match(result.error, /^「b\.gif」/);
  assert.equal(result.written, 1);
});

// ---- runConvert / runTask（ファイルとして通す） ----

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-convert-'));
  return {
    dir,
    copyIn: (name, as = name) => {
      const to = path.join(dir, as);
      fs.copyFileSync(fixturePath(name), to);
      return to;
    },
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('まとめる: read → load → apply n/N → save → write と流れ、1本書く', async () => {
  const ws = workspace();
  try {
    const wide = ws.copyIn('image-wide.png');
    const tall = ws.copyIn('image-tall.png');
    const target = ws.file('out.pdf');
    const phases = [];
    const result = await runConvert({
      kind: 'convert', output: 'single',
      images: [{ path: wide, name: 'image-wide.png', layout: layoutFor(A4_LANDSCAPE) }, { path: tall, name: 'image-tall.png', layout: layoutFor(A4) }],
      target, targets: [target],
    }, { advance: (phase, done, total) => phases.push(Number.isInteger(done) ? `${phase} ${done}/${total}` : phase) });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.pages, 2);
    assert.equal(result.inputs, 2);
    assert.deepEqual(phases, ['read', 'load', 'apply 0/2', 'apply 1/2', 'apply 2/2', 'save', 'write']);

    const back = await PDFDocument.load(fs.readFileSync(target), { updateMetadata: false });
    assert.equal(back.getPageCount(), 2);
    assert.deepEqual(back.getPage(0).getSize(), A4_LANDSCAPE);
    assert.deepEqual(back.getPage(1).getSize(), A4);
    assert.equal(fs.existsSync(tempPathFor(target)), false, '一時ファイルは残らない');
  } finally {
    ws.cleanup();
  }
});

test('画像ごと: write を出力単位で刻み、N 本書く', async () => {
  const ws = workspace();
  try {
    const images = ['image-wide.png', 'image-small.png', 'image-alpha.png'].map((name) => ({
      path: ws.copyIn(name), name, layout: layoutFor(A4), target: ws.file(name.replace(/\.png$/, '.pdf')),
    }));
    const phases = [];
    const result = await runTask({ kind: 'convert', output: 'each', images, targets: images.map((image) => image.target) },
      { send: (message) => { if (message.type === 'progress') phases.push(Number.isInteger(message.done) ? `${message.phase} ${message.done}/${message.total}` : message.phase); } });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.written, 3);
    assert.deepEqual(result.targets, images.map((image) => image.target));
    assert.deepEqual(phases, ['read', 'load', 'apply', 'save', 'write 0/3', 'write 1/3', 'write 2/3', 'write 3/3']);
    for (const image of images) {
      const back = await PDFDocument.load(fs.readFileSync(image.target), { updateMetadata: false });
      assert.equal(back.getPageCount(), 1);
    }
  } finally {
    ws.cleanup();
  }
});

test('画像ごと: 書けない出力先で止まり、書き終えた分は残る', async () => {
  const ws = workspace();
  try {
    const first = { path: ws.copyIn('image-wide.png'), name: 'image-wide.png', layout: layoutFor(A4), target: ws.file('first.pdf') };
    // 2本目の出力先を「フォルダー」にして書けなくする。
    fs.mkdirSync(ws.file('second.pdf'));
    const second = { path: ws.copyIn('image-tall.png'), name: 'image-tall.png', layout: layoutFor(A4), target: ws.file('second.pdf') };
    const third = { path: ws.copyIn('image-small.png'), name: 'image-small.png', layout: layoutFor(A4), target: ws.file('third.pdf') };
    const result = await runConvert({ kind: 'convert', output: 'each', images: [first, second, third], targets: [first.target, second.target, third.target] });
    assert.match(result.error, /^2 \/ 3 本目を書けませんでした/);
    assert.equal(result.written, 1);
    assert.ok(fs.statSync(first.target).size > 0, '1本目は残る');
    assert.equal(fs.existsSync(third.target), false, '3本目には進まない');
  } finally {
    ws.cleanup();
  }
});

test('4KB 未満の JPEG も埋め込める（toBytes の回帰）', async () => {
  // readFileSync は小さいファイルでプール Buffer を返す。toBytes を通さないと embedJpg が
  // byteOffset≠0 を拒む（spec-1-6 確定事項55）。ヘッダーだけの JPEG は 30 バイトほどしかない。
  const ws = workspace();
  try {
    const tiny = ws.file('tiny.jpg');
    fs.writeFileSync(tiny, makeJpeg({ width: 16, height: 8 }));
    assert.ok(fs.statSync(tiny).size < 4096);
    const target = ws.file('tiny.pdf');
    const result = await runConvert({ kind: 'convert', output: 'single', images: [{ path: tiny, layout: layoutFor(A4) }], target, targets: [target] });
    assert.equal(result.ok, true, result.error);
  } finally {
    ws.cleanup();
  }
});

test('spec の欠けは書く前に断る', async () => {
  assert.match((await runConvert({ kind: 'convert', images: [] })).error, /画像がありません/);
  assert.match((await runConvert({ kind: 'convert', images: [{ layout: layoutFor(A4) }] })).error, /場所が分かりません/);
  assert.match((await runConvert({ kind: 'convert', images: [{ path: 'x.png' }] })).error, /紙の大きさ/);
  assert.match((await runConvert({ kind: 'convert', output: 'zip', images: [{ path: 'x.png', layout: layoutFor(A4) }] })).error, /方式/);
  assert.match((await runConvert({ kind: 'convert', output: 'single', images: [{ path: 'x.png', layout: layoutFor(A4) }] })).error, /保存先/);
  assert.match((await runConvert({ kind: 'convert', output: 'each', images: [{ path: 'x.png', layout: layoutFor(A4) }] })).error, /出力先/);
});
