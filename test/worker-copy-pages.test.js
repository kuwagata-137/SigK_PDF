'use strict';

// 写しの PDF を作る処理と、差し込み・保存の元をバイト列から読む処理のテスト（spec-2-5 確定事項I3〜I5。PR-4）。
//
// 写しは、引き始めた帯の今の見た目（保存していない並べ替え・回転・切り取り・書き込み・差し込み）を、ファイルに書かずに PDF のバイト列にする。
// 写した先では差し込み（plan の { insert }）として持ち、保存のときはパスの代わりに copies の鍵からバイト列を読む。名前の無い帯（新しい帯）は、
// 保存の元そのものがバイト列（sourceCopy）になる。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PDFDocument, PDFName } = require('pdf-lib');
const { runSave, runTask } = require('../worker/pdf-task.js');
const { fixturePath } = require('./fixtures/build.js');

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-copy-'));
  return {
    copyIn: (name, as = name) => {
      const to = path.join(dir, as);
      fs.copyFileSync(fixturePath(name), to);
      return to;
    },
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const load = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });

function annotSubtypes(doc, pageIndex) {
  const page = doc.getPages()[pageIndex];
  const annots = doc.context.lookup(page.node.get(PDFName.of('Annots')));
  if (annots === undefined)
    return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype')).asString());
}

function cropOf(page) {
  const box = page.getCropBox();
  return [box.x, box.y, box.x + box.width, box.y + box.height];
}

const MARKUP = { kind: 'highlight', color: '#ffe45a', opacity: 1, quads: [[48, 753, 232, 753, 48, 743, 232, 743]], rect: [48, 743, 232, 753] };
const NOT_FOUND = '差し込むページが見つからないので、もう一度やり直してください。';

// three-pages.pdf の 2 ページ目を 90 度回したものを、1 ページの写しにする。
async function copyOfSecondPageTurned(source) {
  return runTask({ kind: 'copy-pages', source, pages: [{ src: 1, rotate: 90 }], inserts: [], annotations: { add: [], remove: [] } });
}

test('copy-pages は選んだページを回転・切り取り・書き込みごと写し、ファイルを書かない', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const before = fs.readFileSync(source);
    const result = await runTask({
      kind: 'copy-pages',
      source,
      pages: [{ src: 1, rotate: 90 }, { src: 2, rotate: 0, crop: [50, 60, 300, 700] }],
      inserts: [],
      annotations: { add: [{ ...MARKUP, src: 1 }], remove: [] },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.pages, 2);
    assert.ok(result.bytes instanceof Uint8Array && result.bytes.length > 0);
    const copy = await load(result.bytes);
    assert.equal(copy.getPageCount(), 2);
    assert.deepEqual(copy.getPages().map((page) => page.getRotation().angle), [90, 0]);
    assert.deepEqual(cropOf(copy.getPage(1)), [50, 60, 300, 700]);
    assert.deepEqual(annotSubtypes(copy, 0), ['/Highlight']);
    assert.deepEqual(annotSubtypes(copy, 1), []);
    // 寸法は見えている大きさ（回したページは幅と高さが入れ替わり、切ったページは切った大きさ）。
    assert.deepEqual(result.sizes, [{ width: 841.89, height: 595.28 }, { width: 250, height: 640 }]);
    assert.deepEqual(fs.readFileSync(source), before, '元のファイルは変えない');
  } finally { ws.cleanup(); }
});

test('copy-pages は差し込んだページ（パスからとバイト列から）も写せる', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const inserted = ws.copyIn('one-page.pdf');
    const turned = await copyOfSecondPageTurned(source);
    assert.equal(turned.ok, true, turned.error);
    const result = await runTask({
      kind: 'copy-pages',
      source,
      pages: [{ insert: 0, rotate: 0 }, { insert: 1, rotate: 90 }, { src: 0, rotate: 0 }],
      inserts: [{ path: inserted, page: 0 }, { copy: 'c1', page: 0 }],
      copies: { c1: turned.bytes },
      annotations: { add: [], remove: [] },
    });
    assert.equal(result.ok, true, result.error);
    const copy = await load(result.bytes);
    assert.equal(copy.getPageCount(), 3);
    // 写しのページは元から 90 度回っているので、plan の 90 度を足して 180 度。
    assert.deepEqual(copy.getPages().map((page) => page.getRotation().angle), [0, 180, 0]);
  } finally { ws.cleanup(); }
});

