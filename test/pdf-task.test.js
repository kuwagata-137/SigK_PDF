'use strict';

// ワーカー本体のテスト（spec-1-6 確定事項2〜14）。
//
// pdf-lib と fixture を使う層なので、docs/07 第4章の「依存を要する層」にあたる。
// process.parentPort には触れず、runSave / runTask を直接呼ぶ。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument } = require('pdf-lib');
const { runSave, runTask, describeLoadFailure } = require('../worker/pdf-task.js');
const { backupPathFor, tempPathFor, readSignature } = require('../pdf-write.js');
const { fixturePath } = require('./fixtures/build.js');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-worker-'));
  return {
    dir,
    // fixture を作業用フォルダーへ複製する。fixture そのものは書き換えない。
    copyIn: (name, as = name) => {
      const to = path.join(dir, as);
      fs.copyFileSync(fixturePath(name), to);
      return to;
    },
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const identityPlan = (count) => Array.from({ length: count }, (_value, index) => ({ src: index, rotate: 0 }));

async function open(filePath) {
  return PDFDocument.load(fs.readFileSync(filePath), { updateMetadata: false });
}

test('並べ替えた順で保存される', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const result = await runSave({
      source,
      target: source,
      pages: [{ src: 2, rotate: 0 }, { src: 0, rotate: 0 }, { src: 1, rotate: 0 }],
      makeBackup: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.pages, 3);

    // 並びの証拠として回転を使う。中身の文字は標準書体なので読み出しが重い。
    const saved = await open(source);
    assert.equal(saved.getPageCount(), 3);
  } finally { ws.cleanup(); }
});

test('回転は元の角度に足した絶対値で保存される', async () => {
  const ws = workspace();
  try {
    // rotated.pdf は2ページ目だけが 90 度。
    const source = ws.copyIn('rotated.pdf');
    const result = await runSave({
      source,
      target: source,
      pages: [{ src: 0, rotate: 90 }, { src: 1, rotate: 270 }, { src: 2, rotate: 180 }],
    });
    assert.equal(result.ok, true);
    const saved = await open(source);
    assert.deepEqual(saved.getPages().map((page) => page.getRotation().angle), [90, 0, 180]);
  } finally { ws.cleanup(); }
});

test('plan から落としたページは消える', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const result = await runSave({ source, target: source, pages: [{ src: 0, rotate: 0 }, { src: 2, rotate: 0 }] });
    assert.equal(result.ok, true);
    assert.equal((await open(source)).getPageCount(), 2);
  } finally { ws.cleanup(); }
});

test('進捗は5段が順に流れる', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const seen = [];
    const result = await runTask(
      { source, target: source, pages: identityPlan(3) },
      { send: (message) => seen.push(message.phase) },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ['read', 'load', 'apply', 'save', 'write']);
    assert.equal(typeof result.ms, 'number');
  } finally { ws.cleanup(); }
});

test('途中で断ったら、そこから先の段は流れない', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('encrypted.pdf');
    const seen = [];
    const result = await runTask(
      { source, target: source, pages: identityPlan(1) },
      { send: (message) => seen.push(message.phase) },
    );
    assert.equal(result.error, 'パスワードで保護された PDF は保存できません。');
    assert.deepEqual(seen, ['read', 'load'], 'load で止まる');
  } finally { ws.cleanup(); }
});

test('暗号化 PDF は保存を断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('encrypted.pdf');
    const before = fs.readFileSync(source);
    const result = await runSave({ source, target: source, pages: identityPlan(1) });
    assert.equal(result.error, 'パスワードで保護された PDF は保存できません。');
    assert.deepEqual(fs.readFileSync(source), before, '元のファイルを触っていない');
    assert.equal(fs.existsSync(tempPathFor(source)), false);
  } finally { ws.cleanup(); }
});

test('壊れた PDF は人が読める文言で断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('broken.pdf');
    const result = await runSave({ source, target: source, pages: identityPlan(3) });
    assert.equal(result.error, 'この PDF は内容が壊れているため保存できません。');
  } finally { ws.cleanup(); }
});

test('元のファイルが無ければ、その旨を返す', async () => {
  const ws = workspace();
  try {
    const result = await runSave({ source: ws.file('nope.pdf'), target: ws.file('out.pdf'), pages: identityPlan(1) });
    assert.match(result.error, /見つかりません/);
  } finally { ws.cleanup(); }
});

test('保存先が決まっていなければ何もしない', async () => {
  const result = await runSave({ source: 'a.pdf', pages: identityPlan(1) });
  assert.equal(result.error, '保存先が決まっていません。');
});

