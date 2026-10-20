'use strict';

// 異常な PDF をワーカーの各実行に渡したとき（spec-6-1 タスク D の D6・D8）。どれも書き出さずに、人が読める文で断ることを見る。
// 画面ではこれらの PDF の多くは開けない（開けても保存とツールを事前に断る）ので、ここはワーカーの防具の確かめ。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runTask } = require('../worker/pdf-task.js');
const { MAX_PDF_BYTES } = require('../file-io.js');
const { fixturePath } = require('./fixtures/build.js');

const LOCKED = 'パスワードで保護された PDF は保存できません。';
const BROKEN = 'この PDF は内容が壊れているため保存できません。';
const INSERT_UNREADABLE = '内容が壊れているか、パスワードで保護されているので、差し込む PDF を読めませんでした。';
const INSERT_FORMAT = '対応していない形式なので、PNG・JPEG・BMP・GIF・TIFF・PDF を選んでください。';
const MARK = { type: 'text', text: '社外秘', color: '#808080', opacity: 0.3, angle: 45, size: 'medium', position: 'center' };

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigk-abnormal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'out.pdf');
}

const specsFor = (source, target) => ({
  watermark: { kind: 'watermark', source, target, pages: [0], mark: MARK },
  flatten: { kind: 'flatten', source, target, kinds: ['markup'] },
  'flatten-preview': { kind: 'flatten-preview', source },
  'copy-pages': { kind: 'copy-pages', source, pages: [{ src: 0, rotate: 0 }] },
  split: { kind: 'split', source, parts: [{ pages: [0], target }], targets: [target] },
  extract: { kind: 'extract', source, target, pages: [{ src: 0, rotate: 0 }] },
  'insert-preview': { kind: 'insert-preview', path: source, base: null },
});

// 検体 → 期待する文（差し込みの下見だけは差し込みの文）。見出しだけの PDF は既知の限界（spec-6-1 タスク D）なので入れない。
const CASES = {
  'encrypted.pdf': [LOCKED, INSERT_UNREADABLE],
  'owner-only.pdf': [LOCKED, INSERT_UNREADABLE],
  'aes-128.pdf': [LOCKED, INSERT_UNREADABLE],
  'broken.pdf': [BROKEN, INSERT_UNREADABLE],
  'empty.pdf': [BROKEN, INSERT_FORMAT],
  'not-a-pdf.pdf': [BROKEN, INSERT_FORMAT],
};

for (const [file, [message, insertMessage]] of Object.entries(CASES)) {
  test(`${file} は、透かし・フラット化・件数の下見・写す・分割・抽出・差し込みの下見のどれでも、書き出さずに断る（D8）`, async (t) => {
    const target = workspace(t);
    for (const [kind, spec] of Object.entries(specsFor(fixturePath(file), target))) {
      const result = await runTask(spec, { send: () => {} });
      assert.notEqual(result.ok, true, kind);
      assert.equal(result.error, kind === 'insert-preview' ? insertMessage : message, kind);
      assert.equal(fs.existsSync(target), false, `${kind} は書き出さない`);
    }
  });
}

test('ページの木に壊れたページが混ざった PDF は、差し込まずに断る（pdf-lib は黙って飛ばすので。決定81 ⑬と同じ考え）', async () => {
  const result = await runTask({ kind: 'insert-preview', path: fixturePath('one-bad-page.pdf'), base: null }, { send: () => {} });
  assert.equal(result.error, '差し込む PDF に壊れたページがあるので、差し込めませんでした。');
  const fine = await runTask({ kind: 'insert-preview', path: fixturePath('three-pages.pdf'), base: null }, { send: () => {} });
  assert.equal(fine.ok, true, fine.error);
  assert.equal(fine.pages.length, 3);
});

test('差し込む元にも、開くときと同じ大きさの上限がある（読む前に断る。D6）', async () => {
  let reads = 0;
  const fsLike = { promises: {
    stat: async () => ({ size: MAX_PDF_BYTES + 1, mtimeMs: 1 }),
    readFile: async () => { reads += 1; return Buffer.alloc(0); },
  } };
  const result = await runTask({ kind: 'insert-preview', path: 'big.pdf', base: null }, { send: () => {}, fsLike });
  assert.equal(result.error, '200MB までに対応していますが、ファイルが大きすぎます。');
  assert.equal(reads, 0);
});