test('写しを差し込んだ plan を保存すると、写しのページが入る（写しの写しも読める）', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const target = ws.copyIn('one-page.pdf', 'target.pdf');
    const turned = await copyOfSecondPageTurned(source);
    const nested = await runTask({
      kind: 'copy-pages', source: target, pages: [{ insert: 0, rotate: 0 }], inserts: [{ copy: 'c1', page: 0 }], copies: { c1: turned.bytes },
      annotations: { add: [], remove: [] },
    });
    assert.equal(nested.ok, true, nested.error);
    const saved = await runSave({
      source: target,
      target,
      pages: [{ src: 0, rotate: 0 }, { insert: 0, rotate: 0 }, { insert: 1, rotate: 0 }],
      inserts: [{ copy: 'c1', page: 0 }, { copy: 'c2', page: 0 }],
      copies: { c1: turned.bytes, c2: nested.bytes },
      annotations: { add: [], remove: [] },
      makeBackup: false,
    });
    assert.equal(saved.ok, true, saved.error);
    const doc = await load(fs.readFileSync(target));
    assert.equal(doc.getPageCount(), 3);
    assert.deepEqual(doc.getPages().map((page) => page.getRotation().angle), [0, 90, 90]);
  } finally { ws.cleanup(); }
});

test('source が null なら sourceCopy のバイト列を元にして保存する（名前の無い帯）', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const turned = await copyOfSecondPageTurned(source);
    const target = ws.file('新しい PDF 1.pdf');
    const saved = await runSave({
      source: null,
      sourceCopy: 'c1',
      copies: { c1: turned.bytes },
      target,
      pages: [{ src: 0, rotate: 90 }],
      annotations: { add: [{ ...MARKUP, src: 0 }], remove: [] },
      makeBackup: false,
    });
    assert.equal(saved.ok, true, saved.error);
    const doc = await load(fs.readFileSync(target));
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getRotation().angle, 180);
    assert.deepEqual(annotSubtypes(doc, 0), ['/Highlight']);
  } finally { ws.cleanup(); }
});

test('名前の無い帯からの抽出も、sourceCopy のバイト列を元にする（点検の指摘 3）', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const turned = await copyOfSecondPageTurned(source);
    const target = ws.file('新しい PDF 1_抽出.pdf');
    const extracted = await runSave({ kind: 'extract', source: null, sourceCopy: 'c1', copies: { c1: turned.bytes }, target, pages: [{ src: 0, rotate: 0 }], makeBackup: false });
    assert.equal(extracted.ok, true, extracted.error);
    const doc = await load(fs.readFileSync(target));
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getRotation().angle, 90);
  } finally { ws.cleanup(); }
});

test('copies に鍵が無い差し込みは、写すことも保存することも断る', async () => {
  const ws = workspace();
  try {
    const source = ws.copyIn('three-pages.pdf');
    const copied = await runTask({
      kind: 'copy-pages', source, pages: [{ insert: 0, rotate: 0 }], inserts: [{ copy: 'zz', page: 0 }], annotations: { add: [], remove: [] },
    });
    assert.equal(copied.error, NOT_FOUND);
    const saved = await runSave({
      source, target: source, pages: [{ src: 0, rotate: 0 }, { insert: 0, rotate: 0 }], inserts: [{ copy: 'zz', page: 0 }], copies: {},
      annotations: { add: [], remove: [] }, makeBackup: false,
    });
    assert.equal(saved.error, NOT_FOUND);
    const unnamed = await runSave({ source: null, sourceCopy: 'zz', copies: {}, target: ws.file('x.pdf'), pages: [{ src: 0, rotate: 0 }], makeBackup: false });
    assert.equal(unnamed.error, '保存する中身が見つからないので、もう一度やり直してください。');
  } finally { ws.cleanup(); }
});