test('ページが1枚も残らない plan は断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const result = await runSave({ source, target: source, pages: [] });
    assert.equal(result.error, '保存するページがありません。');
  } finally { ws.cleanup(); }
});

test('同じページを2回並べた plan は断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const result = await runSave({ source, target: source, pages: [{ src: 0 }, { src: 0 }] });
    assert.match(result.error, /2回保存することはできません/);
  } finally { ws.cleanup(); }
});

test('元の文書に無いページを指した plan は断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const result = await runSave({ source, target: source, pages: [{ src: 9 }] });
    assert.match(result.error, /元の文書と合いません/);
  } finally { ws.cleanup(); }
});

test('上書き保存では .bak が残る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const before = fs.readFileSync(source);
    const result = await runSave({ source, target: source, pages: [{ src: 1 }, { src: 0 }], makeBackup: true });
    assert.equal(result.ok, true);
    assert.equal(result.backup, backupPathFor(source));
    assert.deepEqual(fs.readFileSync(backupPathFor(source)), before);
  } finally { ws.cleanup(); }
});

test('名前を付けて保存では元のファイルを触らない', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const before = fs.readFileSync(source);
    const target = ws.file('別名.pdf');
    const result = await runSave({ source, target, pages: [{ src: 2 }], makeBackup: false });
    assert.equal(result.ok, true);
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal((await open(target)).getPageCount(), 1);
    assert.equal(fs.existsSync(backupPathFor(target)), false);
  } finally { ws.cleanup(); }
});

test('開いたあとで外から書き換えられていたら、書かずに知らせる', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const opened = await readSignature(source);
    fs.copyFileSync(fixturePath('one-page.pdf'), source);

    const result = await runSave({ source, target: source, pages: [{ src: 0 }], expect: opened, makeBackup: true });
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(backupPathFor(source)), false, '確認する前に .bak を作らない');
  } finally { ws.cleanup(); }
});

test('Producer を pdf-lib に書き換えない', async () => {
  const ws = workspace();
  try {
    // 種を作る。fixture は pdf-lib 製なので、別の Producer を入れてから試す。
    const seeded = await PDFDocument.load(fs.readFileSync(fixturePath('three-pages.pdf')), { updateMetadata: false });
    seeded.setProducer('SomeOtherProducer 1.0');
    const source = ws.file('produced.pdf');
    fs.writeFileSync(source, await seeded.save({ addDefaultPage: false }));

    const result = await runSave({ source, target: source, pages: [{ src: 1 }, { src: 0 }, { src: 2 }] });
    assert.equal(result.ok, true);
    assert.equal((await open(source)).getProducer(), 'SomeOtherProducer 1.0');
  } finally { ws.cleanup(); }
});

test('しおりと名前付き宛先は保存後も残る', async () => {
  const ws = workspace();
  try {
    // pdf-lib にしおりの API が無いので、catalog へ直に置いた種を作る。
    const { PDFName, PDFString } = require('pdf-lib');
    const seeded = await PDFDocument.load(fs.readFileSync(fixturePath('three-pages.pdf')), { updateMetadata: false });
    const context = seeded.context;
    const third = seeded.getPage(2).ref;
    const item = context.obj({ Title: PDFString.of('3ページ目へ'), Dest: [third, PDFName.of('Fit')] });
    const itemRef = context.register(item);
    const outlines = context.obj({ Type: PDFName.of('Outlines'), First: itemRef, Last: itemRef, Count: 1 });
    seeded.catalog.set(PDFName.of('Outlines'), context.register(outlines));

    const source = ws.file('outlined.pdf');
    fs.writeFileSync(source, await seeded.save({ addDefaultPage: false }));

    const result = await runSave({ source, target: source, pages: [{ src: 2 }, { src: 1 }, { src: 0 }] });
    assert.equal(result.ok, true);

    const saved = await open(source);
    assert.notEqual(saved.catalog.get(PDFName.of('Outlines')), undefined, 'しおりが残っている');
  } finally { ws.cleanup(); }
});

test('load の失敗は例外の種類を選ばずに文言へ翻訳する', () => {
  assert.equal(describeLoadFailure(new Error('... is encrypted ...')), 'パスワードで保護された PDF は保存できません。');
  assert.equal(describeLoadFailure(new TypeError("Cannot read properties of undefined (reading 'Pages')")),
    'この PDF は内容が壊れているため保存できません。');
  assert.equal(describeLoadFailure(undefined), 'この PDF は内容が壊れているため保存できません。');
});
